import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/feedback-worker.js";
import domainWorker from "../src/domain-router.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

const TEST_ENV = {
  ...env,
  PUBLIC_ORIGIN: "https://stabilize.info",
  GOOGLE_CLIENT_ID:
    "1234567890-stabilize-feedback-tests.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  AUTH_SECRET: "test-auth-secret-with-at-least-thirty-two-characters",
  SESSION_SECRET:
    "test-session-secret-with-at-least-thirty-two-characters",
  GITHUB_FEEDBACK_TOKEN: "github_pat_1234567890abcdefghijklmnop",
  FEEDBACK_REPOSITORY: "lreedm1/Stabilize",
  FEEDBACK_BRANCH: "feedback-inbox",
  FEEDBACK_PATH: "feedback",
};

async function signedCookie() {
  const token = await createAuthSessionTokenForGoogleSubject(
    "feedback-test-user",
    TEST_ENV,
  );
  return `${AUTH_COOKIE_NAME}=${token}`;
}

async function signedIdentity(subject, testEnv = TEST_ENV) {
  const token = await createAuthSessionTokenForGoogleSubject(subject, testEnv);
  const cookie = `${AUTH_COOKIE_NAME}=${token}`;
  const session = await readAuthSession(
    new Request("https://stabilize.info/", {
      headers: { Cookie: cookie },
    }),
    testEnv,
  );
  assert.ok(session);
  return {
    cookie,
    continuity: { mode: "account", token: session.continuityToken },
  };
}

async function resolvesWithin(promise, timeoutMs = 1_000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Request did not resolve before the deadline")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

test("signed-in users see the public-storage and automated-review warning", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: await signedCookie() },
    }),
    TEST_ENV,
    {},
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /action="\/api\/feedback"/);
  assert.match(html, /saved in a public GitHub repository/i);
  assert.match(html, /reviewed by automated AI tooling/i);
  assert.match(html, /name="public_ack"[\s\S]*required/);
  assert.doesNotMatch(html, /feedback-test-user/);
});

test("feedback submission requires sign-in and public-storage acknowledgement", async () => {
  const signedOut = await worker.fetch(
    new Request("https://stabilize.info/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://stabilize.info",
      },
      body: new URLSearchParams({
        category: "idea",
        message: "Make the model labels clearer.",
        public_ack: "yes",
      }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(signedOut.status, 303);
  assert.equal(signedOut.headers.get("location"), "/auth/google");

  const missingConsent = await worker.fetch(
    new Request("https://stabilize.info/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: await signedCookie(),
        Origin: "https://stabilize.info",
      },
      body: new URLSearchParams({
        category: "idea",
        message: "Make the model labels clearer.",
      }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(missingConsent.status, 303);
  assert.equal(missingConsent.headers.get("location"), "/?feedback=invalid");
});

test("fixed safety chat bypasses hanging billing state and reservation calls", async () => {
  let stateReads = 0;
  let reservations = 0;
  const never = new Promise(() => {});
  const identity = await signedIdentity("paid-safety-billing-hang");
  const testEnv = {
    ...TEST_ENV,
    BILLING: {
      getByName() {
        return {
          readState() {
            stateReads += 1;
            return never;
          },
          reserveUsage() {
            reservations += 1;
            return never;
          },
        };
      },
    },
  };

  const response = await resolvesWithin(
    worker.fetch(
      new Request("https://stabilize.info/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "I am going to kill myself tonight",
          continuity: identity.continuity,
        }),
      }),
      testEnv,
      { waitUntil() {} },
    ),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.route, "IMMEDIATE_DANGER");
  assert.equal(body.showEmergency, true);
  assert.equal(stateReads, 0);
  assert.equal(reservations, 0);
});

test("ordinary paid chat still reads billing state and reserves usage", async () => {
  let stateReads = 0;
  let reservations = 0;
  let refunds = 0;
  const testEnv = {
    ...TEST_ENV,
    DEMO_MODE: "true",
    OPENAI_MODEL: "gpt-default",
    MODEL_CHOICES: "gpt-default|Default,gpt-paid|Paid",
    BILLING: {
      getByName() {
        return {
          async readState() {
            stateReads += 1;
            return { entitled: true, selectedModel: "gpt-paid" };
          },
          async reserveUsage() {
            reservations += 1;
            return { allowed: true, used: 1 };
          },
          async refundUsage() {
            refunds += 1;
            return true;
          },
        };
      },
    },
  };
  const identity = await signedIdentity("ordinary-paid-chat", testEnv);

  const response = await worker.fetch(
    new Request("https://stabilize.info/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({
        message: "Help me choose one small next step.",
        // An active account session owns the request boundary; a guest-mode
        // body is rejected before billing or memory access.
        continuity: identity.continuity,
      }),
    }),
    testEnv,
    { waitUntil() {} },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.route, "ORDINARY");
  assert.equal(stateReads, 1);
  assert.equal(reservations, 1);
  assert.equal(refunds, 0);
});

test("deletion during a wrapper delay invalidates the original chat request", async () => {
  const billingReadStarted = deferred();
  const releaseBillingRead = deferred();
  let erasedAt = null;
  let observedRequestStartedAt = null;
  const memoryStub = {
    async readContext() {
      return {
        summary: "",
        recent: [],
        awaitingSafetyAnswer: false,
        turnCount: 0,
        updatedAt: null,
      };
    },
    async beginModelTurn({ requestStartedAt }) {
      observedRequestStartedAt = requestStartedAt;
      if (erasedAt !== null && requestStartedAt <= erasedAt) {
        return {
          acquired: false,
          retryAfterSeconds: 0,
          reason: "memory_deleted",
        };
      }
      throw new Error("A pre-deletion request crossed the deletion barrier");
    },
    async eraseMemory() {
      erasedAt = Date.now();
      return { erased: true, erasedAt };
    },
  };
  const testEnv = {
    ...TEST_ENV,
    DEMO_MODE: "true",
    SESSIONS: {
      getByName() {
        return memoryStub;
      },
    },
    BILLING: {
      getByName() {
        return {
          readState() {
            billingReadStarted.resolve();
            return releaseBillingRead.promise;
          },
        };
      },
    },
  };
  const identity = await signedIdentity("wrapper-deletion-race", testEnv);
  const responsePromise = domainWorker.fetch(
    new Request("https://stabilize.info/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({
        message: "Help me choose one small next step.",
        continuity: identity.continuity,
      }),
    }),
    testEnv,
    { waitUntil() {} },
  );

  await resolvesWithin(billingReadStarted.promise);
  await memoryStub.eraseMemory();
  releaseBillingRead.resolve({ entitled: false, selectedModel: null });

  const response = await resolvesWithin(responsePromise);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reload, true);
  assert.ok(Number.isSafeInteger(observedRequestStartedAt));
  assert.ok(observedRequestStartedAt <= erasedAt);
});

test("revoked cookies are rejected by every account wrapper", async () => {
  let billingReads = 0;
  let feedbackReservations = 0;
  let feedbackSaves = 0;
  const revokedMemory = {
    async validateSession() {
      return { allowed: false };
    },
    async beginModelTurn() {
      return {
        acquired: false,
        retryAfterSeconds: 0,
        reason: "session_revoked",
      };
    },
    async recordFixedExchange() {
      return { recorded: false, reason: "session_revoked" };
    },
  };
  const testEnv = {
    ...TEST_ENV,
    DEMO_MODE: "true",
    SESSIONS: {
      getByName() {
        return revokedMemory;
      },
    },
    BILLING: {
      getByName() {
        return {
          async readState() {
            billingReads += 1;
            return { entitled: true, selectedModel: "gpt-paid" };
          },
          async reserveUsage() {
            throw new Error("Revoked sessions must not reserve usage");
          },
        };
      },
    },
    FEEDBACK_LIMITS: {
      getByName() {
        return {
          async reserve() {
            feedbackReservations += 1;
            return { allowed: true, reservationId: "unexpected" };
          },
        };
      },
    },
    FEEDBACK_INBOX: {
      getByName() {
        return {
          async save() {
            feedbackSaves += 1;
          },
        };
      },
    },
  };
  const identity = await signedIdentity("revoked-wrapper-user", testEnv);

  const rootResponse = await domainWorker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: identity.cookie },
    }),
    testEnv,
    { waitUntil() {} },
  );
  const rootHtml = await rootResponse.text();
  assert.equal(rootResponse.status, 200);
  assert.equal(rootResponse.headers.get("x-stabilize-account-state"), null);
  assert.doesNotMatch(rootHtml, /class="auth-session"/);
  assert.doesNotMatch(rootHtml, /action="\/api\/feedback"/);
  assert.match(rootHtml, /Sign in to send feedback/);
  assert.equal(billingReads, 0);

  const portalResponse = await domainWorker.fetch(
    new Request("https://stabilize.info/billing/portal", {
      method: "POST",
      headers: { Cookie: identity.cookie },
    }),
    testEnv,
    { waitUntil() {} },
  );
  assert.equal(portalResponse.status, 303);
  assert.equal(portalResponse.headers.get("location"), "/auth/google");
  assert.equal(billingReads, 0);

  for (const path of ["/billing/checkout", "/account/model"]) {
    const response = await domainWorker.fetch(
      new Request(`https://stabilize.info${path}`, {
        method: "POST",
        headers: { Cookie: identity.cookie },
      }),
      testEnv,
      { waitUntil() {} },
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/auth/google");
  }
  assert.equal(billingReads, 0);

  const feedbackResponse = await domainWorker.fetch(
    new Request("https://stabilize.info/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: identity.cookie,
      },
      body: new URLSearchParams({
        category: "idea",
        message: "This must not be saved from a revoked cookie.",
        public_ack: "yes",
      }),
    }),
    testEnv,
    { waitUntil() {} },
  );
  assert.equal(feedbackResponse.status, 303);
  assert.equal(feedbackResponse.headers.get("location"), "/auth/google");
  assert.equal(feedbackReservations, 0);
  assert.equal(feedbackSaves, 0);

  const chatResponse = await domainWorker.fetch(
    new Request("https://stabilize.info/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({
        message: "Help me choose one small next step.",
        continuity: identity.continuity,
      }),
    }),
    testEnv,
    { waitUntil() {} },
  );
  assert.equal(chatResponse.status, 409);
  assert.equal(billingReads, 0);
});

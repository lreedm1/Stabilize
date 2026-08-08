import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/paid-worker.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

function createMemoryNamespace() {
  let reads = 0;
  return {
    reads: () => reads,
    getByName() {
      return {
        async readContextForRequest() {
          reads += 1;
          return {
            summary: "",
            recent: [],
            awaitingSafetyAnswer: false,
            turnCount: 2,
            updatedAt: Date.now(),
            generation: 4,
          };
        },
        async recordExchange() {
          return {
            recorded: true,
            stale: false,
            shouldCompact: false,
            turnCount: 3,
            generation: 4,
          };
        },
        async getCompactionSnapshot() {
          return null;
        },
      };
    },
  };
}

function createBillingNamespace() {
  let previews = 0;
  let reservations = 0;
  let memoryGeneration = 0;
  return {
    previews: () => previews,
    reservations: () => reservations,
    getByName() {
      return {
        async previewChat(options) {
          previews += 1;
          return {
            allowed: true,
            reason: null,
            model: options.freeModel,
            tier: "free",
            period: options.freePeriod,
            used: 11,
            limit: options.freeLimit,
            remaining: options.freeLimit - 11,
            fallback: false,
            paid: false,
            reservationMade: false,
            subscriptionStatus: "none",
            memoryGeneration,
          };
        },
        async setMemoryGeneration(value) {
          memoryGeneration = Math.max(memoryGeneration, Number(value) || 0);
          return memoryGeneration;
        },
        async prepareChat(options) {
          reservations += 1;
          return {
            allowed: true,
            reason: null,
            model: options.freeModel,
            tier: "free",
            period: options.freePeriod,
            used: 12,
            limit: options.freeLimit,
            fallback: false,
            paid: false,
            reservationMade: true,
            memoryGeneration,
          };
        },
        async refundUsage() {
          return true;
        },
      };
    },
  };
}

function createEnv() {
  const sessions = createMemoryNamespace();
  const billing = createBillingNamespace();
  return {
    sessions,
    billing,
    env: {
      ASSETS: { fetch: async () => new Response("asset") },
      SESSIONS: sessions,
      BILLING: billing,
      DEMO_MODE: "false",
      OPENAI_API_KEY: "test-openai-key",
      OPENAI_MODEL: "gpt-5.4",
      OPENAI_REASONING_EFFORT: "none",
      OPENAI_SERVICE_TIER: "fast",
      MODEL_CHOICES: "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
      FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-sol",
      FREE_PLAN_FALLBACK_MODEL: "gpt-5.4",
      FREE_DAILY_MODEL_MESSAGE_LIMIT: "50",
      PAID_MONTHLY_MESSAGE_LIMIT: "200",
      PUBLIC_ORIGIN: "https://stabilize.test",
      GOOGLE_CLIENT_ID:
        "1234567890-account-preflight.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      AUTH_SECRET:
        "account-preflight-test-secret-with-at-least-thirty-two-characters",
    },
  };
}

async function identity(env) {
  const token = await createAuthSessionTokenForGoogleSubject(
    "account-preflight-worker-user",
    env,
  );
  const cookie = `${AUTH_COOKIE_NAME}=${token}`;
  const session = await readAuthSession(
    new Request("https://stabilize.test/", { headers: { Cookie: cookie } }),
    env,
  );
  assert.ok(session);
  return { cookie, accountKey: session.accountKey };
}

function responseWithText(text) {
  return Response.json({
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  });
}

test("account context preflights subscription and quota without reserving a message", async () => {
  const setup = createEnv();
  const account = await identity(setup.env);
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/account/context", {
      headers: {
        Accept: "application/json",
        Cookie: account.cookie,
      },
    }),
    setup.env,
    {},
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("X-Stabilize-Billing-Source"),
    "prefetched",
  );
  const result = await response.json();
  assert.equal(result.billing.model, "gpt-5.6-sol");
  assert.equal(result.billing.used, 11);
  assert.equal(result.billing.limit, 50);
  assert.equal(result.billing.remaining, 39);
  assert.equal(result.billing.paid, false);
  assert.equal(setup.sessions.reads(), 1);
  assert.equal(setup.billing.previews(), 1);
  assert.equal(setup.billing.reservations(), 0);
});

test("chat still performs the authoritative atomic reservation", async () => {
  const setup = createEnv();
  const account = await identity(setup.env);
  const contextResponse = await worker.fetch(
    new Request("https://stabilize.test/api/account/context", {
      headers: { Accept: "application/json", Cookie: account.cookie },
    }),
    setup.env,
    {},
  );
  const context = await contextResponse.json();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseWithText("Take one small step.");
  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: account.cookie,
          Origin: "https://stabilize.test",
        },
        body: JSON.stringify({
          message: "Help me start.",
          accountContextToken: context.token,
        }),
      }),
      setup.env,
      {},
    );
    assert.equal(response.status, 200);
    assert.equal(setup.billing.previews(), 1);
    assert.equal(setup.billing.reservations(), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

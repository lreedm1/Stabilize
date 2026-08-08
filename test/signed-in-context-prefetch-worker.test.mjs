import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/paid-worker.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

function createMemoryNamespace() {
  const state = {
    summary: "The user prefers small reversible steps.",
    recent: [
      { role: "user", content: "I need to call the pharmacy." },
      { role: "assistant", content: "Write down the medication name first." },
    ],
    awaitingSafetyAnswer: false,
    turnCount: 4,
    updatedAt: Date.now(),
    generation: 7,
  };
  let readCalls = 0;
  const writes = [];

  return {
    reads: () => readCalls,
    writes,
    getByName() {
      return {
        async readContextForRequest() {
          readCalls += 1;
          return structuredClone(state);
        },
        async recordExchange(exchange) {
          writes.push(structuredClone(exchange));
          return {
            recorded: true,
            stale: false,
            shouldCompact: false,
            turnCount: state.turnCount + writes.length,
            generation: state.generation,
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
  return {
    getByName() {
      return {
        async prepareChat(options) {
          return {
            allowed: true,
            reason: null,
            model: options.freeModel,
            tier: "free",
            period: options.freePeriod,
            used: 1,
            limit: options.freeLimit,
            fallback: false,
            paid: false,
            reservationMade: true,
          };
        },
        async refundUsage() {
          return true;
        },
        async readState() {
          return {
            customerId: null,
            subscriptionId: null,
            subscriptionStatus: "none",
            entitled: false,
            selectedModel: null,
            freeUsagePeriod: null,
            freeUsageCount: 0,
          };
        },
      };
    },
  };
}

function createEnv() {
  const sessions = createMemoryNamespace();
  return {
    env: {
      ASSETS: { fetch: async () => new Response("asset") },
      SESSIONS: sessions,
      BILLING: createBillingNamespace(),
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
        "1234567890-signed-in-prefetch.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      AUTH_SECRET:
        "signed-in-prefetch-test-secret-with-at-least-thirty-two-characters",
    },
    sessions,
  };
}

async function identity(env, subject) {
  const token = await createAuthSessionTokenForGoogleSubject(subject, env);
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

test("a signed context token removes the memory Durable Object read from chat preparation", async () => {
  const setup = createEnv();
  const account = await identity(setup.env, "prefetched-memory-user");

  const contextResponse = await worker.fetch(
    new Request("https://stabilize.test/api/account/context", {
      headers: {
        Accept: "application/json",
        Cookie: account.cookie,
      },
    }),
    setup.env,
    {},
  );
  assert.equal(contextResponse.status, 200);
  assert.equal(
    contextResponse.headers.get("X-Stabilize-Memory-Source"),
    "durable-object",
  );
  const contextResult = await contextResponse.json();
  assert.deepEqual(Object.keys(contextResult).sort(), [
    "expiresInSeconds",
    "token",
  ]);
  assert.match(contextResult.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(contextResult.expiresInSeconds, 900);
  assert.equal(setup.sessions.reads(), 1);

  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Call the pharmacy and ask for the refill date.");
  };

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
          message: "What is the next step?",
          accountContextToken: contextResult.token,
          messages: [
            { role: "user", content: "I found the prescription bottle." },
            { role: "assistant", content: "Keep it beside you for the call." },
          ],
        }),
      }),
      setup.env,
      {},
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("X-Stabilize-Memory-Source"),
      "prefetched",
    );
    assert.equal(response.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
    assert.equal(setup.sessions.reads(), 1);
    const input = JSON.stringify(providerBody.input);
    assert.match(input, /small reversible steps/);
    assert.match(input, /I need to call the pharmacy/);
    assert.match(input, /I found the prescription bottle/);
    assert.match(input, /What is the next step/);
    assert.equal(providerBody.service_tier, "fast");
    assert.equal(setup.sessions.writes.length, 1);
    assert.equal(setup.sessions.writes[0].expectedGeneration, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an invalid context token safely falls back to the Durable Object", async () => {
  const setup = createEnv();
  const account = await identity(setup.env, "invalid-prefetch-token-user");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseWithText("Use the first small step.");

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
          message: "Give me one step.",
          accountContextToken: "not-a-valid-token",
        }),
      }),
      setup.env,
      {},
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("X-Stabilize-Memory-Source"),
      "durable-object",
    );
    assert.equal(setup.sessions.reads(), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the account-context endpoint requires sign-in", async () => {
  const setup = createEnv();
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/account/context", {
      headers: { Accept: "application/json" },
    }),
    setup.env,
    {},
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Sign in to use account memory.",
  });
});

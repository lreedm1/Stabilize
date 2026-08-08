import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/paid-worker.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

function freshMemory(overrides = {}) {
  return {
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: Date.now(),
    generation: 0,
    ...overrides,
  };
}

function createMemoryNamespace() {
  const states = new Map();
  const readCounts = new Map();
  const writes = [];

  function stateFor(name) {
    if (!states.has(name)) states.set(name, freshMemory());
    return states.get(name);
  }

  return {
    states,
    writes,
    seed(name, overrides) {
      states.set(name, freshMemory(overrides));
    },
    reads(name = null) {
      if (name) return readCounts.get(name) || 0;
      return [...readCounts.values()].reduce((sum, count) => sum + count, 0);
    },
    getByName(name) {
      return {
        async readContextForRequest() {
          readCounts.set(name, (readCounts.get(name) || 0) + 1);
          return structuredClone(stateFor(name));
        },
        async recordExchange(exchange) {
          const state = stateFor(name);
          const expected = Number(exchange?.expectedGeneration);
          if (
            Number.isSafeInteger(expected) &&
            expected !== state.generation
          ) {
            return {
              recorded: false,
              stale: true,
              shouldCompact: false,
              turnCount: state.turnCount,
              generation: state.generation,
            };
          }
          writes.push({ name, exchange: structuredClone(exchange) });
          state.recent = [
            ...state.recent,
            { role: "user", content: exchange.user },
            { role: "assistant", content: exchange.assistant },
          ].slice(-8);
          state.turnCount += 1;
          state.updatedAt = Date.now();
          return {
            recorded: true,
            stale: false,
            shouldCompact: false,
            turnCount: state.turnCount,
            generation: state.generation,
          };
        },
        async deleteRememberedContext() {
          const state = stateFor(name);
          state.summary = "";
          state.recent = [];
          state.awaitingSafetyAnswer = false;
          state.turnCount = 0;
          state.updatedAt = null;
          state.generation += 1;
          return { deleted: true, generation: state.generation };
        },
        async startNewConversation() {
          const state = stateFor(name);
          state.recent = [];
          state.awaitingSafetyAnswer = false;
          state.generation += 1;
          return { started: true, generation: state.generation };
        },
        async getCompactionSnapshot() {
          return null;
        },
      };
    },
  };
}

function createBillingNamespace() {
  const generations = new Map();
  return {
    generation(name) {
      return generations.get(name) || 0;
    },
    getByName(name) {
      return {
        async setMemoryGeneration(value) {
          const supplied = Number(value);
          const current = generations.get(name) || 0;
          const next = Number.isSafeInteger(supplied)
            ? Math.max(current, supplied)
            : current;
          generations.set(name, next);
          return next;
        },
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
            memoryGeneration: generations.get(name) || 0,
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
  const billing = createBillingNamespace();
  return {
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
        "1234567890-signed-in-prefetch.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      AUTH_SECRET:
        "signed-in-prefetch-test-secret-with-at-least-thirty-two-characters",
    },
    sessions,
    billing,
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
  return {
    cookie,
    accountKey: session.accountKey,
    objectName: `google:${session.accountKey}`,
  };
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

async function fetchContext(setup, account) {
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
    response.headers.get("X-Stabilize-Memory-Source"),
    "durable-object",
  );
  return response.json();
}

function chatRequest(account, body) {
  return new Request("https://stabilize.test/api/chat", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: account.cookie,
      Origin: "https://stabilize.test",
    },
    body: JSON.stringify(body),
  });
}

test("a signed context token removes the memory Durable Object read from chat preparation", async () => {
  const setup = createEnv();
  const account = await identity(setup.env, "prefetched-memory-user");
  setup.sessions.seed(account.objectName, {
    summary: "The user prefers small reversible steps.",
    recent: [
      { role: "user", content: "I need to call the pharmacy." },
      { role: "assistant", content: "Write down the medication name first." },
    ],
    turnCount: 4,
    generation: 7,
  });

  const contextResult = await fetchContext(setup, account);
  assert.deepEqual(Object.keys(contextResult).sort(), [
    "expiresInSeconds",
    "token",
  ]);
  assert.match(contextResult.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(contextResult.expiresInSeconds, 900);
  assert.equal(setup.sessions.reads(account.objectName), 1);
  assert.equal(setup.billing.generation(account.objectName), 7);

  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Call the pharmacy and ask for the refill date.");
  };

  try {
    const response = await worker.fetch(
      chatRequest(account, {
        message: "What is the next step?",
        accountContextToken: contextResult.token,
        messages: [
          { role: "user", content: "I found the prescription bottle." },
          { role: "assistant", content: "Keep it beside you for the call." },
        ],
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
    assert.equal(setup.sessions.reads(account.objectName), 1);
    const input = JSON.stringify(providerBody.input);
    assert.match(input, /small reversible steps/);
    assert.match(input, /I need to call the pharmacy/);
    assert.match(input, /I found the prescription bottle/);
    assert.match(input, /What is the next step/);
    assert.equal(providerBody.service_tier, "fast");
    assert.equal(setup.sessions.writes.length, 1);
    assert.equal(
      setup.sessions.writes[0].exchange.expectedGeneration,
      7,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an invalid context token safely falls back to the Durable Object", async () => {
  const setup = createEnv();
  const account = await identity(setup.env, "invalid-prefetch-token-user");
  setup.sessions.seed(account.objectName, { generation: 7 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseWithText("Use the first small step.");

  try {
    const response = await worker.fetch(
      chatRequest(account, {
        message: "Give me one step.",
        accountContextToken: "not-a-valid-token",
      }),
      setup.env,
      {},
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("X-Stabilize-Memory-Source"),
      "durable-object",
    );
    assert.equal(setup.sessions.reads(account.objectName), 1);
    assert.equal(setup.billing.generation(account.objectName), 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a context token cannot be replayed into another signed-in account", async () => {
  const setup = createEnv();
  const first = await identity(setup.env, "first-prefetch-account");
  const second = await identity(setup.env, "second-prefetch-account");
  setup.sessions.seed(first.objectName, {
    summary: "ALPHA PRIVATE CONTEXT",
    generation: 2,
  });
  setup.sessions.seed(second.objectName, {
    summary: "BETA CURRENT CONTEXT",
    generation: 0,
  });
  const firstContext = await fetchContext(setup, first);

  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Use the current account context.");
  };

  try {
    const response = await worker.fetch(
      chatRequest(second, {
        message: "What context do you have?",
        accountContextToken: firstContext.token,
      }),
      setup.env,
      {},
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("X-Stabilize-Memory-Source"),
      "durable-object",
    );
    const input = JSON.stringify(providerBody.input);
    assert.match(input, /BETA CURRENT CONTEXT/);
    assert.doesNotMatch(input, /ALPHA PRIVATE CONTEXT/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deleting memory revokes an older prefetched token across signed-in requests", async () => {
  const setup = createEnv();
  const account = await identity(setup.env, "revoked-prefetch-account");
  setup.sessions.seed(account.objectName, {
    summary: "CONTEXT THAT MUST BE DELETED",
    generation: 4,
  });
  const oldContext = await fetchContext(setup, account);
  assert.equal(setup.billing.generation(account.objectName), 4);

  const deletion = await worker.fetch(
    new Request("https://stabilize.test/api/account/memory", {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Cookie: account.cookie,
        Origin: "https://stabilize.test",
      },
    }),
    setup.env,
    {},
  );
  assert.equal(deletion.status, 200);
  assert.equal((await deletion.json()).generation, 5);
  assert.equal(setup.billing.generation(account.objectName), 5);

  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("The deleted context is not present.");
  };

  try {
    const response = await worker.fetch(
      chatRequest(account, {
        message: "Start fresh.",
        accountContextToken: oldContext.token,
      }),
      setup.env,
      {},
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("X-Stabilize-Memory-Source"),
      "durable-object",
    );
    assert.doesNotMatch(
      JSON.stringify(providerBody.input),
      /CONTEXT THAT MUST BE DELETED/,
    );
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

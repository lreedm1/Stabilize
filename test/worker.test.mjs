import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { COPY } from "../src/copy.js";
import {
  AUTH_COOKIE_NAME,
  MEMORY_DELETION_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

const GOOGLE_CLIENT_ID =
  "1234567890-stabilize-tests.apps.googleusercontent.com";
const AUTH_SECRET = "test-auth-secret-with-at-least-thirty-two-characters";
const SESSION_SECRET =
  "test-session-secret-with-at-least-thirty-two-characters";
const GUEST_CONTINUITY = { mode: "guest", token: null };

function freshState() {
  return {
    summary: "",
    summaryVersion: 0,
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
    nextSequence: 1,
    epoch: 0,
    nextLease: 1,
    providerConversationId: null,
    providerLease: null,
    purgedConversationIds: [],
    quarantinedConversationIds: [],
    retiredConversationIds: [],
    fixedExchanges: [],
    failFixedWrites: false,
    erased: false,
  };
}

function createSessionNamespace() {
  const states = new Map();

  function contextFor(state) {
    return {
      summary: state.summary,
      recent: state.recent.map(({ role, content }) => ({ role, content })),
      awaitingSafetyAnswer: state.awaitingSafetyAnswer,
      turnCount: state.turnCount,
      updatedAt: state.updatedAt,
    };
  }

  function appendExchange(state, exchange) {
    state.recent.push(
      {
        sequence: state.nextSequence,
        role: "user",
        content: exchange.user,
      },
      {
        sequence: state.nextSequence + 1,
        role: "assistant",
        content: exchange.assistant,
      },
    );
    state.nextSequence += 2;
    state.recent = state.recent.slice(-8);
    state.awaitingSafetyAnswer = exchange.awaitingSafetyAnswer === true;
    state.turnCount += 1;
    state.updatedAt = Date.now();
    return {
      shouldCompact: state.recent.length >= 2,
      turnCount: state.turnCount,
    };
  }

  function leaseMatches(state, value) {
    return Boolean(
      state.providerLease &&
        value?.leaseToken === state.providerLease.leaseToken &&
        value?.epoch === state.providerLease.epoch &&
        value.epoch === state.epoch,
    );
  }

  return {
    states,
    getByName(name) {
      if (!states.has(name)) states.set(name, freshState());

      return {
        async readContext() {
          const state = states.get(name) || freshState();
          return contextFor(state);
        },
        async recordExchange(exchange) {
          const state = states.get(name) || freshState();
          if (state.providerLease) {
            throw new Error("Provider turn is leased");
          }
          const result = appendExchange(state, exchange);
          states.set(name, state);
          return result;
        },
        async recordLocalExchange(exchange) {
          const state = states.get(name) || freshState();
          if (state.providerConversationId) {
            state.quarantinedConversationIds.push(
              state.providerConversationId,
            );
          }
          state.providerConversationId = null;
          state.providerLease = null;
          state.epoch += 1;
          const result = appendExchange(state, exchange);
          states.set(name, state);
          return result;
        },
        async beginProviderTurn() {
          const state = states.get(name) || freshState();
          if (state.providerLease) {
            return { acquired: false, retryAfterSeconds: 1 };
          }
          const leaseToken = `lease-${state.nextLease}`;
          state.nextLease += 1;
          state.providerLease = { leaseToken, epoch: state.epoch };
          states.set(name, state);
          return {
            acquired: true,
            leaseToken,
            epoch: state.epoch,
            conversationId: state.providerConversationId,
            context: contextFor(state),
          };
        },
        async adoptProviderConversation(value) {
          const state = states.get(name) || freshState();
          if (!leaseMatches(state, value)) {
            return {
              accepted: false,
              conversationId: state.providerConversationId,
            };
          }
          if (!state.providerConversationId) {
            state.providerConversationId = value.candidateId;
          }
          states.set(name, state);
          return {
            accepted: true,
            conversationId: state.providerConversationId,
          };
        },
        async commitProviderTurn(value) {
          const state = states.get(name) || freshState();
          if (
            !leaseMatches(state, value) ||
            value.conversationId !== state.providerConversationId
          ) {
            return { committed: false };
          }
          const result = appendExchange(state, value.exchange);
          state.providerLease = null;
          states.set(name, state);
          return { committed: true, ...result };
        },
        async releaseProviderTurn(value) {
          const state = states.get(name) || freshState();
          if (!leaseMatches(state, value)) return false;
          state.providerLease = null;
          states.set(name, state);
          return true;
        },
        async quarantineProviderTurn(value) {
          const state = states.get(name) || freshState();
          if (!leaseMatches(state, value)) return false;
          const conversationId = value.conversationId;
          if (conversationId) {
            state.quarantinedConversationIds.push(conversationId);
          }
          if (conversationId === state.providerConversationId) {
            state.providerConversationId = null;
          }
          state.providerLease = null;
          state.epoch += 1;
          states.set(name, state);
          return true;
        },
        async retireMissingProviderConversation(value) {
          const state = states.get(name) || freshState();
          if (!leaseMatches(state, value)) return false;
          if (value.conversationId) {
            state.retiredConversationIds.push(value.conversationId);
          }
          if (value.conversationId === state.providerConversationId) {
            state.providerConversationId = null;
          }
          state.providerLease = null;
          state.epoch += 1;
          states.set(name, state);
          return true;
        },
        async recordFixedExchange(exchange) {
          const state = states.get(name) || freshState();
          if (state.failFixedWrites) throw new Error("fixed write unavailable");
          if (state.providerConversationId) {
            state.quarantinedConversationIds.push(
              state.providerConversationId,
            );
          }
          state.providerConversationId = null;
          state.providerLease = null;
          state.epoch += 1;
          state.fixedExchanges.push(exchange);
          const result = appendExchange(state, exchange);
          states.set(name, state);
          return result;
        },
        async eraseMemory() {
          const state = states.get(name) || freshState();
          if (state.providerConversationId) {
            state.purgedConversationIds.push(state.providerConversationId);
          }
          state.summary = "";
          state.summaryVersion = 0;
          state.recent = [];
          state.awaitingSafetyAnswer = false;
          state.turnCount = 0;
          state.updatedAt = null;
          state.nextSequence = 1;
          state.providerConversationId = null;
          state.providerLease = null;
          state.epoch += 1;
          state.erased = true;
          states.set(name, state);
          return true;
        },
        async purgeUnusedOpenAIConversation(conversationId) {
          const state = states.get(name) || freshState();
          state.purgedConversationIds.push(conversationId);
          states.set(name, state);
          return true;
        },
        async getCompactionSnapshot() {
          const state = states.get(name) || freshState();
          if (state.recent.length < 2) return null;
          return {
            summary: state.summary,
            summaryVersion: state.summaryVersion,
            stateEpoch: state.epoch,
            throughSequence: state.recent.at(-1).sequence,
            messages: state.recent.map(({ role, content }) => ({
              role,
              content,
            })),
          };
        },
        async applySummary(summary, expectedVersion, throughSequence) {
          const state = states.get(name) || freshState();
          if (state.summaryVersion !== expectedVersion) return false;
          state.summary = summary;
          state.summaryVersion += 1;
          state.recent = state.recent.filter(
            (message) => message.sequence > throughSequence,
          );
          states.set(name, state);
          return true;
        },
      };
    },
  };
}

function createEnv(overrides = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 }),
    },
    SESSIONS: createSessionNamespace(),
    DEMO_MODE: "true",
    OPENAI_MODEL: "gpt-5.6-sol",
    OPENAI_REASONING_EFFORT: "max",
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    AUTH_SECRET,
    SESSION_SECRET,
    PUBLIC_ORIGIN: "https://stabilize.test",
    ...overrides,
  };
}

async function authenticatedIdentity(env, subject) {
  const token = await createAuthSessionTokenForGoogleSubject(subject, env);
  const cookie = `${AUTH_COOKIE_NAME}=${token}`;
  const session = await readAuthSession(
    new Request("https://stabilize.test/", { headers: { Cookie: cookie } }),
    env,
  );
  assert.ok(session);
  return {
    cookie,
    objectName: `google:${session.accountKey}`,
    continuity: { mode: "account", token: session.continuityToken },
  };
}

function responseWithText(text) {
  return Response.json({
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text,
            annotations: [],
          },
        ],
      },
    ],
  });
}

function responseWithError(status, error, headers = {}) {
  return Response.json(
    { error },
    {
      status,
      headers,
    },
  );
}

function responseCookie(setCookie, name) {
  const match = String(setCookie || "").match(
    new RegExp(`(?:^|,\\s*)${name}=([^;,\\s]*)`),
  );
  assert.ok(match, `Missing ${name} cookie`);
  return `${name}=${match[1]}`;
}

test("health endpoint reports demo mode and session memory", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/health"),
    createEnv(),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    mode: "demo",
    model: null,
    aiFeature: null,
    memory: true,
    authentication: true,
    reasoningEffort: null,
    verbosity: null,
  });
});

test("health endpoint reports whether OpenAI is configured", async () => {
  const configuredResponse = await worker.fetch(
    new Request("https://stabilize.test/api/health"),
    createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
  );

  assert.equal(configuredResponse.status, 200);
  assert.deepEqual(await configuredResponse.json(), {
    ok: true,
    mode: "openai",
    model: "gpt-5.6-sol",
    aiFeature: "conversations",
    memory: true,
    authentication: true,
    reasoningEffort: "max",
    verbosity: "low",
  });

  const missingKeyResponse = await worker.fetch(
    new Request("https://stabilize.test/api/health"),
    createEnv({ DEMO_MODE: "false" }),
  );

  assert.equal(missingKeyResponse.status, 503);
  assert.deepEqual(await missingKeyResponse.json(), {
    ok: false,
    mode: "openai",
    model: "gpt-5.6-sol",
    aiFeature: "conversations",
    memory: true,
    authentication: true,
    reasoningEffort: "max",
    verbosity: "low",
  });
});

test("chat endpoint applies deterministic emergency routing", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "I am going to kill myself tonight",
      }),
    }),
    createEnv(),
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.route, "IMMEDIATE_DANGER");
  assert.equal(body.showEmergency, true);
  assert.match(body.reply, /safe person|staffed place/i);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("chat endpoint answers a Floor breach in demo mode", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "I have not eaten all day",
      }),
    }),
    createEnv(),
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.route, "FLOOR_FOOD");
  assert.match(body.reply, /eat/i);
});

test("chat endpoint calls OpenAI with store disabled", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs = [];
  let providerRequest;

  globalThis.fetch = async (input, init) => {
    providerRequest = { input: String(input), init };
    return responseWithText("Start with the smallest concrete part of the problem.");
  };
  console.log = (...values) => logs.push(values.join(" "));

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.7",
        },
        body: JSON.stringify({
          message: "Help me plan one next step.",
        }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );

    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).reply,
      "Start with the smallest concrete part of the problem.",
    );
    assert.equal(providerRequest.input, "https://api.openai.com/v1/responses");
    assert.equal(
      providerRequest.init.headers.Authorization,
      "Bearer test-openai-key",
    );
    assert.match(
      providerRequest.init.headers["X-Client-Request-Id"],
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const providerBody = JSON.parse(providerRequest.init.body);
    assert.equal(providerBody.model, "gpt-5.6-sol");
    assert.deepEqual(providerBody.reasoning, {
      effort: "max",
      context: "current_turn",
    });
    assert.deepEqual(providerBody.text, { verbosity: "low" });
    assert.equal(providerBody.store, false);
    assert.equal("max_output_tokens" in providerBody, false);
    assert.equal(providerBody.input[0].role, "user");
    assert.equal(providerBody.input[0].content, "Help me plan one next step.");
    assert.match(providerBody.instructions, /route ORDINARY/i);
    assert.match(providerBody.instructions, /Floor supports; answer leads/i);
    assert.match(providerBody.instructions, /current evidence wins/i);
    assert.match(providerBody.instructions, /Systems > willpower/i);
    assert.ok(COPY.model.systemPrompt.length < 3_200);
    assert.match(providerBody.instructions, /220 words or fewer/i);
    assert.match(providerBody.instructions, /document-ready content/i);
    assert.match(providerBody.instructions, /PRIOR CONTEXT MEMORY/i);

    const logged = logs.join("\n");
    assert.doesNotMatch(logged, /chat_session|ipAlias|sessionAlias/);
    assert.doesNotMatch(logged, /203\.0\.113\.7/);
    assert.doesNotMatch(logged, /Help me plan one next step/);
    assert.doesNotMatch(logged, /"route"/);
    assert.equal(response.headers.get("set-cookie"), null);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test("chat rejects messages over 4,000 characters", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalled = false;
  globalThis.fetch = async () => {
    providerCalled = true;
    return responseWithText("This should not be called.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "a".repeat(4001) }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, COPY.api.messageTooLong);
    assert.equal(providerCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("max effort safely falls back for older model choices", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Use the smallest useful step.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Help me choose a next step." }),
      }),
      createEnv({
        DEMO_MODE: "false",
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_MODEL: "gpt-5.1",
        OPENAI_REASONING_EFFORT: "max",
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(providerBody.reasoning, {
      effort: "high",
      context: "current_turn",
    });
    assert.deepEqual(providerBody.text, { verbosity: "low" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rate limits return a retry time and a safe traceable error", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs = [];
  let clientRequestId;

  globalThis.fetch = async (_input, init) => {
    clientRequestId = init.headers["X-Client-Request-Id"];
    return responseWithError(
      429,
      {
        code: "rate_limit_exceeded",
        type: "rate_limit_error",
        message: "raw provider detail must remain private",
      },
      {
        "Retry-After": "7",
        "X-Request-Id": "req_rate_limit_test",
      },
    );
  };
  console.error = (...values) => logs.push(values.join(" "));

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Help me plan one next step." }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );
    const body = await response.json();
    const logged = logs.join("\n");

    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "7");
    assert.equal(body.error, COPY.api.aiBusy(7));
    assert.match(body.reference, /^STB-[A-F0-9]{12}$/);
    assert.equal(
      body.reference,
      "STB-" + clientRequestId.replaceAll("-", "").slice(0, 12).toUpperCase(),
    );
    assert.match(logged, /"event":"openai_request_failed"/);
    assert.match(logged, /"code":"rate_limit_exceeded"/);
    assert.match(logged, /"providerRequestId":"req_rate_limit_test"/);
    assert.match(logged, new RegExp(clientRequestId));
    assert.doesNotMatch(logged, /raw provider detail/);
    assert.doesNotMatch(logged, /Help me plan one next step/);
    assert.doesNotMatch(JSON.stringify(body), /rate_limit_exceeded|req_rate_limit_test/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("spend and quota limits are not mislabeled as transient rate limits", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  globalThis.fetch = async () =>
    responseWithError(429, {
      code: "project_spend_limit_exceeded",
      type: "insufficient_quota",
      message: "project limit detail",
    });

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Help me plan one next step." }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), null);
    assert.equal(body.error, COPY.api.aiServiceLimit);
    assert.match(body.reference, /^STB-[A-F0-9]{12}$/);
    assert.doesNotMatch(JSON.stringify(body), /project_spend|insufficient_quota/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("one-message provider rejections suggest rewording without leaking details", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  globalThis.fetch = async () =>
    responseWithError(400, {
      code: "invalid_request_error",
      type: "invalid_request_error",
      message: "sensitive provider explanation",
    });

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Help me with this unusual request." }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );
    const body = await response.json();

    assert.equal(response.status, 422);
    assert.equal(body.error, COPY.api.aiRequestRejected);
    assert.match(body.reference, /^STB-[A-F0-9]{12}$/);
    assert.doesNotMatch(JSON.stringify(body), /sensitive provider explanation/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("an empty or rejected model reply becomes a retryable service error", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  globalThis.fetch = async () =>
    Response.json(
      { output: [] },
      { headers: { "X-Request-Id": "req_empty_reply_test" } },
    );

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Help me plan one next step." }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.error, COPY.api.unreliableReply);
    assert.match(body.reference, /^STB-[A-F0-9]{12}$/);
    assert.doesNotMatch(JSON.stringify(body), /req_empty_reply_test/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("provider connection failures return a safe reference", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  globalThis.fetch = async () => {
    throw new Error("private socket failure detail");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Help me plan one next step." }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error, COPY.api.aiConnection);
    assert.match(body.reference, /^STB-[A-F0-9]{12}$/);
    assert.doesNotMatch(JSON.stringify(body), /private socket failure detail/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("signed-in chats create and reuse one stored OpenAI Conversation", async () => {
  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  const memory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: memory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const identity = await authenticatedIdentity(env, "google-user-one");
  const stub = memory.getByName(identity.objectName);

  await stub.recordExchange({
    user: "I prefer short plans.",
    assistant: "I will keep the next step small.",
    awaitingSafetyAnswer: false,
  });
  memory.states.get(identity.objectName).summary =
    "The user prefers short plans.";

  globalThis.fetch = async (input, init) => {
    const request = {
      url: String(input),
      body: JSON.parse(init.body),
    };
    providerRequests.push(request);
    if (request.url.endsWith("/v1/conversations")) {
      return Response.json({ id: "conv_persistent_one" });
    }
    return responseWithText("Take one five-minute step.");
  };

  try {
    const firstResponse = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "What should I do next?",
          continuity: identity.continuity,
        }),
      }),
      env,
    );
    const secondResponse = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "Make that even smaller.",
          continuity: identity.continuity,
        }),
      }),
      env,
    );

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.deepEqual((await firstResponse.json()).continuity, identity.continuity);
    assert.deepEqual((await secondResponse.json()).continuity, identity.continuity);

    const createRequests = providerRequests.filter((request) =>
      request.url.endsWith("/v1/conversations"),
    );
    const responseRequests = providerRequests.filter((request) =>
      request.url.endsWith("/v1/responses"),
    );
    assert.equal(createRequests.length, 1);
    assert.equal(responseRequests.length, 2);
    assert.deepEqual(createRequests[0].body.metadata, {
      application: "stabilize",
      retention: "30_days",
    });
    assert.equal("items" in createRequests[0].body, false);

    assert.deepEqual(
      responseRequests.map(({ body }) => ({
        conversation: body.conversation,
        store: body.store,
        truncation: body.truncation,
        input: body.input,
      })),
      [
        {
          conversation: "conv_persistent_one",
          store: false,
          truncation: "auto",
          input: [
            {
              role: "user",
              content:
                COPY.model.memoryPrefix +
                "\nThe user prefers short plans.\nI prefer short plans.",
            },
            {
              role: "assistant",
              content: "I will keep the next step small.",
            },
            { role: "user", content: "What should I do next?" },
          ],
        },
        {
          conversation: "conv_persistent_one",
          store: false,
          truncation: "auto",
          input: [{ role: "user", content: "Make that even smaller." }],
        },
      ],
    );
    assert.equal(
      memory.states.get(identity.objectName).providerConversationId,
      "conv_persistent_one",
    );
    assert.equal(memory.states.get(identity.objectName).providerLease, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only a confirmed missing Conversation is retired and recreated", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const providerRequests = [];
  const memory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: memory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const identity = await authenticatedIdentity(env, "google-user-two");
  memory.getByName(identity.objectName);
  memory.states.get(identity.objectName).providerConversationId =
    "conv_missing_old";

  console.error = () => {};
  globalThis.fetch = async (input, init) => {
    const request = {
      url: String(input),
      body: JSON.parse(init.body),
    };
    providerRequests.push(request);
    if (request.url.endsWith("/v1/conversations")) {
      return Response.json({ id: "conv_recovered_new" });
    }
    if (request.body.conversation === "conv_missing_old") {
      return responseWithError(404, {
        code: "conversation_not_found",
        type: "invalid_request_error",
        param: "conversation",
        message: "provider detail",
      });
    }
    return responseWithText("Start with two quiet minutes.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "Help me restart.",
          continuity: identity.continuity,
        }),
      }),
      env,
    );

    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, "Start with two quiet minutes.");
    assert.deepEqual(
      memory.states.get(identity.objectName).retiredConversationIds,
      ["conv_missing_old"],
    );
    assert.equal(
      memory.states.get(identity.objectName).providerConversationId,
      "conv_recovered_new",
    );
    assert.equal(
      providerRequests.filter((request) =>
        request.url.endsWith("/v1/conversations"),
      ).length,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("an unrelated provider 404 preserves the active Conversation", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const memory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: memory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const identity = await authenticatedIdentity(env, "google-user-three");
  memory.getByName(identity.objectName);
  memory.states.get(identity.objectName).providerConversationId =
    "conv_keep_this";

  console.error = () => {};
  globalThis.fetch = async () =>
    responseWithError(404, {
      code: "not_found",
      type: "invalid_request_error",
      param: "response",
      message: "an unrelated resource was not found",
    });

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "Help me choose one step.",
          continuity: identity.continuity,
        }),
      }),
      env,
    );

    assert.equal(response.status, 503);
    assert.equal(
      memory.states.get(identity.objectName).providerConversationId,
      "conv_keep_this",
    );
    assert.deepEqual(
      memory.states.get(identity.objectName).retiredConversationIds,
      [],
    );
    assert.equal(memory.states.get(identity.objectName).providerLease, null);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("chat endpoint relies on the token budget instead of character truncation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseWithText("a".repeat(700));

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Give me one next step." }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(Array.from(body.reply).length, 700);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat endpoint rejects oversized declared bodies", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "32001",
      },
      body: "{}",
    }),
    createEnv(),
  );

  assert.equal(response.status, 413);
});

test("cross-origin chat and logout posts are rejected", async () => {
  const env = createEnv();
  const [chatResponse, logoutResponse, deletionResponse] = await Promise.all([
    worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://untrusted.example",
        },
        body: JSON.stringify({ message: "Do not process this." }),
      }),
      env,
    ),
    worker.fetch(
      new Request("https://stabilize.test/auth/logout", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
      }),
      env,
    ),
    worker.fetch(
      new Request("https://stabilize.test/account/memory/delete", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
      }),
      env,
    ),
  ]);

  assert.equal(chatResponse.status, 403);
  assert.equal((await chatResponse.json()).error, COPY.api.crossOriginRequest);
  assert.equal(logoutResponse.status, 403);
  assert.equal(await logoutResponse.text(), COPY.api.crossOriginRequest);
  assert.equal(logoutResponse.headers.get("set-cookie"), null);
  assert.equal(deletionResponse.status, 403);
  assert.equal(await deletionResponse.text(), COPY.api.crossOriginRequest);
});

test("account-memory deletion erases local and provider state", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "memory-deletion-user");
  await memory.getByName(identity.objectName).recordExchange({
    user: "Remember this.",
    assistant: "Okay.",
    awaitingSafetyAnswer: false,
  });
  memory.states.get(identity.objectName).providerConversationId =
    "conv_delete_me";

  const response = await worker.fetch(
    new Request("https://stabilize.test/account/memory/delete", {
      method: "POST",
      headers: {
        Cookie: identity.cookie,
        Origin: "https://stabilize.test",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        continuity: identity.continuity.token,
      }),
    }),
    env,
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  const setCookie = response.headers.get("set-cookie");
  const rotatedAuthCookie = responseCookie(setCookie, AUTH_COOKIE_NAME);
  const receiptCookie = responseCookie(
    setCookie,
    MEMORY_DELETION_COOKIE_NAME,
  );
  assert.deepEqual(
    await memory.getByName(identity.objectName).readContext(),
    {
      summary: "",
      recent: [],
      awaitingSafetyAnswer: false,
      turnCount: 0,
      updatedAt: null,
    },
  );
  assert.equal(memory.states.get(identity.objectName).providerConversationId, null);
  assert.deepEqual(memory.states.get(identity.objectName).purgedConversationIds, [
    "conv_delete_me",
  ]);
  assert.equal(memory.states.get(identity.objectName).erased, true);

  const confirmedPageResponse = await worker.fetch(
    new Request("https://stabilize.test/", {
      headers: { Cookie: `${rotatedAuthCookie}; ${receiptCookie}` },
    }),
    env,
  );
  const confirmedPage = await confirmedPageResponse.text();
  assert.match(confirmedPage, /memory-deletion-state/);
  assert.match(confirmedPage, /&quot;confirmed&quot;:true/);
  assert.ok(confirmedPage.includes(COPY.page.auth.memoryDeleted));
  assert.match(
    confirmedPageResponse.headers.get("set-cookie"),
    /stabilize_memory_deleted=;[\s\S]*Max-Age=0/,
  );

  const forgedQueryResponse = await worker.fetch(
    new Request("https://stabilize.test/?memory=deleted", {
      headers: { Cookie: rotatedAuthCookie },
    }),
    env,
  );
  const forgedQueryPage = await forgedQueryResponse.text();
  assert.match(forgedQueryPage, /&quot;confirmed&quot;:false/);
  assert.equal(forgedQueryPage.includes(COPY.page.auth.memoryDeleted), false);

  const unauthenticatedResponse = await worker.fetch(
    new Request("https://stabilize.test/account/memory/delete", {
      method: "POST",
    }),
    env,
  );
  assert.equal(unauthenticatedResponse.status, 303);
  assert.equal(unauthenticatedResponse.headers.get("location"), "/auth/google");
});

test("account-memory deletion is bound to the rendered account session", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const accountA = await authenticatedIdentity(env, "deletion-account-a");
  const accountB = await authenticatedIdentity(env, "deletion-account-b");
  await memory.getByName(accountA.objectName).recordExchange({
    user: "Account A memory",
    assistant: "A retained reply",
    awaitingSafetyAnswer: false,
  });
  await memory.getByName(accountB.objectName).recordExchange({
    user: "Account B memory",
    assistant: "B retained reply",
    awaitingSafetyAnswer: false,
  });

  const response = await worker.fetch(
    new Request("https://stabilize.test/account/memory/delete", {
      method: "POST",
      headers: {
        Cookie: accountB.cookie,
        Origin: "https://stabilize.test",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        continuity: accountA.continuity.token,
      }),
    }),
    env,
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/?memory=session-changed");
  assert.equal(memory.states.get(accountA.objectName).erased, false);
  assert.equal(memory.states.get(accountB.objectName).erased, false);
  assert.equal(
    (await memory.getByName(accountA.objectName).readContext()).turnCount,
    1,
  );
  assert.equal(
    (await memory.getByName(accountB.objectName).readContext()).turnCount,
    1,
  );
});

test("account-memory deletion fails closed without the memory binding", async () => {
  const env = createEnv({ SESSIONS: undefined });
  const identity = await authenticatedIdentity(env, "deletion-no-binding");
  const response = await worker.fetch(
    new Request("https://stabilize.test/account/memory/delete", {
      method: "POST",
      headers: {
        Cookie: identity.cookie,
        Origin: "https://stabilize.test",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        continuity: identity.continuity.token,
      }),
    }),
    env,
  );

  assert.equal(response.status, 503);
  assert.equal(await response.text(), COPY.api.temporarilyUnavailable);
});

test("root page renders the simplified chat without audio or a danger shortcut", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/"),
    createEnv(),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /font-src 'self'/);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.ok(html.includes(`href="/auth/google"`));
  assert.ok(html.includes(COPY.page.auth.signIn));
  assert.ok(html.includes(COPY.page.chat.supportNote));
  assert.ok(html.includes(COPY.page.chat.infoLabel));
  assert.ok(html.includes(COPY.page.chat.infoDetails));
  assert.ok(COPY.page.chat.supportNote.length < 80);
  assert.doesNotMatch(html, /forget-memory|Forget remembered context/);
  assert.ok(html.includes('id="terrain-background"'));
  assert.ok(html.includes('id="photo-backdrop"'));
  assert.ok(html.includes('id="photo-backdrop-image"'));
  assert.ok(html.includes("lake-valley-portrait-720.webp 720w"));
  assert.ok(html.includes("lake-valley-landscape-3840.webp 3840w"));
  assert.ok(
    html.indexOf('id="terrain-background"') <
      html.indexOf('id="photo-backdrop"'),
  );
  assert.ok(
    html.indexOf('id="photo-backdrop"') <
      html.indexOf('id="photo-background"'),
  );
  assert.doesNotMatch(html, /sound-toggle|sound-volume|sound-controls/);
  assert.doesNotMatch(html, /danger-button|emergency-panel|emergency-actions/);
  assert.doesNotMatch(html, /<audio|autoplay|nature-sounds\.js/);
  assert.ok(html.includes('placeholder="' + COPY.page.chat.inputPlaceholder + '"'));
  assert.match(html, /id="conversation-surface"[\s\S]*data-view="compose"/);
  assert.ok(html.includes(COPY.page.chat.responseLabel));
  assert.match(html, /rel="preload"[\s\S]*lexend-latin-wght-normal\.woff2/);
  assert.ok(html.includes('id="client-copy"'));
  assert.match(
    html,
    /id="continuity-state">\{&quot;mode&quot;:&quot;guest&quot;,&quot;token&quot;:null\}<\/template>/,
  );
  assert.doesNotMatch(html, /id="reset-button"|Start over/);
  assert.doesNotMatch(html, /id="status-line"/);
  assert.doesNotMatch(html, /quick-actions|data-prompt/);

  const outputIndex = html.indexOf('id="chat-log"');
  const noteIndex = html.indexOf(COPY.page.chat.supportNote);
  const infoIndex = html.indexOf(COPY.page.chat.infoDetails);
  const composerIndex = html.indexOf('id="chat-form"');
  assert.ok(outputIndex >= 0 && outputIndex < noteIndex);
  assert.ok(noteIndex < infoIndex && infoIndex < composerIndex);
  assert.match(html.slice(outputIndex, noteIndex), /\shidden(?:\s|>)/);
  assert.doesNotMatch(html.slice(outputIndex, noteIndex), /assistant-output/);

  const encodedClientCopy = html.match(
    /<template id="client-copy">([\s\S]*?)<\/template>/,
  )?.[1];
  assert.ok(encodedClientCopy);

  const decodedClientCopy = encodedClientCopy
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  const clientCopy = JSON.parse(decodedClientCopy);
  assert.equal(clientCopy.thinking, COPY.client.thinking);
  assert.equal(clientCopy.draftRestored, COPY.client.draftRestored);
  assert.equal(
    clientCopy.errorReferenceLabel,
    COPY.client.errorReferenceLabel,
  );
  assert.equal(clientCopy.memoryCleared, undefined);
  assert.equal(clientCopy.dangerReply, undefined);
  assert.equal(clientCopy.soundOn, undefined);
  assert.equal(clientCopy.sessionChanged, COPY.client.sessionChanged);
  assert.equal(
    clientCopy.deleteMemoryConfirm,
    COPY.client.deleteMemoryConfirm,
  );
});

test("guest chats remain available and create no server-side memory", async () => {
  const memory = createSessionNamespace();
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.44",
      },
      body: JSON.stringify({ message: "I have not eaten all day" }),
    }),
    createEnv({ SESSIONS: memory }),
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.continuity, GUEST_CONTINUITY);
  assert.equal(memory.states.size, 0);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("an old guest tab stays stateless after a cookie signs in", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  const memory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: memory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const identity = await authenticatedIdentity(env, "newly-signed-in-user");

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    providerBody = JSON.parse(init.body);
    return responseWithText("Choose one task and open its first page.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "Help me start one task.",
          continuity: GUEST_CONTINUITY,
        }),
      }),
      env,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.continuity, GUEST_CONTINUITY);
    assert.equal(providerBody.store, false);
    assert.equal(providerBody.conversation, undefined);
    assert.equal(memory.states.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an account continuity mismatch returns 409 without writing", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalled = false;
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "account-a-user");
  globalThis.fetch = async () => {
    providerCalled = true;
    return responseWithText("This must not be used.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "Do not cross account boundaries.",
          continuity: { mode: "account", token: "A".repeat(43) },
        }),
      }),
      env,
    );
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.reload, true);
    assert.deepEqual(body.continuity, identity.continuity);
    assert.equal(memory.states.size, 0);
    assert.equal(providerCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a signed-in fixed safety route retires provider continuity", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "safety-route-user");
  memory.getByName(identity.objectName);
  memory.states.get(identity.objectName).providerConversationId =
    "conv_before_safety";

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
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
    env,
  );
  const body = await response.json();
  const state = memory.states.get(identity.objectName);

  assert.equal(response.status, 200);
  assert.equal(body.route, "IMMEDIATE_DANGER");
  assert.deepEqual(body.continuity, identity.continuity);
  assert.equal(state.providerConversationId, null);
  assert.deepEqual(state.quarantinedConversationIds, ["conv_before_safety"]);
  assert.equal(state.fixedExchanges.length, 1);
  assert.doesNotMatch(state.fixedExchanges[0].user, /kill myself/i);
  assert.equal(state.turnCount, 1);
});

test("a fixed safety reply remains available when account memory fails", async () => {
  const originalError = console.error;
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "safety-storage-failure");
  memory.getByName(identity.objectName);
  memory.states.get(identity.objectName).failFixedWrites = true;
  console.error = () => {};

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
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
      env,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.route, "IMMEDIATE_DANGER");
    assert.equal(body.showEmergency, true);
    assert.match(body.reply, /safe person|staffed place/i);
  } finally {
    console.error = originalError;
  }
});

test("signed-in chats use account memory and ignore the connecting IP", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "stable-google-user");

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.55",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({
        message: "I have not eaten all day",
        continuity: identity.continuity,
      }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual([...memory.states.keys()], [identity.objectName]);
  assert.equal(
    (await memory.getByName(identity.objectName).readContext()).turnCount,
    1,
  );
  assert.doesNotMatch(identity.objectName, /192\.0\.2\.55/);
});

test("auth status and the root page reflect a valid Google session", async () => {
  const env = createEnv();
  const identity = await authenticatedIdentity(env, "root-page-user");
  const headers = { Cookie: identity.cookie };

  const [statusResponse, pageResponse] = await Promise.all([
    worker.fetch(new Request("https://stabilize.test/api/auth", { headers }), env),
    worker.fetch(new Request("https://stabilize.test/", { headers }), env),
  ]);
  const html = await pageResponse.text();

  assert.deepEqual(await statusResponse.json(), {
    signedIn: true,
    memory: true,
    google: true,
    continuity: identity.continuity,
  });
  assert.ok(html.includes(COPY.page.auth.signedIn));
  assert.ok(html.includes(COPY.page.auth.signOut));
  assert.match(html, /action="\/auth\/logout" method="post"/);
  assert.match(html, /action="\/account\/memory\/delete" method="post"/);
  assert.ok(html.includes(COPY.page.auth.forgetMemory));
  assert.ok(html.includes(identity.continuity.token));
  assert.doesNotMatch(html, /href="\/auth\/google"/);
});

test("the root retires the old anonymous session cookie", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/", {
      headers: {
        Cookie: "stabilize_session=44444444-4444-4444-8444-444444444444",
      },
    }),
    createEnv(),
  );

  assert.match(response.headers.get("set-cookie"), /stabilize_session=;/);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("static asset requests pass through to the asset binding", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/styles.css"),
    createEnv(),
  );
  assert.equal(await response.text(), "asset");
});

import { test, vi } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { GuestSessionMemory } from "../src/domain-router.js";
import { env as wranglerEnv } from "cloudflare:test";
import { COPY } from "../src/copy.js";
import {
  AUTH_COOKIE_NAME,
  GUEST_COOKIE_NAME,
  MEMORY_DELETION_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  createGuestResetGrant,
  readAuthSession,
  readGuestSession,
} from "../src/auth.js";

const GOOGLE_CLIENT_ID =
  "1234567890-stabilize-tests.apps.googleusercontent.com";
const AUTH_SECRET = "test-auth-secret-with-at-least-thirty-two-characters";
const SESSION_SECRET =
  "test-session-secret-with-at-least-thirty-two-characters";
const GUEST_SESSION_SECRET =
  "test-guest-session-secret-with-at-least-thirty-two-characters";
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
    modelLease: null,
    fixedExchanges: [],
    failFixedWrites: false,
    hangFixedWrites: false,
    erased: false,
    lastErasedAt: null,
    revokedThroughIssuedAtMs: null,
    hardDeleteAtMs: null,
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
      shouldCompact: state.recent.length >= 6,
      turnCount: state.turnCount,
    };
  }

  function rememberHardDeleteAt(state, value) {
    const deadline = Number(value);
    if (!Number.isSafeInteger(deadline) || deadline <= 0) return;
    state.hardDeleteAtMs = state.hardDeleteAtMs === null
      ? deadline
      : Math.min(state.hardDeleteAtMs, deadline);
  }

  function leaseMatches(state, value) {
    return Boolean(
      state.modelLease &&
        value?.leaseToken === state.modelLease.leaseToken &&
        value?.epoch === state.modelLease.epoch &&
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
          if (state.modelLease || state.epoch !== 0) {
            return { recorded: false, reason: "legacy_write_blocked" };
          }
          const result = appendExchange(state, exchange);
          states.set(name, state);
          return { recorded: true, ...result };
        },
        async recordLocalExchange(exchange, sessionIssuedAtMs) {
          const state = states.get(name) || freshState();
          if (
            state.revokedThroughIssuedAtMs !== null &&
            (!Number.isSafeInteger(Number(sessionIssuedAtMs)) ||
              Number(sessionIssuedAtMs) <=
                state.revokedThroughIssuedAtMs)
          ) {
            return { recorded: false, reason: "session_revoked" };
          }
          state.modelLease = null;
          state.epoch += 1;
          const result = appendExchange(state, exchange);
          states.set(name, state);
          return { recorded: true, stateEpoch: state.epoch, ...result };
        },
        async beginModelTurn(request = {}) {
          const state = states.get(name) || freshState();
          rememberHardDeleteAt(state, request.hardDeleteAtMs);
          if (
            state.lastErasedAt !== null &&
            (!Number.isSafeInteger(Number(request.sessionIssuedAtMs)) ||
              Number(request.sessionIssuedAtMs) <=
                state.revokedThroughIssuedAtMs)
          ) {
            return {
              acquired: false,
              retryAfterSeconds: 0,
              reason: "session_revoked",
            };
          }
          if (
            state.lastErasedAt !== null &&
            Number(request.requestStartedAt) <= state.lastErasedAt
          ) {
            return {
              acquired: false,
              retryAfterSeconds: 0,
              reason: "memory_deleted",
            };
          }
          if (state.modelLease) {
            return { acquired: false, retryAfterSeconds: 1 };
          }
          const leaseToken = `lease_${String(state.nextLease).padStart(24, "0")}`;
          state.nextLease += 1;
          state.epoch += 1;
          state.modelLease = { leaseToken, epoch: state.epoch };
          states.set(name, state);
          return {
            acquired: true,
            leaseToken,
            epoch: state.epoch,
            context: contextFor(state),
          };
        },
        async commitModelTurn(value) {
          const state = states.get(name) || freshState();
          rememberHardDeleteAt(state, value?.hardDeleteAtMs);
          if (
            state.revokedThroughIssuedAtMs !== null &&
            (!Number.isSafeInteger(Number(value?.sessionIssuedAtMs)) ||
              Number(value.sessionIssuedAtMs) <=
                state.revokedThroughIssuedAtMs)
          ) {
            return { committed: false, reason: "session_revoked" };
          }
          if (!leaseMatches(state, value)) {
            return { committed: false };
          }
          const result = appendExchange(state, value.exchange);
          state.modelLease = null;
          states.set(name, state);
          return { committed: true, stateEpoch: state.epoch, ...result };
        },
        async releaseModelTurn(value) {
          const state = states.get(name) || freshState();
          if (!leaseMatches(state, value)) return false;
          state.modelLease = null;
          states.set(name, state);
          return true;
        },
        async recordFixedExchange(
          exchange,
          requestStartedAt,
          sessionIssuedAtMs,
          hardDeleteAtMs,
        ) {
          const state = states.get(name) || freshState();
          rememberHardDeleteAt(state, hardDeleteAtMs);
          if (state.failFixedWrites) throw new Error("fixed write unavailable");
          if (state.hangFixedWrites) return new Promise(() => {});
          if (
            state.revokedThroughIssuedAtMs !== null &&
            (!Number.isSafeInteger(Number(sessionIssuedAtMs)) ||
              Number(sessionIssuedAtMs) <=
                state.revokedThroughIssuedAtMs)
          ) {
            return { recorded: false, reason: "session_revoked" };
          }
          if (
            state.lastErasedAt !== null &&
            Number(requestStartedAt) <= state.lastErasedAt
          ) {
            return { recorded: false, reason: "memory_deleted" };
          }
          state.modelLease = null;
          state.epoch += 1;
          state.fixedExchanges.push(exchange);
          const result = appendExchange(state, exchange);
          states.set(name, state);
          return { recorded: true, stateEpoch: state.epoch, ...result };
        },
        async eraseMemory(sessionIssuedAtMs, hardDeleteAtMs) {
          const state = states.get(name) || freshState();
          rememberHardDeleteAt(state, hardDeleteAtMs);
          const cleanIssuedAtMs = Number(sessionIssuedAtMs);
          const revokedThrough = state.revokedThroughIssuedAtMs || 0;
          if (
            !Number.isSafeInteger(cleanIssuedAtMs) ||
            cleanIssuedAtMs <= revokedThrough
          ) {
            return { erased: false, reason: "session_revoked" };
          }
          const erasedAt = Date.now();
          const nextBoundary = Math.max(
            revokedThrough,
            erasedAt,
            cleanIssuedAtMs,
          );
          state.summary = "";
          state.summaryVersion = 0;
          state.recent = [];
          state.awaitingSafetyAnswer = false;
          state.turnCount = 0;
          state.updatedAt = null;
          state.nextSequence = 1;
          state.modelLease = null;
          state.epoch += 1;
          state.erased = true;
          state.lastErasedAt = erasedAt;
          state.revokedThroughIssuedAtMs = nextBoundary;
          states.set(name, state);
          return {
            erased: true,
            erasedAt,
            nextSessionIssuedAtMs: nextBoundary + 1,
          };
        },
        async validateSession(sessionIssuedAtMs) {
          const state = states.get(name) || freshState();
          return {
            allowed:
              state.revokedThroughIssuedAtMs === null ||
              (Number.isSafeInteger(Number(sessionIssuedAtMs)) &&
                Number(sessionIssuedAtMs) >
                  state.revokedThroughIssuedAtMs),
          };
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
        async applySummary(
          summary,
          expectedVersion,
          throughSequence,
          expectedEpoch,
        ) {
          const state = states.get(name) || freshState();
          if (
            state.summaryVersion !== expectedVersion ||
            state.epoch !== expectedEpoch
          ) {
            return false;
          }
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
    GUEST_SESSIONS: createSessionNamespace(),
    DEMO_MODE: "true",
    OPENAI_MODEL: "gpt-5.6-sol",
    OPENAI_REASONING_EFFORT: "max",
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    AUTH_SECRET,
    SESSION_SECRET,
    GUEST_SESSION_SECRET,
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
    session,
    objectName: `google:${session.accountKey}`,
    continuity: { mode: "account", token: session.continuityToken },
  };
}

async function guestIdentity(env) {
  const response = await worker.fetch(
    new Request("https://stabilize.test/"),
    env,
  );
  const html = await response.text();
  const cookie = responseCookie(
    response.headers.get("set-cookie"),
    GUEST_COOKIE_NAME,
  );
  const session = await readGuestSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: cookie },
    }),
    env,
  );
  assert.ok(session);
  return {
    cookie,
    html,
    response,
    session,
    objectName: `guest:${session.guestKey}`,
    continuity: { mode: "guest", token: session.continuityToken },
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

function base64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function legacyAuthCookie(accountKey, issuedAtMs = Date.now() - 60_000) {
  const issuedAt = Math.floor(issuedAtMs / 1_000);
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({
        v: 1,
        a: accountKey,
        iat: issuedAt,
        exp: issuedAt + 30 * 24 * 60 * 60,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `stabilize:auth-session:v1\u0000${payload}`,
    ),
  );
  return `${AUTH_COOKIE_NAME}=${payload}.${base64Url(signature)}`;
}

function createOneShotDeferredNamespace(methodName, expectedCalls = 1) {
  const base = createSessionNamespace();
  let intercepted = 0;
  let releaseMethod;
  let methodReached;
  const reached = new Promise((resolve) => {
    methodReached = resolve;
  });
  const released = new Promise((resolve) => {
    releaseMethod = resolve;
  });

  return {
    namespace: {
      states: base.states,
      getByName(name) {
        const stub = base.getByName(name);
        return {
          ...stub,
          async [methodName](...args) {
            if (intercepted < expectedCalls) {
              intercepted += 1;
              if (intercepted === expectedCalls) methodReached();
              await released;
            }
            return stub[methodName](...args);
          },
        };
      },
    },
    reached,
    release() {
      releaseMethod();
    },
  };
}

test("deployment entrypoint exports and binds the guest Durable Object", () => {
  assert.equal(typeof GuestSessionMemory, "function");
  assert.equal(typeof wranglerEnv.GUEST_SESSIONS?.getByName, "function");
});

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
    aiFeature: "responses",
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
    aiFeature: "responses",
    memory: true,
    authentication: true,
    reasoningEffort: "max",
    verbosity: "low",
  });

  const missingGuestSecretResponse = await worker.fetch(
    new Request("https://stabilize.test/api/health"),
    createEnv({ GUEST_SESSION_SECRET: undefined }),
  );

  assert.equal(missingGuestSecretResponse.status, 503);
  assert.deepEqual(await missingGuestSecretResponse.json(), {
    ok: false,
    mode: "demo",
    model: null,
    aiFeature: null,
    memory: false,
    authentication: true,
    reasoningEffort: null,
    verbosity: null,
  });
});

test("chat endpoint applies deterministic emergency routing", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://stabilize.test", "Sec-Fetch-Site": "same-origin" },
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
      headers: { "Content-Type": "application/json", Origin: "https://stabilize.test", "Sec-Fetch-Site": "same-origin" },
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

test("chat endpoint calls OpenAI with store enabled", async () => {
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
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
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
    assert.equal(providerBody.store, true);
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

test("a neutral current greeting cannot inherit an unsolicited safety check", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    responseWithText(
      "Because of what you said before, are you safe right now or in immediate danger?",
    );

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({ message: "Hi" }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      route: "ORDINARY",
      reply: "Hi. What’s happening right now?",
      showEmergency: false,
      awaitingSafetyAnswer: false,
      continuity: GUEST_CONTINUITY,
    });
  } finally {
    globalThis.fetch = originalFetch;
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
        headers: { "Content-Type": "application/json", Origin: "https://stabilize.test", "Sec-Fetch-Site": "same-origin" },
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
        headers: { "Content-Type": "application/json", Origin: "https://stabilize.test", "Sec-Fetch-Site": "same-origin" },
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
        headers: { "Content-Type": "application/json", Origin: "https://stabilize.test", "Sec-Fetch-Site": "same-origin" },
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
        headers: { "Content-Type": "application/json", Origin: "https://stabilize.test", "Sec-Fetch-Site": "same-origin" },
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
        headers: { "Content-Type": "application/json", Origin: "https://stabilize.test", "Sec-Fetch-Site": "same-origin" },
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
        headers: { "Content-Type": "application/json", Origin: "https://stabilize.test", "Sec-Fetch-Site": "same-origin" },
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
        headers: { "Content-Type": "application/json", Origin: "https://stabilize.test", "Sec-Fetch-Site": "same-origin" },
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

test("signed-in chats use bounded account memory with stored OpenAI responses", async () => {
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
    return responseWithText(
      providerRequests.length === 1
        ? "Take one five-minute step."
        : "Open the document and write one line.",
    );
  };

  try {
    const firstResponse = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
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
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
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

    assert.equal(providerRequests.length, 2);
    assert.ok(
      providerRequests.every(({ url }) => url.endsWith("/v1/responses")),
    );
    for (const { body } of providerRequests) {
      assert.equal(body.store, true);
      assert.equal("conversation" in body, false);
      assert.equal("previous_response_id" in body, false);
      assert.ok(Array.isArray(body.input));
    }
    assert.match(
      providerRequests[0].body.input[0].content,
      /PRIOR CONTEXT MEMORY[\s\S]*prefers short plans[\s\S]*I prefer short plans/i,
    );
    assert.ok(
      providerRequests[1].body.input.some(
        (item) => item.content === "Take one five-minute step.",
      ),
    );
    assert.equal(memory.states.get(identity.objectName).modelLease, null);
    assert.equal(memory.states.get(identity.objectName).turnCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed provider call releases the account turn lease", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const memory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: memory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const identity = await authenticatedIdentity(env, "google-user-two");
  let calls = 0;

  console.error = () => {};
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return responseWithError(503, {
        code: "service_unavailable",
        type: "server_error",
        message: "provider detail",
      });
    }
    return responseWithText("Start with two quiet minutes.");
  };

  try {
    const first = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "Help me restart.",
          continuity: identity.continuity,
        }),
      }),
      env,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(first.status, 503);
    assert.equal(memory.states.get(identity.objectName).modelLease, null);

    const second = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "Help me restart.",
          continuity: identity.continuity,
        }),
      }),
      env,
    );
    assert.equal(second.status, 200);
    assert.equal((await second.json()).reply, "Start with two quiet minutes.");
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("six recent messages compact in the background with OpenAI storage enabled", async () => {
  const originalFetch = globalThis.fetch;
  const providerBodies = [];
  const tasks = [];
  const memory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: memory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const identity = await authenticatedIdentity(env, "google-user-compaction");
  const stub = memory.getByName(identity.objectName);

  await stub.recordLocalExchange({
    user: "I need a short plan.",
    assistant: "We will keep it small.",
    awaitingSafetyAnswer: false,
  });
  await stub.recordLocalExchange({
    user: "The task is current.",
    assistant: "Choose one five-minute action.",
    awaitingSafetyAnswer: false,
  });

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    providerBodies.push(body);
    if (body.instructions === COPY.model.summaryPrompt) {
      return responseWithText(
        "The user wants a short plan for one current task.",
      );
    }
    return responseWithText("Write down the first five-minute action.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "Help me start this task.",
          continuity: identity.continuity,
        }),
      }),
      env,
      {
        waitUntil(promise) {
          tasks.push(promise);
        },
      },
    );

    assert.equal(response.status, 200);
    await Promise.all(tasks);

    const context = await stub.readContext();
    assert.equal(
      context.summary,
      "The user wants a short plan for one current task.",
    );
    assert.deepEqual(context.recent, []);
    assert.equal(providerBodies.length, 2);
    assert.ok(providerBodies.every((body) => body.store === true));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat endpoint relies on the token budget instead of character truncation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseWithText("a".repeat(700));

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://stabilize.test", "Sec-Fetch-Site": "same-origin" },
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
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
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
  const guest = await guestIdentity(env);
  const [
    chatResponse,
    logoutResponse,
    deletionResponse,
    guestDeletionResponse,
  ] = await Promise.all([
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
    worker.fetch(
      new Request("https://stabilize.test/guest/memory/delete", {
        method: "POST",
        headers: {
          Cookie: guest.cookie,
          Origin: "https://untrusted.example",
          "Sec-Fetch-Site": "cross-site",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          continuity: guest.continuity.token,
        }),
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
  assert.equal(guestDeletionResponse.status, 403);
  assert.equal(
    await guestDeletionResponse.text(),
    COPY.api.crossOriginRequest,
  );
  assert.equal(guestDeletionResponse.headers.get("set-cookie"), null);
});

test("account-memory deletion erases local state and rotates the session", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "memory-deletion-user");
  await memory.getByName(identity.objectName).recordExchange({
    user: "Remember this.",
    assistant: "Okay.",
    awaitingSafetyAnswer: false,
  });
  const response = await worker.fetch(
    new Request("https://stabilize.test/account/memory/delete", {
      method: "POST",
      headers: {
        Cookie: identity.cookie,
        Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
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
  const receiptCookie = responseCookie(
    response.headers.get("set-cookie"),
    MEMORY_DELETION_COOKIE_NAME,
  );
  const rotatedAuthCookie = responseCookie(
    response.headers.get("set-cookie"),
    AUTH_COOKIE_NAME,
  );
  const rotatedAuthSession = await readAuthSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: rotatedAuthCookie },
    }),
    env,
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
  assert.equal(memory.states.get(identity.objectName).erased, true);
  assert.equal(rotatedAuthSession.accountKey, identity.session.accountKey);
  assert.notEqual(
    rotatedAuthSession.continuityToken,
    identity.continuity.token,
  );

  const revokedChatResponse = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({
        message: "Do not recreate the deleted memory.",
        continuity: identity.continuity,
      }),
    }),
    env,
  );
  assert.equal(revokedChatResponse.status, 409);
  assert.equal((await revokedChatResponse.json()).reload, true);
  assert.equal(revokedChatResponse.headers.get("set-cookie"), null);
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

  const revokedAuthResponse = await worker.fetch(
    new Request("https://stabilize.test/api/auth", {
      headers: { Cookie: identity.cookie },
    }),
    env,
  );
  assert.deepEqual(await revokedAuthResponse.json(), {
    signedIn: false,
    memory: false,
    google: true,
    continuity: GUEST_CONTINUITY,
  });
  assert.equal(revokedAuthResponse.headers.get("set-cookie"), null);

  await new Promise((resolve) => setTimeout(resolve, 2));
  const currentSafetyResponse = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
        Cookie: rotatedAuthCookie,
      },
      body: JSON.stringify({
        message: "I might hurt myself.",
        continuity: {
          mode: "account",
          token: rotatedAuthSession.continuityToken,
        },
      }),
    }),
    env,
  );
  assert.equal(currentSafetyResponse.status, 200);
  assert.equal((await currentSafetyResponse.json()).route, "SAFETY_UNCLEAR");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    memory.states.get(identity.objectName).awaitingSafetyAnswer,
    true,
  );

  const revokedContextProbe = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({
        message: "no",
        continuity: identity.continuity,
      }),
    }),
    env,
  );
  assert.equal(revokedContextProbe.status, 409);
  assert.equal(
    memory.states.get(identity.objectName).awaitingSafetyAnswer,
    true,
  );

  const confirmedPageResponse = await worker.fetch(
    new Request("https://stabilize.test/", {
      headers: { Cookie: `${rotatedAuthCookie}; ${receiptCookie}` },
    }),
    env,
  );
  const confirmedPage = await confirmedPageResponse.text();
  assert.match(confirmedPage, /memory-deletion-state/);
  assert.match(confirmedPage, /&quot;confirmed&quot;:true/);
  assert.ok(
    confirmedPage.includes(
      `&quot;deletedContinuity&quot;:{&quot;mode&quot;:&quot;account&quot;,&quot;token&quot;:&quot;${identity.continuity.token}&quot;}`,
    ),
  );
  assert.ok(
    confirmedPage.includes("remembered data was deleted from Stabilize."),
  );
  assert.equal(confirmedPageResponse.headers.get("set-cookie"), null);

  const forgedQueryResponse = await worker.fetch(
    new Request("https://stabilize.test/?memory=deleted", {
      headers: { Cookie: identity.cookie },
    }),
    env,
  );
  const forgedQueryPage = await forgedQueryResponse.text();
  assert.match(forgedQueryPage, /id="memory-deletion-state">null<\/template>/);
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

test("a delayed stale account chat cannot clear a freshly rotated auth cookie", async () => {
  const deferred = createOneShotDeferredNamespace("beginModelTurn");
  const env = createEnv({ SESSIONS: deferred.namespace });
  const identity = await authenticatedIdentity(env, "delayed-chat-deletion");
  const staleChatPromise = worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://stabilize.test",
        "Sec-Fetch-Site": "same-origin",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({
        message: "Help me choose one ordinary errand to do first.",
        continuity: identity.continuity,
      }),
    }),
    env,
  );
  await deferred.reached;

  const deletionResponse = await worker.fetch(
    new Request("https://stabilize.test/account/memory/delete", {
      method: "POST",
      headers: {
        Cookie: identity.cookie,
        Origin: "https://stabilize.test",
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        continuity: identity.continuity.token,
      }),
    }),
    env,
  );
  const rotatedAuthCookie = responseCookie(
    deletionResponse.headers.get("set-cookie"),
    AUTH_COOKIE_NAME,
  );
  assert.notEqual(rotatedAuthCookie, identity.cookie);

  deferred.release();
  const staleChatResponse = await staleChatPromise;

  assert.equal(staleChatResponse.status, 409);
  assert.equal((await staleChatResponse.json()).reload, true);
  assert.equal(staleChatResponse.headers.get("set-cookie"), null);
});

test("a losing concurrent account deletion cannot clear a freshly rotated auth cookie", async () => {
  const deferred = createOneShotDeferredNamespace("eraseMemory");
  const env = createEnv({ SESSIONS: deferred.namespace });
  const identity = await authenticatedIdentity(env, "concurrent-account-delete");
  const deletionRequest = () =>
    new Request("https://stabilize.test/account/memory/delete", {
      method: "POST",
      headers: {
        Cookie: identity.cookie,
        Origin: "https://stabilize.test",
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        continuity: identity.continuity.token,
      }),
    });

  const losingResponsePromise = worker.fetch(deletionRequest(), env);
  await deferred.reached;
  const winningResponse = await worker.fetch(deletionRequest(), env);
  const rotatedAuthCookie = responseCookie(
    winningResponse.headers.get("set-cookie"),
    AUTH_COOKIE_NAME,
  );
  assert.notEqual(rotatedAuthCookie, identity.cookie);

  deferred.release();
  const losingResponse = await losingResponsePromise;

  assert.equal(losingResponse.status, 303);
  assert.equal(
    losingResponse.headers.get("location"),
    "/?memory=session-changed",
  );
  assert.equal(losingResponse.headers.get("set-cookie"), null);
});

test("a delayed old auth-status response cannot clear a freshly rotated auth cookie", async () => {
  const deferred = createOneShotDeferredNamespace("validateSession");
  const env = createEnv({ SESSIONS: deferred.namespace });
  const identity = await authenticatedIdentity(env, "delayed-auth-status");
  const staleStatusPromise = worker.fetch(
    new Request("https://stabilize.test/api/auth", {
      headers: { Cookie: identity.cookie },
    }),
    env,
  );
  await deferred.reached;

  const deletionResponse = await worker.fetch(
    new Request("https://stabilize.test/account/memory/delete", {
      method: "POST",
      headers: {
        Cookie: identity.cookie,
        Origin: "https://stabilize.test",
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        continuity: identity.continuity.token,
      }),
    }),
    env,
  );
  const rotatedAuthCookie = responseCookie(
    deletionResponse.headers.get("set-cookie"),
    AUTH_COOKIE_NAME,
  );
  assert.notEqual(rotatedAuthCookie, identity.cookie);

  deferred.release();
  const staleStatusResponse = await staleStatusPromise;

  assert.deepEqual(await staleStatusResponse.json(), {
    signedIn: false,
    memory: false,
    google: true,
    continuity: GUEST_CONTINUITY,
  });
  assert.equal(staleStatusResponse.headers.get("set-cookie"), null);
});

test("a delayed old root response cannot overwrite a freshly rotated auth cookie", async () => {
  const deferred = createOneShotDeferredNamespace("validateSession");
  const env = createEnv({ SESSIONS: deferred.namespace });
  const identity = await authenticatedIdentity(env, "delayed-root-validation");
  const staleRootPromise = worker.fetch(
    new Request("https://stabilize.test/", {
      headers: { Cookie: identity.cookie },
    }),
    env,
  );
  await deferred.reached;

  const deletionResponse = await worker.fetch(
    new Request("https://stabilize.test/account/memory/delete", {
      method: "POST",
      headers: {
        Cookie: identity.cookie,
        Origin: "https://stabilize.test",
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        continuity: identity.continuity.token,
      }),
    }),
    env,
  );
  const rotatedAuthCookie = responseCookie(
    deletionResponse.headers.get("set-cookie"),
    AUTH_COOKIE_NAME,
  );
  assert.notEqual(rotatedAuthCookie, identity.cookie);

  deferred.release();
  const staleRootResponse = await staleRootPromise;
  const staleRootCookies = staleRootResponse.headers.get("set-cookie");

  assert.equal(staleRootResponse.status, 200);
  assert.match(staleRootCookies, /__Host-stabilize_guest=/);
  assert.doesNotMatch(staleRootCookies, /(?:^|,\s*)stabilize_auth=/);
});

test("delayed legacy root and auth-status responses cannot overwrite a newer account cookie", async () => {
  const now = Date.parse("2026-08-03T20:00:00Z");
  const deferred = createOneShotDeferredNamespace("validateSession", 2);
  vi.useFakeTimers();
  vi.setSystemTime(now);

  try {
    const env = createEnv({ SESSIONS: deferred.namespace });
    const originalAccount = await authenticatedIdentity(
      env,
      "legacy-passive-newer-account",
    );
    const legacyCookie = await legacyAuthCookie(
      originalAccount.session.accountKey,
      now - 60_000,
    );
    const legacySession = await readAuthSession(
      new Request("https://stabilize.test/", {
        headers: { Cookie: legacyCookie },
      }),
      env,
    );
    assert.equal(legacySession.needsRefresh, true);

    const legacyRootPromise = worker.fetch(
      new Request("https://stabilize.test/", {
        headers: { Cookie: legacyCookie },
      }),
      env,
    );
    const legacyStatusPromise = worker.fetch(
      new Request("https://stabilize.test/api/auth", {
        headers: { Cookie: legacyCookie },
      }),
      env,
    );
    await deferred.reached;

    vi.setSystemTime(now + 1_000);
    const newerAccount = await authenticatedIdentity(
      env,
      "legacy-passive-newer-account",
    );
    assert.equal(
      newerAccount.session.accountKey,
      originalAccount.session.accountKey,
    );
    assert.notEqual(newerAccount.cookie, legacyCookie);
    assert.ok(
      newerAccount.session.issuedAtMs > legacySession.issuedAtMs,
    );

    deferred.release();
    const [legacyRootResponse, legacyStatusResponse] = await Promise.all([
      legacyRootPromise,
      legacyStatusPromise,
    ]);

    assert.equal(legacyRootResponse.status, 200);
    assert.equal(legacyRootResponse.headers.get("set-cookie"), null);
    assert.equal(legacyStatusResponse.status, 200);
    assert.equal(legacyStatusResponse.headers.get("set-cookie"), null);
    assert.equal((await legacyStatusResponse.json()).signedIn, true);
  } finally {
    deferred.release();
    vi.useRealTimers();
  }
});

test("delayed legacy root and auth-status responses cannot overwrite an account-deletion rotation", async () => {
  const now = Date.parse("2026-08-03T20:00:00Z");
  const deferred = createOneShotDeferredNamespace("validateSession", 2);
  vi.useFakeTimers();
  vi.setSystemTime(now);

  try {
    const env = createEnv({ SESSIONS: deferred.namespace });
    const deletingAccount = await authenticatedIdentity(
      env,
      "legacy-passive-account-deletion",
    );
    const legacyCookie = await legacyAuthCookie(
      deletingAccount.session.accountKey,
      now - 60_000,
    );

    const legacyRootPromise = worker.fetch(
      new Request("https://stabilize.test/", {
        headers: { Cookie: legacyCookie },
      }),
      env,
    );
    const legacyStatusPromise = worker.fetch(
      new Request("https://stabilize.test/api/auth", {
        headers: { Cookie: legacyCookie },
      }),
      env,
    );
    await deferred.reached;

    vi.setSystemTime(now + 1_000);
    const deletionResponse = await worker.fetch(
      new Request("https://stabilize.test/account/memory/delete", {
        method: "POST",
        headers: {
          Cookie: deletingAccount.cookie,
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          continuity: deletingAccount.continuity.token,
        }),
      }),
      env,
    );
    const rotatedAuthCookie = responseCookie(
      deletionResponse.headers.get("set-cookie"),
      AUTH_COOKIE_NAME,
    );
    assert.notEqual(rotatedAuthCookie, deletingAccount.cookie);

    deferred.release();
    const [legacyRootResponse, legacyStatusResponse] = await Promise.all([
      legacyRootPromise,
      legacyStatusPromise,
    ]);
    const legacyRootCookies = legacyRootResponse.headers.get("set-cookie");

    assert.equal(legacyRootResponse.status, 200);
    assert.match(legacyRootCookies, /__Host-stabilize_guest=/);
    assert.doesNotMatch(
      legacyRootCookies,
      /(?:^|,\s*)stabilize_auth=/,
    );
    assert.deepEqual(await legacyStatusResponse.json(), {
      signedIn: false,
      memory: false,
      google: true,
      continuity: GUEST_CONTINUITY,
    });
    assert.equal(legacyStatusResponse.headers.get("set-cookie"), null);
  } finally {
    deferred.release();
    vi.useRealTimers();
  }
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
          "Sec-Fetch-Site": "same-origin",
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
          "Sec-Fetch-Site": "same-origin",
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
  const guestMemory = createSessionNamespace();
  const env = createEnv({ GUEST_SESSIONS: guestMemory });
  const response = await worker.fetch(
    new Request("https://stabilize.test/"),
    env,
  );
  const html = await response.text();
  const guestCookie = responseCookie(
    response.headers.get("set-cookie"),
    GUEST_COOKIE_NAME,
  );
  const guestSession = await readGuestSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: guestCookie },
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /font-src 'self'/);
  assert.match(response.headers.get("set-cookie"), /__Host-stabilize_guest=/);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /SameSite=Lax/);
  assert.match(response.headers.get("set-cookie"), /Secure/);
  assert.ok(guestSession);
  assert.equal(guestMemory.states.size, 0);
  assert.ok(html.includes(`href="/auth/google"`));
  assert.ok(html.includes(COPY.page.auth.signIn));
  assert.ok(html.includes(COPY.page.chat.supportNote));
  assert.ok(html.includes(COPY.page.chat.infoLabel));
  assert.ok(
    html.includes("For guests, Stabilize stores a bounded summary"),
  );
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
    new RegExp(
      `id="continuity-state">\\{&quot;mode&quot;:&quot;guest&quot;,&quot;token&quot;:&quot;${guestSession.continuityToken}&quot;\\}<\\/template>`,
    ),
  );
  assert.match(html, /action="\/guest\/memory\/delete" method="post"/);
  assert.ok(html.includes(guestSession.continuityToken));
  assert.doesNotMatch(html, /id="reset-button"|Start over/);
  assert.doesNotMatch(html, /id="status-line"/);
  assert.doesNotMatch(html, /quick-actions|data-prompt/);

  const outputIndex = html.indexOf('id="chat-log"');
  const noteIndex = html.indexOf(COPY.page.chat.supportNote);
  const infoIndex = html.indexOf(
    "For guests, Stabilize stores a bounded summary",
  );
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

test("token-bound guest chats reuse bounded browser memory with stored OpenAI responses", async () => {
  const originalFetch = globalThis.fetch;
  const providerBodies = [];
  const guestMemory = createSessionNamespace();
  const env = createEnv({
    GUEST_SESSIONS: guestMemory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const guest = await guestIdentity(env);

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    providerBodies.push(JSON.parse(init.body));
    return responseWithText(
      providerBodies.length === 1
        ? "Open the task list and choose one item."
        : "Open that item and do its first two-minute step.",
    );
  };

  try {
    const first = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          "CF-Connecting-IP": "192.0.2.44",
          Cookie: guest.cookie,
        },
        body: JSON.stringify({
          message: "Help me start one task.",
          continuity: guest.continuity,
        }),
      }),
      env,
    );
    const second = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          "CF-Connecting-IP": "198.51.100.9",
          Cookie: guest.cookie,
        },
        body: JSON.stringify({
          message: "Make it smaller.",
          continuity: guest.continuity,
        }),
      }),
      env,
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual((await first.json()).continuity, guest.continuity);
    assert.deepEqual((await second.json()).continuity, guest.continuity);
    assert.equal(providerBodies.length, 2);
    assert.ok(providerBodies.every((body) => body.store === true));
    assert.ok(
      providerBodies.every((body) => !("conversation" in body)),
    );
    assert.match(
      JSON.stringify(providerBodies[1].input),
      /Help me start one task[\s\S]*Open the task list and choose one item/,
    );
    assert.deepEqual([...guestMemory.states.keys()], [guest.objectName]);
    assert.equal(guestMemory.states.get(guest.objectName).turnCount, 2);
    assert.equal(
      guestMemory.states.get(guest.objectName).hardDeleteAtMs,
      guest.session.expiresAt * 1_000,
    );
    assert.doesNotMatch(guest.objectName, /192\.0\.2\.44|198\.51\.100\.9/);
    assert.equal(first.headers.get("set-cookie"), null);
    assert.equal(second.headers.get("set-cookie"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an active account takes precedence over a stale guest tab", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalled = false;
  const accountMemory = createSessionNamespace();
  const guestMemory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: accountMemory,
    GUEST_SESSIONS: guestMemory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const guest = await guestIdentity(env);
  const account = await authenticatedIdentity(env, "newly-signed-in-user");
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
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          Cookie: `${guest.cookie}; ${account.cookie}`,
        },
        body: JSON.stringify({
          message: "Do not cross the identity boundary.",
          continuity: guest.continuity,
        }),
      }),
      env,
    );
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.reload, true);
    assert.deepEqual(body.continuity, account.continuity);
    assert.equal(providerCalled, false);
    assert.equal(accountMemory.states.size, 1);
    assert.deepEqual(
      await accountMemory.getByName(account.objectName).readContext(),
      {
        summary: "",
        recent: [],
        awaitingSafetyAnswer: false,
        turnCount: 0,
        updatedAt: null,
      },
    );
    assert.equal(guestMemory.states.size, 0);

    const resetGrant = await createGuestResetGrant(guest.session, env);
    const activeAccountCookies = `${guest.cookie}; ${account.cookie}`;
    const resetResponse = await worker.fetch(
      new Request("https://stabilize.test/guest/session/reset", {
        method: "POST",
        headers: {
          Cookie: activeAccountCookies,
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          continuity: guest.continuity.token,
          grant: resetGrant,
        }),
      }),
      env,
    );
    const deleteResponse = await worker.fetch(
      new Request("https://stabilize.test/guest/memory/delete", {
        method: "POST",
        headers: {
          Cookie: activeAccountCookies,
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          continuity: guest.continuity.token,
        }),
      }),
      env,
    );

    assert.equal(resetResponse.status, 204);
    assert.equal(resetResponse.headers.get("set-cookie"), null);
    assert.equal(deleteResponse.status, 303);
    assert.equal(
      deleteResponse.headers.get("location"),
      "/?memory=session-changed",
    );
    assert.equal(deleteResponse.headers.get("set-cookie"), null);
    assert.equal(guestMemory.states.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a revoked valid account cookie falls through to complete guest continuity", async () => {
  const originalFetch = globalThis.fetch;
  const providerBodies = [];
  const accountMemory = createSessionNamespace();
  const guestMemory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: accountMemory,
    GUEST_SESSIONS: guestMemory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const guest = await guestIdentity(env);
  const revokedAccount = await authenticatedIdentity(
    env,
    "revoked-account-with-guest",
  );
  const accountStub = accountMemory.getByName(revokedAccount.objectName);
  await accountStub.recordExchange({
    user: "ACCOUNT-ONLY-SENTINEL",
    assistant: "This belongs only to the account.",
    awaitingSafetyAnswer: false,
  });
  const revocation = await accountStub.eraseMemory(
    revokedAccount.session.issuedAtMs,
  );
  assert.equal(revocation.erased, true);

  const combinedCookies = `${guest.cookie}; ${revokedAccount.cookie}`;
  const cryptographicSession = await readAuthSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: combinedCookies },
    }),
    env,
  );
  assert.equal(
    cryptographicSession.accountKey,
    revokedAccount.session.accountKey,
  );

  globalThis.fetch = async (_input, init) => {
    providerBodies.push(JSON.parse(init.body));
    return responseWithText("Choose the shortest errand and start there.");
  };

  try {
    const rootResponse = await worker.fetch(
      new Request("https://stabilize.test/", {
        headers: { Cookie: combinedCookies },
      }),
      env,
    );
    const rootHtml = await rootResponse.text();
    const statusResponse = await worker.fetch(
      new Request("https://stabilize.test/api/auth", {
        headers: { Cookie: combinedCookies },
      }),
      env,
    );

    assert.equal(rootResponse.status, 200);
    assert.equal(rootResponse.headers.get("set-cookie"), null);
    assert.ok(rootHtml.includes(COPY.page.auth.signIn));
    assert.ok(rootHtml.includes(guest.continuity.token));
    assert.deepEqual(await statusResponse.json(), {
      signedIn: false,
      memory: true,
      google: true,
      continuity: guest.continuity,
    });
    assert.equal(statusResponse.headers.get("set-cookie"), null);

    const chatResponse = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          Cookie: combinedCookies,
        },
        body: JSON.stringify({
          message: "Help me choose one ordinary errand to do first.",
          continuity: guest.continuity,
        }),
      }),
      env,
    );
    const chatBody = await chatResponse.json();

    assert.equal(chatResponse.status, 200);
    assert.equal(chatBody.reply, "Choose the shortest errand and start there.");
    assert.deepEqual(chatBody.continuity, guest.continuity);
    assert.equal(providerBodies.length, 1);
    assert.doesNotMatch(
      JSON.stringify(providerBodies[0].input),
      /ACCOUNT-ONLY-SENTINEL/,
    );
    assert.equal(
      (await accountStub.readContext()).turnCount,
      0,
    );
    assert.equal(
      (await guestMemory.getByName(guest.objectName).readContext()).turnCount,
      1,
    );

    const resetGrant = await createGuestResetGrant(guest.session, env);
    const resetResponse = await worker.fetch(
      new Request("https://stabilize.test/guest/session/reset", {
        method: "POST",
        headers: {
          Cookie: combinedCookies,
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          continuity: guest.continuity.token,
          grant: resetGrant,
        }),
      }),
      env,
    );
    const resetCookies = resetResponse.headers.get("set-cookie");
    const resetGuestCookie = responseCookie(
      resetCookies,
      GUEST_COOKIE_NAME,
    );
    const resetGuest = await readGuestSession(
      new Request("https://stabilize.test/", {
        headers: { Cookie: resetGuestCookie },
      }),
      env,
    );

    assert.equal(resetResponse.status, 204);
    assert.ok(resetGuest);
    assert.notEqual(resetGuest.guestKey, guest.session.guestKey);
    assert.doesNotMatch(resetCookies, /(?:^|,\s*)stabilize_auth=/);

    const deleteResponse = await worker.fetch(
      new Request("https://stabilize.test/guest/memory/delete", {
        method: "POST",
        headers: {
          Cookie: `${resetGuestCookie}; ${revokedAccount.cookie}`,
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          continuity: resetGuest.continuityToken,
        }),
      }),
      env,
    );
    const deleteCookies = deleteResponse.headers.get("set-cookie");
    const replacementGuestCookie = responseCookie(
      deleteCookies,
      GUEST_COOKIE_NAME,
    );
    const replacementGuest = await readGuestSession(
      new Request("https://stabilize.test/", {
        headers: { Cookie: replacementGuestCookie },
      }),
      env,
    );

    assert.equal(deleteResponse.status, 303);
    assert.equal(deleteResponse.headers.get("location"), "/");
    assert.ok(replacementGuest);
    assert.notEqual(replacementGuest.guestKey, resetGuest.guestKey);
    assert.doesNotMatch(deleteCookies, /(?:^|,\s*)stabilize_auth=/);
    assert.equal(
      guestMemory.states.get(`guest:${resetGuest.guestKey}`).erased,
      true,
    );
    assert.equal(
      (await accountStub.readContext()).turnCount,
      0,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("guest deletion erases the old browser memory and rotates its identity", async () => {
  const guestMemory = createSessionNamespace();
  const env = createEnv({ GUEST_SESSIONS: guestMemory });
  const guest = await guestIdentity(env);
  const invalidForm = await worker.fetch(
    new Request("https://stabilize.test/guest/memory/delete", {
      method: "POST",
      headers: {
        Cookie: guest.cookie,
        Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
        "Content-Type": "text/plain",
      },
      body: guest.continuity.token,
    }),
    env,
  );
  assert.equal(invalidForm.status, 400);
  assert.equal(invalidForm.headers.get("set-cookie"), null);
  assert.equal(guestMemory.states.get(guest.objectName).erased, false);

  const chat = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
        Cookie: guest.cookie,
      },
      body: JSON.stringify({
        message: "Help me choose one small task.",
        continuity: guest.continuity,
      }),
    }),
    env,
  );
  assert.equal(chat.status, 200);
  assert.equal(guestMemory.states.get(guest.objectName).turnCount, 1);

  const deletion = await worker.fetch(
    new Request("https://stabilize.test/guest/memory/delete", {
      method: "POST",
      headers: {
        Cookie: guest.cookie,
        Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        continuity: guest.continuity.token,
      }),
    }),
    env,
  );
  const setCookie = deletion.headers.get("set-cookie");
  const replacementCookie = responseCookie(setCookie, GUEST_COOKIE_NAME);
  const receiptCookie = responseCookie(
    setCookie,
    MEMORY_DELETION_COOKIE_NAME,
  );
  const replacement = await readGuestSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: replacementCookie },
    }),
    env,
  );

  assert.equal(deletion.status, 303);
  assert.equal(deletion.headers.get("location"), "/");
  assert.ok(replacement);
  assert.notEqual(replacement.guestKey, guest.session.guestKey);
  assert.notEqual(
    replacement.continuityToken,
    guest.session.continuityToken,
  );
  assert.equal(guestMemory.states.get(guest.objectName).erased, true);
  assert.equal(guestMemory.states.get(guest.objectName).turnCount, 0);
  assert.equal(
    guestMemory.states.get(guest.objectName).hardDeleteAtMs,
    guest.session.expiresAt * 1_000,
  );

  const confirmed = await worker.fetch(
    new Request("https://stabilize.test/", {
      headers: { Cookie: `${replacementCookie}; ${receiptCookie}` },
    }),
    env,
  );
  const confirmedHtml = await confirmed.text();
  assert.match(confirmedHtml, /&quot;confirmed&quot;:true/);
  assert.ok(
    confirmedHtml.includes(
      `&quot;deletedContinuity&quot;:{&quot;mode&quot;:&quot;guest&quot;,&quot;token&quot;:&quot;${guest.continuity.token}&quot;}`,
    ),
  );
  assert.ok(
    confirmedHtml.includes("remembered data was deleted from Stabilize."),
  );

  const staleChat = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
        Cookie: guest.cookie,
      },
      body: JSON.stringify({
        message: "Do not recreate erased memory.",
        continuity: guest.continuity,
      }),
    }),
    env,
  );
  const staleBody = await staleChat.json();
  assert.equal(staleChat.status, 409);
  assert.equal(staleBody.reload, true);
  assert.equal(staleBody.resetGuest, true);
  assert.equal(staleChat.headers.get("set-cookie"), null);
});

test("an exact guest deletion retry recovers a lost replacement response", async () => {
  const guestMemory = createSessionNamespace();
  const env = createEnv({ GUEST_SESSIONS: guestMemory });
  const guest = await guestIdentity(env);
  const chat = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://stabilize.test",
        "Sec-Fetch-Site": "same-origin",
        Cookie: guest.cookie,
      },
      body: JSON.stringify({
        message: "Remember one small next step.",
        continuity: guest.continuity,
      }),
    }),
    env,
  );
  assert.equal(chat.status, 200);
  assert.equal(guestMemory.states.get(guest.objectName).turnCount, 1);

  const deleteWithOldSession = () =>
    worker.fetch(
      new Request("https://stabilize.test/guest/memory/delete", {
        method: "POST",
        headers: {
          Cookie: guest.cookie,
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          continuity: guest.continuity.token,
        }),
      }),
      env,
    );

  // The browser never applies this response, so it retains the exact old
  // cookie and public continuity binding for the retry.
  const lostResponse = await deleteWithOldSession();
  assert.equal(lostResponse.status, 303);
  assert.equal(lostResponse.headers.get("location"), "/");
  assert.equal(guestMemory.states.get(guest.objectName).erased, true);
  assert.equal(guestMemory.states.get(guest.objectName).turnCount, 0);

  const retry = await deleteWithOldSession();
  const retryCookies = retry.headers.get("set-cookie");
  const replacementCookie = responseCookie(
    retryCookies,
    GUEST_COOKIE_NAME,
  );
  const receiptCookie = responseCookie(
    retryCookies,
    MEMORY_DELETION_COOKIE_NAME,
  );
  const replacement = await readGuestSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: replacementCookie },
    }),
    env,
  );

  assert.equal(retry.status, 303);
  assert.equal(retry.headers.get("location"), "/");
  assert.ok(replacement);
  assert.notEqual(replacement.guestKey, guest.session.guestKey);

  const [replacementRoot, oldRoot] = await Promise.all([
    worker.fetch(
      new Request("https://stabilize.test/", {
        headers: { Cookie: `${replacementCookie}; ${receiptCookie}` },
      }),
      env,
    ),
    worker.fetch(
      new Request("https://stabilize.test/", {
        headers: { Cookie: `${guest.cookie}; ${receiptCookie}` },
      }),
      env,
    ),
  ]);
  const replacementHtml = await replacementRoot.text();
  const oldHtml = await oldRoot.text();
  assert.match(replacementHtml, /&quot;confirmed&quot;:true/);
  assert.match(oldHtml, /id="memory-deletion-state">null<\/template>/);
  assert.ok(
    replacementHtml.includes("remembered data was deleted from Stabilize."),
  );
  assert.equal(
    oldHtml.includes("remembered data was deleted from Stabilize."),
    false,
  );
  assert.deepEqual(
    await guestMemory.getByName(guest.objectName).readContext(),
    {
      summary: "",
      recent: [],
      awaitingSafetyAnswer: false,
      turnCount: 0,
      updatedAt: null,
    },
  );
});

test("a terminal guest 409 grants a bound reset without probing current sessions", async () => {
  const guestMemory = createSessionNamespace();
  const env = createEnv({ GUEST_SESSIONS: guestMemory });
  const guest = await guestIdentity(env);
  const resetRequest = ({
    cookie = guest.cookie,
    continuity = guest.continuity.token,
    grant,
    headers = {},
  } = {}) => {
    const body = new URLSearchParams({ continuity });
    if (grant !== undefined) body.set("grant", grant);
    return worker.fetch(
      new Request("https://stabilize.test/guest/session/reset", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/x-www-form-urlencoded",
          ...headers,
        },
        body,
      }),
      env,
    );
  };

  assert.equal(guestMemory.states.size, 0);
  const current = await resetRequest();
  assert.equal(current.status, 204);
  assert.equal(current.headers.get("set-cookie"), null);
  assert.equal(guestMemory.states.size, 0);

  const [crossOrigin, wrongType, wrongToken] = await Promise.all([
    resetRequest({ headers: { Origin: "https://untrusted.example" } }),
    resetRequest({ headers: { "Content-Type": "text/plain" } }),
    resetRequest({ continuity: "A".repeat(43) }),
  ]);
  assert.equal(crossOrigin.status, 403);
  assert.equal(wrongType.status, 400);
  assert.equal(wrongToken.status, 204);
  assert.equal(crossOrigin.headers.get("set-cookie"), null);
  assert.equal(wrongType.headers.get("set-cookie"), null);
  assert.equal(wrongToken.headers.get("set-cookie"), null);
  assert.equal(guestMemory.states.size, 0);

  await guestMemory
    .getByName(guest.objectName)
    .eraseMemory(
      guest.session.issuedAtMs,
      guest.session.expiresAt * 1_000,
    );
  const terminal = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://stabilize.test",
        "Sec-Fetch-Site": "same-origin",
        Cookie: guest.cookie,
      },
      body: JSON.stringify({
        message: "Start a fresh conversation.",
        continuity: guest.continuity,
      }),
    }),
    env,
  );
  const terminalBody = await terminal.json();
  assert.equal(terminal.status, 409);
  assert.equal(terminalBody.reload, true);
  assert.equal(terminalBody.resetGuest, true);
  assert.ok(
    typeof terminalBody.guestResetGrant === "string" &&
      terminalBody.guestResetGrant.length < 4_096,
  );
  assert.equal(terminal.headers.get("set-cookie"), null);

  const otherGuest = await guestIdentity(env);
  const grant = terminalBody.guestResetGrant;
  const tamperedGrant = `${grant.slice(0, -1)}${
    grant.endsWith("A") ? "B" : "A"
  }`;
  const [tampered, wrongBinding] = await Promise.all([
    resetRequest({ grant: tamperedGrant }),
    resetRequest({
      cookie: otherGuest.cookie,
      continuity: otherGuest.continuity.token,
      grant,
    }),
  ]);
  assert.equal(tampered.status, 204);
  assert.equal(wrongBinding.status, 204);
  assert.equal(tampered.headers.get("set-cookie"), null);
  assert.equal(wrongBinding.headers.get("set-cookie"), null);

  const revoked = await resetRequest({ grant });
  const replacementCookie = responseCookie(
    revoked.headers.get("set-cookie"),
    GUEST_COOKIE_NAME,
  );
  const replacement = await readGuestSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: replacementCookie },
    }),
    env,
  );
  assert.equal(revoked.status, 204);
  assert.ok(replacement);
  assert.notEqual(replacement.guestKey, guest.session.guestKey);
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
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
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
    assert.equal(memory.states.size, 1);
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
    assert.equal(memory.states.get(identity.objectName).modelLease, null);
    assert.deepEqual(memory.states.get(identity.objectName).fixedExchanges, []);
    assert.equal(providerCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an immediate-danger reply does not wait for account validation that never resolves", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalled = false;
  let validationReached;
  const reachedValidation = new Promise((resolve) => {
    validationReached = resolve;
  });
  const baseMemory = createSessionNamespace();
  const hangingMemory = {
    states: baseMemory.states,
    getByName(name) {
      const stub = baseMemory.getByName(name);
      return {
        ...stub,
        async validateSession() {
          validationReached();
          return new Promise(() => {});
        },
      };
    },
  };
  const guestMemory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: hangingMemory,
    GUEST_SESSIONS: guestMemory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const identity = await authenticatedIdentity(
    env,
    "urgent-never-resolving-validation",
  );
  globalThis.fetch = async () => {
    providerCalled = true;
    return responseWithText("This provider response must not be used.");
  };

  let timeout;
  try {
    const response = await Promise.race([
      worker.fetch(
        new Request("https://stabilize.test/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://stabilize.test",
            "Sec-Fetch-Site": "same-origin",
            Cookie: identity.cookie,
          },
          body: JSON.stringify({
            message: "I am going to kill myself tonight",
            continuity: identity.continuity,
          }),
        }),
        env,
        { waitUntil() {} },
      ),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Urgent response waited for validation")),
          500,
        );
      }),
    ]);
    const body = await response.json();
    await reachedValidation;
    const accountState = hangingMemory.states.get(identity.objectName);

    assert.equal(response.status, 200);
    assert.equal(body.route, "IMMEDIATE_DANGER");
    assert.equal(body.showEmergency, true);
    assert.deepEqual(body.continuity, identity.continuity);
    assert.equal(providerCalled, false);
    assert.ok(accountState);
    assert.equal(accountState.turnCount, 0);
    assert.deepEqual(accountState.recent, []);
    assert.deepEqual(accountState.fixedExchanges, []);
    assert.equal(accountState.modelLease, null);
    assert.equal(guestMemory.states.size, 0);
  } finally {
    clearTimeout(timeout);
    globalThis.fetch = originalFetch;
  }
});

test("an urgent stale-guest request returns promptly but cannot write across an active account", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalled = false;
  const tasks = [];
  const accountMemory = createSessionNamespace();
  const guestMemory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: accountMemory,
    GUEST_SESSIONS: guestMemory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const guest = await guestIdentity(env);
  const account = await authenticatedIdentity(
    env,
    "urgent-active-account-stale-guest",
  );
  globalThis.fetch = async () => {
    providerCalled = true;
    return responseWithText("This provider response must not be used.");
  };

  let timeout;
  try {
    const response = await Promise.race([
      worker.fetch(
        new Request("https://stabilize.test/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://stabilize.test",
            "Sec-Fetch-Site": "same-origin",
            Cookie: `${guest.cookie}; ${account.cookie}`,
          },
          body: JSON.stringify({
            message: "I am going to kill myself tonight",
            continuity: guest.continuity,
          }),
        }),
        env,
        {
          waitUntil(task) {
            tasks.push(task);
          },
        },
      ),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Urgent response waited for identity validation")),
          500,
        );
      }),
    ]);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.route, "IMMEDIATE_DANGER");
    assert.equal(body.showEmergency, true);
    assert.deepEqual(body.continuity, guest.continuity);
    assert.equal(providerCalled, false);
    assert.equal(tasks.length, 1);

    await Promise.all(tasks);
    const accountState = accountMemory.states.get(account.objectName);
    assert.ok(accountState);
    assert.equal(accountState.turnCount, 0);
    assert.deepEqual(accountState.recent, []);
    assert.deepEqual(accountState.fixedExchanges, []);
    assert.equal(accountState.modelLease, null);
    assert.equal(guestMemory.states.size, 0);
  } finally {
    clearTimeout(timeout);
    globalThis.fetch = originalFetch;
  }
});

test("a signed-in fixed safety route stores only a generalized event", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "safety-route-user");
  memory.getByName(identity.objectName);
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
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
  assert.equal(state.fixedExchanges.length, 1);
  assert.doesNotMatch(state.fixedExchanges[0].user, /kill myself/i);
  assert.equal(state.turnCount, 1);
});

test("a fixed safety reply does not wait for a hanging memory write", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "safety-storage-hang");
  memory.getByName(identity.objectName);
  memory.states.get(identity.objectName).hangFixedWrites = true;

  let timeout;
  try {
    const response = await Promise.race([
      worker.fetch(
        new Request("https://stabilize.test/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
            Cookie: identity.cookie,
          },
          body: JSON.stringify({
            message: "I am going to kill myself tonight",
            continuity: identity.continuity,
          }),
        }),
        env,
        { waitUntil() {} },
      ),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Safety response waited for memory")),
          500,
        );
      }),
    ]);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.route, "IMMEDIATE_DANGER");
    assert.equal(body.showEmergency, true);
  } finally {
    clearTimeout(timeout);
  }
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
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
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
          Origin: "https://stabilize.test",
          "Sec-Fetch-Site": "same-origin",
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

import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { COPY } from "../src/copy.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

const GOOGLE_CLIENT_ID =
  "1234567890-stabilize-tests.apps.googleusercontent.com";
const AUTH_SECRET = "test-auth-secret-with-at-least-thirty-two-characters";

function freshState() {
  return {
    summary: "",
    summaryVersion: 0,
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
    nextSequence: 1,
  };
}

function createSessionNamespace() {
  const states = new Map();

  return {
    states,
    getByName(name) {
      if (!states.has(name)) states.set(name, freshState());

      return {
        async readContext() {
          const state = states.get(name) || freshState();
          return {
            summary: state.summary,
            recent: state.recent.map(({ role, content }) => ({ role, content })),
            awaitingSafetyAnswer: state.awaitingSafetyAnswer,
            turnCount: state.turnCount,
            updatedAt: state.updatedAt,
          };
        },
        async recordExchange(exchange) {
          const state = states.get(name) || freshState();
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
          state.awaitingSafetyAnswer =
            exchange.awaitingSafetyAnswer === true;
          state.turnCount += 1;
          state.updatedAt = Date.now();
          states.set(name, state);
          return {
            shouldCompact: state.recent.length >= 2,
            turnCount: state.turnCount,
          };
        },
        async startNewConversation() {
          const state = states.get(name) || freshState();
          state.recent = [];
          state.awaitingSafetyAnswer = false;
          states.set(name, state);
          return { started: true };
        },
        async getCompactionSnapshot() {
          const state = states.get(name) || freshState();
          if (state.recent.length < 2) return null;
          return {
            summary: state.summary,
            summaryVersion: state.summaryVersion,
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
    OPENAI_ADAPTIVE_ROUTING: "false",
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    AUTH_SECRET,
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
  return { cookie, objectName: `google:${session.accountKey}` };
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
    memory: true,
    authentication: true,
    reasoningEffort: "max",
    verbosity: "low",
  });
});

test("new conversation clears the active thread without deleting account memory", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "new-conversation-user");
  const stub = memory.getByName(identity.objectName);

  await stub.recordExchange({
    user: "I prefer concise plans.",
    assistant: "I will keep the next step short.",
    awaitingSafetyAnswer: false,
  });
  const snapshot = await stub.getCompactionSnapshot();
  await stub.applySummary(
    "The user prefers concise plans.",
    snapshot.summaryVersion,
    snapshot.throughSequence,
  );
  await stub.recordExchange({
    user: "This belongs to the current thread.",
    assistant: "Current-thread response.",
    awaitingSafetyAnswer: true,
  });

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/conversation/new", {
      method: "POST",
      headers: {
        Origin: "https://stabilize.test",
        Cookie: identity.cookie,
      },
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const context = await stub.readContext();
  assert.equal(context.summary, "The user prefers concise plans.");
  assert.deepEqual(context.recent, []);
  assert.equal(context.awaitingSafetyAnswer, false);
  assert.equal(context.turnCount, 2);
});

test("guest new conversation creates no server-side memory", async () => {
  const memory = createSessionNamespace();
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/conversation/new", {
      method: "POST",
      headers: { Origin: "https://stabilize.test" },
    }),
    createEnv({ SESSIONS: memory }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(memory.states.size, 0);
});

test("cross-origin new conversation requests are rejected", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/conversation/new", {
      method: "POST",
      headers: { Origin: "https://untrusted.example" },
    }),
    createEnv(),
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, COPY.api.crossOriginRequest);
});

test("private chat neither reads nor writes signed-in memory", async () => {
  const originalFetch = globalThis.fetch;
  const memory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: memory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const identity = await authenticatedIdentity(env, "private-chat-user");
  const stub = memory.getByName(identity.objectName);

  await stub.recordExchange({
    user: "I prefer remembered concise plans.",
    assistant: "I will remember that preference.",
    awaitingSafetyAnswer: false,
  });
  const snapshot = await stub.getCompactionSnapshot();
  await stub.applySummary(
    "The user prefers remembered concise plans.",
    snapshot.summaryVersion,
    snapshot.throughSequence,
  );
  await stub.recordExchange({
    user: "Remember this active thread.",
    assistant: "This is remembered recent context.",
    awaitingSafetyAnswer: false,
  });
  const before = JSON.parse(JSON.stringify(memory.states.get(identity.objectName)));

  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Private reply without account context.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "Answer this without using or updating memory.",
          privateChat: true,
        }),
      }),
      env,
    );

    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, "Private reply without account context.");
    assert.equal(providerBody.input.length, 2);
    assert.equal(providerBody.input[0].role, "system");
    assert.equal(providerBody.input.at(-1).role, "user");
    assert.equal(
      providerBody.input.at(-1).content,
      "Answer this without using or updating memory.",
    );
    assert.doesNotMatch(
      JSON.stringify(providerBody.input),
      /I prefer remembered concise plans|Remember this active thread|This is remembered recent context/i,
    );
    assert.deepEqual(memory.states.get(identity.objectName), before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("private fixed routes do not enter signed-in memory", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "private-fixed-route-user");
  const stub = memory.getByName(identity.objectName);
  await stub.recordExchange({
    user: "Existing account context.",
    assistant: "Existing remembered response.",
    awaitingSafetyAnswer: false,
  });
  const before = JSON.parse(JSON.stringify(memory.states.get(identity.objectName)));

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://stabilize.test",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({
        message: "I am going to kill myself tonight",
        privateChat: true,
      }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).route, "IMMEDIATE_DANGER");
  assert.deepEqual(memory.states.get(identity.objectName), before);
});

test("starting a new private thread does not alter account memory", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "private-reset-user");
  const stub = memory.getByName(identity.objectName);
  await stub.recordExchange({
    user: "Keep this remembered thread intact.",
    assistant: "This remains in account memory.",
    awaitingSafetyAnswer: true,
  });
  const before = JSON.parse(JSON.stringify(memory.states.get(identity.objectName)));

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/conversation/new", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://stabilize.test",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({ privateChat: true }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(memory.states.get(identity.objectName), before);
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
    assert.deepEqual(providerBody.reasoning, { effort: "max" });
    assert.deepEqual(providerBody.text, { verbosity: "low" });
    assert.equal(providerBody.store, true);
    assert.equal("max_output_tokens" in providerBody, false);
    assert.equal(providerBody.prompt_cache_key, "stabilize-floor-first-v1");
    assert.deepEqual(providerBody.prompt_cache_options, {
      mode: "explicit",
      ttl: "30m",
    });
    assert.equal(providerBody.input[0].role, "system");
    assert.equal(providerBody.input.at(-1).role, "user");
    assert.equal(
      providerBody.input.at(-1).content,
      "Help me plan one next step.",
    );
    const stableInstructions = providerBody.input[0].content[0].text;
    const variableInstructions = providerBody.input[0].content[1].text;
    assert.match(variableInstructions, /route ORDINARY/i);
    assert.match(stableInstructions, /Floor supports; answer leads/i);
    assert.match(stableInstructions, /current evidence wins/i);
    assert.match(stableInstructions, /Systems > willpower/i);
    assert.ok(COPY.model.systemPrompt.length < 3_200);
    assert.match(stableInstructions, /220 words or fewer/i);
    assert.match(stableInstructions, /document-ready content/i);
    assert.match(variableInstructions, /PRIOR CONTEXT MEMORY/i);

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
        body: JSON.stringify({
          message:
            "I am deciding whether to accept a job in Madison or Milwaukee. Compare pay, housing costs, commute, career growth, and stability.",
        }),
      }),
      createEnv({
        DEMO_MODE: "false",
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_MODEL: "gpt-5.1",
        OPENAI_REASONING_EFFORT: "max",
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(providerBody.reasoning, { effort: "high" });
    assert.deepEqual(providerBody.text, { verbosity: "low" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy internal model alias maps to the supported API model", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Hi. What’s happening right now?");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hi" }),
      }),
      createEnv({
        DEMO_MODE: "false",
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_MODEL: ["gpt-5.6", "sol"].join("-"),
      }),
    );

    assert.equal(response.status, 200);
    await response.json();
    assert.equal(providerBody.model, "gpt-5.6-sol");
    assert.deepEqual(providerBody.reasoning, { effort: "max" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("complex decisions use the strongest supported reasoning", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Compare the options against the factors that matter most.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:
            "I am deciding whether to accept a job in Madison or Milwaukee. Compare pay, housing costs, commute, career growth, and stability.",
        }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(providerBody.reasoning, { effort: "max" });
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

test("remembered summary is supplied as untrusted context", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
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
  const snapshot = await stub.getCompactionSnapshot();
  await stub.applySummary(
    "The user prefers short plans.",
    snapshot.summaryVersion,
    snapshot.throughSequence,
  );

  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Take one five-minute step.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({ message: "What should I do next?" }),
      }),
      env,
    );

    assert.equal(response.status, 200);
    assert.equal(providerBody.input[0].role, "system");
    const conversationInput = providerBody.input.slice(1);
    assert.match(conversationInput[0].content, /PRIOR CONTEXT MEMORY/);
    assert.match(conversationInput[0].content, /prefers short plans/);
    assert.match(
      conversationInput.at(-1).content,
      /What should I do next\?$/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recent turns compact in the background with OpenAI storage enabled", async () => {
  const originalFetch = globalThis.fetch;
  const providerBodies = [];
  const tasks = [];
  const memory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: memory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const identity = await authenticatedIdentity(env, "google-user-two");

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    providerBodies.push(body);
    if (body.instructions === COPY.model.summaryPrompt) {
      return responseWithText("The user wants a small next step for a current task.");
    }
    return responseWithText("Write down the first five-minute action.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "198.51.100.9",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({ message: "Help me start this task." }),
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

    const context = await memory.getByName(identity.objectName).readContext();
    assert.equal(
      context.summary,
      "The user wants a small next step for a current task.",
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
        "Content-Length": "256001",
      },
      body: "{}",
    }),
    createEnv(),
  );

  assert.equal(response.status, 413);
});

test("cross-origin chat and logout posts are rejected", async () => {
  const env = createEnv();
  const [chatResponse, logoutResponse] = await Promise.all([
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
  ]);

  assert.equal(chatResponse.status, 403);
  assert.equal((await chatResponse.json()).error, COPY.api.crossOriginRequest);
  assert.equal(logoutResponse.status, 403);
  assert.equal(await logoutResponse.text(), COPY.api.crossOriginRequest);
  assert.equal(logoutResponse.headers.get("set-cookie"), null);
});

test("the public API does not expose account-memory deletion", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "google-user-three");
  await memory.getByName(identity.objectName).recordExchange({
    user: "Remember this.",
    assistant: "Okay.",
    awaitingSafetyAnswer: false,
  });

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/memory", {
      method: "DELETE",
      headers: { Cookie: identity.cookie },
    }),
    env,
  );

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, COPY.api.notFound);
  assert.equal(
    (await memory.getByName(identity.objectName).readContext()).turnCount,
    1,
  );
});

test("favicon endpoints return browser-compatible content types", async () => {
  const cases = [
    ["/favicon.ico", "image/x-icon"],
    ["/favicon.svg", "image/svg+xml; charset=utf-8"],
    ["/favicon-16x16.png", "image/png"],
    ["/favicon-32x32.png", "image/png"],
    ["/apple-touch-icon.png", "image/png"],
    ["/stabilize-tab-20260805.ico", "image/x-icon"],
    ["/stabilize-tab-20260805-16.png", "image/png"],
    ["/stabilize-tab-20260805-32.png", "image/png"],
    ["/stabilize-app-20260805-180.png", "image/png"],
    ["/safari-pinned-tab.svg", "image/svg+xml; charset=utf-8"],
    ["/site.webmanifest", "application/manifest+json; charset=utf-8"],
  ];

  for (const [path, contentType] of cases) {
    const response = await worker.fetch(
      new Request("https://stabilize.test" + path),
      createEnv(),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), contentType);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
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
  assert.doesNotMatch(html, /id="reset-button"|Start over/);
  assert.doesNotMatch(html, /id="status-line"/);
  assert.doesNotMatch(html, /quick-actions|data-prompt/);

  const menuIndex = html.indexOf('class="menu-panel"');
  const infoIndex = html.indexOf(COPY.page.chat.infoDetails, menuIndex);
  const outputIndex = html.indexOf('id="chat-log"');
  const noteIndex = html.indexOf(COPY.page.chat.supportNote);
  const composerIndex = html.indexOf('id="chat-form"');
  assert.ok(menuIndex >= 0 && menuIndex < infoIndex);
  assert.ok(infoIndex < outputIndex);
  assert.ok(outputIndex >= 0 && outputIndex < noteIndex);
  assert.ok(noteIndex < composerIndex);
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

  assert.equal(response.status, 200);
  assert.equal(memory.states.size, 0);
  assert.equal(response.headers.get("set-cookie"), null);
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
      body: JSON.stringify({ message: "I have not eaten all day" }),
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
  });
  assert.ok(html.includes(COPY.page.auth.signedIn));
  assert.ok(html.includes(COPY.page.auth.signOut));
  assert.match(html, /action="\/auth\/logout" method="post"/);
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

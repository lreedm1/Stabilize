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
  "1234567890-memory-controls.apps.googleusercontent.com";
const AUTH_SECRET = "memory-controls-test-secret-with-thirty-two-characters";

function freshState() {
  return {
    generation: 0,
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
  };
}

function createSessionNamespace() {
  const states = new Map();
  return {
    states,
    getByName(name) {
      if (!states.has(name)) states.set(name, freshState());
      return {
        async readContextForRequest() {
          const state = states.get(name) || freshState();
          return {
            summary: state.summary,
            recent: state.recent,
            awaitingSafetyAnswer: state.awaitingSafetyAnswer,
            turnCount: state.turnCount,
            updatedAt: state.updatedAt,
            generation: state.generation,
          };
        },
        async readContext() {
          const { generation: _generation, ...context } =
            await this.readContextForRequest();
          return context;
        },
        async recordExchange(exchange) {
          const state = states.get(name) || freshState();
          const expected = Number(exchange.expectedGeneration);
          if (Number.isSafeInteger(expected) && expected !== state.generation) {
            return {
              recorded: false,
              stale: true,
              shouldCompact: false,
              turnCount: state.turnCount,
              generation: state.generation,
            };
          }
          state.recent = [
            ...state.recent,
            { role: "user", content: exchange.user },
            { role: "assistant", content: exchange.assistant },
          ].slice(-8);
          state.awaitingSafetyAnswer = exchange.awaitingSafetyAnswer === true;
          state.turnCount += 1;
          state.updatedAt = Date.now();
          states.set(name, state);
          return {
            recorded: true,
            stale: false,
            shouldCompact: false,
            turnCount: state.turnCount,
            generation: state.generation,
          };
        },
        async deleteRememberedContext() {
          const state = states.get(name) || freshState();
          state.summary = "";
          state.recent = [];
          state.awaitingSafetyAnswer = false;
          state.turnCount = 0;
          state.updatedAt = null;
          state.generation += 1;
          states.set(name, state);
          return { deleted: true, generation: state.generation };
        },
        async startNewConversation() {
          const state = states.get(name) || freshState();
          state.recent = [];
          state.awaitingSafetyAnswer = false;
          states.set(name, state);
          return { started: true };
        },
        async getCompactionSnapshot() {
          return null;
        },
      };
    },
  };
}

function createEnv(overrides = {}) {
  let billingCalls = 0;
  const env = {
    ASSETS: { fetch: async () => new Response("asset") },
    SESSIONS: createSessionNamespace(),
    BILLING: {
      getByName() {
        billingCalls += 1;
        return {};
      },
    },
    DEMO_MODE: "true",
    OPENAI_MODEL: "gpt-5.4",
    OPENAI_REASONING_EFFORT: "none",
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "test-google-secret",
    AUTH_SECRET,
    PUBLIC_ORIGIN: "https://stabilize.test",
    ...overrides,
  };
  return { env, billingCalls: () => billingCalls };
}

async function identity(env, subject) {
  const token = await createAuthSessionTokenForGoogleSubject(subject, env);
  const cookie = `${AUTH_COOKIE_NAME}=${token}`;
  const session = await readAuthSession(
    new Request("https://stabilize.test/", { headers: { Cookie: cookie } }),
    env,
  );
  return { cookie, objectName: `google:${session.accountKey}` };
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

test("memory deletion requires the signed-in same-origin account and leaves billing alone", async () => {
  const setup = createEnv();
  const account = await identity(setup.env, "delete-memory-user");
  const stub = setup.env.SESSIONS.getByName(account.objectName);
  await stub.recordExchange({
    user: "Remember this.",
    assistant: "Remembered.",
    awaitingSafetyAnswer: true,
    expectedGeneration: 0,
  });

  const unsigned = await worker.fetch(
    new Request("https://stabilize.test/api/account/memory", {
      method: "DELETE",
      headers: { Origin: "https://stabilize.test" },
    }),
    setup.env,
  );
  assert.equal(unsigned.status, 401);
  assert.equal((await unsigned.json()).error, COPY.api.signInRequired);

  const crossOrigin = await worker.fetch(
    new Request("https://stabilize.test/api/account/memory", {
      method: "DELETE",
      headers: {
        Origin: "https://untrusted.example",
        Cookie: account.cookie,
      },
    }),
    setup.env,
  );
  assert.equal(crossOrigin.status, 403);

  const deleted = await worker.fetch(
    new Request("https://stabilize.test/api/account/memory", {
      method: "DELETE",
      headers: {
        Origin: "https://stabilize.test",
        Cookie: account.cookie,
      },
    }),
    setup.env,
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), {
    ok: true,
    deleted: true,
    generation: 1,
  });
  assert.deepEqual(await stub.readContext(), {
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
  });
  assert.equal(setup.billingCalls(), 0);
});

test("a reply started before deletion cannot recreate account memory", async () => {
  const setup = createEnv({
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const account = await identity(setup.env, "stale-write-user");
  const stub = setup.env.SESSIONS.getByName(account.objectName);
  await stub.recordExchange({
    user: "Old context.",
    assistant: "Old reply.",
    awaitingSafetyAnswer: false,
    expectedGeneration: 0,
  });

  const originalFetch = globalThis.fetch;
  let releaseProvider;
  let providerStarted;
  const started = new Promise((resolve) => {
    providerStarted = resolve;
  });
  const gate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  globalThis.fetch = async () => {
    providerStarted();
    await gate;
    return responseWithText("Late reply.");
  };

  try {
    const chatPromise = worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          Cookie: account.cookie,
        },
        body: JSON.stringify({ message: "Generate a reply." }),
      }),
      setup.env,
    );
    await started;

    const deletion = await worker.fetch(
      new Request("https://stabilize.test/api/account/memory", {
        method: "DELETE",
        headers: {
          Origin: "https://stabilize.test",
          Cookie: account.cookie,
        },
      }),
      setup.env,
    );
    assert.equal(deletion.status, 200);
    releaseProvider();

    const chat = await chatPromise;
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).reply, "Late reply.");
    assert.deepEqual(await stub.readContext(), {
      summary: "",
      recent: [],
      awaitingSafetyAnswer: false,
      turnCount: 0,
      updatedAt: null,
    });
    assert.equal((await stub.readContextForRequest()).generation, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("signed-out follow-ups use bounded browser-supplied context without server memory", async () => {
  const setup = createEnv({
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Second reply with context.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
        },
        body: JSON.stringify({
          message: "What should I do next?",
          messages: [
            { role: "user", content: "I need to call the pharmacy." },
            { role: "assistant", content: "Write down the medication name." },
            { role: "user", content: "What should I do next?" },
          ],
        }),
      }),
      setup.env,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(providerBody.input, [
      { role: "user", content: "I need to call the pharmacy." },
      { role: "assistant", content: "Write down the medication name." },
      { role: "user", content: "What should I do next?" },
    ]);
    assert.equal(setup.env.SESSIONS.states.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

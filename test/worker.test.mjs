import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { COPY } from "../src/copy.js";

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
    OPENAI_REASONING_EFFORT: "medium",
    ...overrides,
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
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
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
  const token = "44444444-4444-4444-8444-444444444444";

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
          Cookie: "stabilize_session=" + token,
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

    const providerBody = JSON.parse(providerRequest.init.body);
    assert.equal(providerBody.model, "gpt-5.6-sol");
    assert.deepEqual(providerBody.reasoning, {
      effort: "medium",
      context: "current_turn",
    });
    assert.equal(providerBody.store, false);
    assert.equal(providerBody.max_output_tokens, 500);
    assert.equal(providerBody.input[0].role, "user");
    assert.equal(providerBody.input[0].content, "Help me plan one next step.");
    assert.match(providerBody.instructions, /route ORDINARY/i);
    assert.match(providerBody.instructions, /Floor supports; answer leads/i);
    assert.match(providerBody.instructions, /current evidence wins/i);
    assert.match(providerBody.instructions, /Systems > willpower/i);
    assert.match(providerBody.instructions, /PRIOR CONTEXT MEMORY/i);

    const logged = logs.join("\n");
    assert.match(logged, /"event":"chat_session"/);
    assert.match(logged, /"ipAlias":"[a-f0-9]{24}"/);
    assert.doesNotMatch(logged, /203\.0\.113\.7/);
    assert.doesNotMatch(logged, /Help me plan one next step/);
    assert.doesNotMatch(logged, new RegExp(token));
    assert.doesNotMatch(logged, /"route"/);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test("remembered summary is supplied as untrusted context", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  const token = "11111111-1111-4111-8111-111111111111";
  const memory = createSessionNamespace();
  const stub = memory.getByName(token);

  await stub.recordExchange({
    user: "I prefer short plans.",
    assistant: "I will keep the next step small.",
    awaitingSafetyAnswer: false,
    ipAlias: null,
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
          Cookie: "stabilize_session=" + token,
        },
        body: JSON.stringify({ message: "What should I do next?" }),
      }),
      createEnv({
        SESSIONS: memory,
        DEMO_MODE: "false",
        OPENAI_API_KEY: "test-openai-key",
      }),
    );

    assert.equal(response.status, 200);
    assert.match(providerBody.input[0].content, /PRIOR CONTEXT MEMORY/);
    assert.match(providerBody.input[0].content, /prefers short plans/);
    assert.match(
      providerBody.input.at(-1).content,
      /What should I do next\?$/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recent turns compact in the background without OpenAI storage", async () => {
  const originalFetch = globalThis.fetch;
  const providerBodies = [];
  const tasks = [];
  const token = "22222222-2222-4222-8222-222222222222";
  const memory = createSessionNamespace();

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
          Cookie: "stabilize_session=" + token,
        },
        body: JSON.stringify({ message: "Help me start this task." }),
      }),
      createEnv({
        SESSIONS: memory,
        DEMO_MODE: "false",
        OPENAI_API_KEY: "test-openai-key",
      }),
      {
        waitUntil(promise) {
          tasks.push(promise);
        },
      },
    );

    assert.equal(response.status, 200);
    await Promise.all(tasks);

    const context = await memory.getByName(token).readContext();
    assert.equal(
      context.summary,
      "The user wants a small next step for a current task.",
    );
    assert.deepEqual(context.recent, []);
    assert.equal(providerBodies.length, 2);
    assert.ok(providerBodies.every((body) => body.store === false));
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
        "Content-Length": "32001",
      },
      body: "{}",
    }),
    createEnv(),
  );

  assert.equal(response.status, 413);
});

test("the public API does not expose session deletion", async () => {
  const token = "33333333-3333-4333-8333-333333333333";
  const memory = createSessionNamespace();
  await memory.getByName(token).recordExchange({
    user: "Remember this.",
    assistant: "Okay.",
    awaitingSafetyAnswer: false,
    ipAlias: null,
  });

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/session", {
      method: "DELETE",
      headers: { Cookie: "stabilize_session=" + token },
    }),
    createEnv({ SESSIONS: memory }),
  );

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, COPY.api.notFound);
  assert.equal((await memory.getByName(token).readContext()).turnCount, 1);
});

test("root page renders memory disclosure without an erase control", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/"),
    createEnv(),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /font-src 'self'/);
  assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
  assert.ok(html.includes(COPY.page.chat.introBlurb));
  assert.ok(COPY.page.chat.introBlurb.length < 300);
  assert.doesNotMatch(html, /forget-memory|Forget remembered context/);
  assert.ok(html.includes('id="terrain-background"'));
  assert.ok(html.includes('placeholder="' + COPY.page.chat.inputPlaceholder + '"'));
  assert.match(html, /id="conversation-surface"[\s\S]*data-view="compose"/);
  assert.ok(html.includes(COPY.page.chat.responseLabel));
  assert.match(html, /rel="preload"[\s\S]*lexend-latin-wght-normal\.woff2/);
  assert.ok(html.includes('id="client-copy"'));
  assert.doesNotMatch(html, /id="reset-button"|Start over/);
  assert.doesNotMatch(html, /id="status-line"/);
  assert.doesNotMatch(html, /quick-actions|data-prompt/);

  const outputIndex = html.indexOf('id="chat-log"');
  const blurbIndex = html.indexOf(COPY.page.chat.introBlurb);
  const composerIndex = html.indexOf('id="chat-form"');
  assert.ok(outputIndex >= 0 && outputIndex < blurbIndex);
  assert.ok(blurbIndex < composerIndex);
  assert.doesNotMatch(html.slice(outputIndex, composerIndex), /\shidden(?:\s|>)/);

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
  assert.equal(clientCopy.memoryCleared, undefined);
  assert.equal(clientCopy.dangerReply, COPY.client.dangerReply);
});

test("static asset requests pass through to the asset binding", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/styles.css"),
    createEnv(),
  );
  assert.equal(await response.text(), "asset");
});

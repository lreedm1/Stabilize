import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function responseWithText(text, status = 200) {
  return Response.json(
    status === 200
      ? {
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text, annotations: [] }],
            },
          ],
        }
      : { error: { code: "test_failure", type: "server_error" } },
    { status },
  );
}

function createEnv() {
  const states = new Map();
  return {
    env: {
      ASSETS: { fetch: async () => new Response("asset") },
      SESSIONS: {
        states,
        getByName(name) {
          states.set(name, true);
          throw new Error("Guest chat must not create server memory");
        },
      },
      DEMO_MODE: "false",
      OPENAI_API_KEY: "test-openai-key",
      OPENAI_MODEL: "gpt-5.4",
      OPENAI_REASONING_EFFORT: "none",
      OPENAI_SERVICE_TIER: "fast",
      PUBLIC_ORIGIN: "https://stabilize.test",
    },
    states,
  };
}

function guestRequest(overrides = {}) {
  const messages = [];
  for (let turn = 1; turn <= 10; turn += 1) {
    messages.push({
      role: "user",
      content: "Earlier user turn " + turn + ": detail " + turn + ".",
    });
    messages.push({
      role: "assistant",
      content: "Earlier assistant turn " + turn + ": response " + turn + ".",
    });
  }

  return new Request("https://stabilize.test/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://stabilize.test",
    },
    body: JSON.stringify({
      message: "What did I say in the first turn?",
      messages,
      ...overrides,
    }),
  });
}

test("guest replies receive every current-tab turn in one model request", async () => {
  const setup = createEnv();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(init.body);
    calls.push(payload);
    return responseWithText("You said detail 1 in the first turn.");
  };

  try {
    const response = await worker.fetch(guestRequest(), setup.env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reply, "You said detail 1 in the first turn.");
    assert.equal(calls.length, 1);

    const replyInput = JSON.stringify(calls[0].input);
    assert.match(replyInput, /Earlier user turn 1: detail 1/);
    assert.match(replyInput, /Earlier assistant turn 10: response 10/);
    assert.match(replyInput, /What did I say in the first turn/);
    assert.equal(setup.states.size, 0);
    assert.equal("guestSummaryUpdated" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy v2 guest context is carried forward without another summary call", async () => {
  const setup = createEnv();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(init.body);
    calls.push(payload);
    return responseWithText("Call before six with the bottle ready.");
  };

  try {
    const response = await worker.fetch(
      guestRequest({
        guestSummary: "The user planned to call the pharmacy.",
        guestSummaryMessages: [
          { role: "user", content: "The pharmacy closes at six." },
          { role: "assistant", content: "Keep the bottle ready." },
        ],
      }),
      setup.env,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reply, "Call before six with the bottle ready.");
    assert.equal(calls.length, 1);

    const replyInput = JSON.stringify(calls[0].input);
    assert.match(replyInput, /LEGACY GUEST SUMMARY/);
    assert.match(replyInput, /pharmacy closes at six/i);
    assert.equal("guestSummaryUpdated" in body, false);
    assert.equal(setup.states.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

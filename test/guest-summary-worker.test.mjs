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

function guestRequest() {
  return new Request("https://stabilize.test/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://stabilize.test",
    },
    body: JSON.stringify({
      message: "What should I do next?",
      guestSummary: "Earlier, the user planned to call the pharmacy.",
      guestSummaryMessages: [
        { role: "user", content: "The pharmacy closes at six." },
        { role: "assistant", content: "Put the medication name by the phone." },
      ],
      messages: [
        { role: "user", content: "I found the medication bottle." },
        { role: "assistant", content: "Keep it beside you for the call." },
      ],
    }),
  });
}

test("guest replies use the rolling summary and return a 5,000-token summary update without server memory", async () => {
  const setup = createEnv();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(init.body);
    calls.push(payload);
    if (payload.max_output_tokens === 5_000) {
      return responseWithText(
        "The user plans to call the pharmacy before six and has the bottle ready.",
      );
    }
    return responseWithText("Call the pharmacy now with the bottle beside you.");
  };

  try {
    const response = await worker.fetch(guestRequest(), setup.env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reply, "Call the pharmacy now with the bottle beside you.");
    assert.equal(body.guestSummaryUpdated, true);
    assert.match(body.guestSummary, /before six/);

    assert.equal(calls.length, 2);
    const summaryCall = calls.find((call) => call.max_output_tokens === 5_000);
    const replyCall = calls.find((call) => call !== summaryCall);
    assert.ok(summaryCall);
    assert.ok(replyCall);
    assert.match(summaryCall.instructions, /rolling guest-conversation summary/i);
    assert.match(summaryCall.input[0].content, /pharmacy closes at six/i);

    const replyInput = JSON.stringify(replyCall.input);
    assert.match(replyInput, /GUEST ROLLING SUMMARY/);
    assert.match(replyInput, /OLDER GUEST MESSAGES AWAITING SUMMARY/);
    assert.match(replyInput, /I found the medication bottle/);
    assert.match(replyInput, /What should I do next/);
    assert.equal(setup.states.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed guest-summary request leaves the prior summary unacknowledged", async () => {
  const setup = createEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(init.body);
    if (payload.max_output_tokens === 5_000) {
      return responseWithText("", 500);
    }
    return responseWithText("The ordinary reply still works.");
  };

  try {
    const response = await worker.fetch(guestRequest(), setup.env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reply, "The ordinary reply still works.");
    assert.equal(body.guestSummaryUpdated, false);
    assert.equal(
      body.guestSummary,
      "Earlier, the user planned to call the pharmacy.",
    );
    assert.equal(setup.states.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

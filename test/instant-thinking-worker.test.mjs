import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function createEnv() {
  return {
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 }),
    },
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_MODEL: "gpt-5.4",
    OPENAI_REASONING_EFFORT: "none",
    PUBLIC_ORIGIN: "https://stabilize.test",
  };
}

function providerStream(answer) {
  const events = [
    { type: "response.created", response: { status: "in_progress" } },
    { type: "response.output_text.delta", delta: answer },
    { type: "response.output_text.done", text: answer },
    {
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: answer }],
          },
        ],
      },
    },
  ];
  const body = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

async function sendWithEffort(reasoningEffort) {
  return worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson, application/json",
      },
      body: JSON.stringify({
        message: "Help me compare two practical options.",
        reasoningEffort,
      }),
    }),
    createEnv(),
  );
}

test("the selected free thinking level is used exactly for every reply", async () => {
  const originalFetch = globalThis.fetch;
  const expectedEfforts = ["none", "low", "medium", "high", "xhigh"];
  const observed = [];

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(init.body);
    observed.push(request.reasoning?.effort);
    assert.equal(request.model, "gpt-5.4");
    assert.equal(request.stream, true);
    return providerStream("Use the more reversible option first.");
  };

  try {
    for (const effort of expectedEfforts) {
      const response = await sendWithEffort(effort);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /application\/x-ndjson/i);
      assert.match(await response.text(), /"type":"done"/);
    }
    assert.deepEqual(observed, expectedEfforts);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing or unsupported thinking values fall back to Respond instantly", async () => {
  const originalFetch = globalThis.fetch;
  const observed = [];

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(init.body);
    observed.push(request.reasoning?.effort);
    return providerStream("Start with one small action.");
  };

  try {
    for (const effort of [undefined, "unsupported", "max"]) {
      const response = await sendWithEffort(effort);
      assert.equal(response.status, 200);
      await response.text();
    }
    assert.deepEqual(observed, ["none", "none", "none"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

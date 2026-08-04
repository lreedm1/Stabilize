import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function createEnv(overrides = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 }),
    },
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_MODEL: "gpt-5.2",
    OPENAI_REASONING_EFFORT: "max",
    PUBLIC_ORIGIN: "https://stabilize.test",
    ...overrides,
  };
}

function outputResponse(text) {
  return Response.json({
    output: [
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

function providerSseResponse(events, { splitAt = [] } = {}) {
  const body = events
    .map(
      (event) =>
        `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`,
    )
    .join("");
  const bytes = new TextEncoder().encode(body);
  const points = [...splitAt, bytes.length]
    .filter((value, index, values) =>
      Number.isInteger(value) &&
      value > 0 &&
      value <= bytes.length &&
      (index === 0 || value > values[index - 1]),
    );

  return new Response(
    new ReadableStream({
      start(controller) {
        let offset = 0;
        for (const point of points) {
          controller.enqueue(bytes.slice(offset, point));
          offset = point;
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    },
  );
}

async function streamedChat(message) {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson, application/json",
      },
      body: JSON.stringify({ message }),
    }),
    createEnv(),
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") || "",
    /^application\/x-ndjson/i,
  );
  return (await response.text())
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("OpenAI SSE parsing accepts CRLF boundaries split across chunks", async () => {
  const originalFetch = globalThis.fetch;
  const answer = "Start with one small, concrete step.";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.stream, true);
    return providerSseResponse(
      [
        { type: "response.created", response: { status: "in_progress" } },
        { type: "response.output_text.delta", delta: "Start with " },
        { type: "response.output_text.delta", delta: "one small, concrete step." },
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
      ],
      { splitAt: [1, 17, 62, 109, 173] },
    );
  };

  try {
    const events = await streamedChat("Help me choose the first step.");
    assert.equal(events[0].type, "meta");
    assert.equal(
      events.filter((event) => event.type === "delta")
        .map((event) => event.delta)
        .join(""),
      answer,
    );
    assert.equal(events.at(-1).type, "done");
    assert.equal(events.at(-1).reply, answer);
    assert.equal(events.some((event) => event.type === "error"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a malformed provider stream recovers through one non-streaming request", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  const answer = "Use the smallest reversible action first.";
  let requests = 0;

  console.warn = (...values) => warnings.push(values.join(" "));
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const request = JSON.parse(init.body);
    if (requests === 1) {
      assert.equal(request.stream, true);
      return new Response("event: response.created\r\ndata: {not-json}\r\n\r\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    assert.equal("stream" in request, false);
    assert.deepEqual(request.reasoning, { effort: "medium" });
    return outputResponse(answer);
  };

  try {
    const events = await streamedChat("Help me start this task.");
    assert.equal(requests, 2);
    assert.equal(events.at(-1).type, "done");
    assert.equal(events.at(-1).reply, answer);
    assert.equal(events.some((event) => event.type === "error"), false);
    assert.match(warnings.join("\n"), /openai_stream_fallback_used/);
    assert.doesNotMatch(warnings.join("\n"), /Help me start this task/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

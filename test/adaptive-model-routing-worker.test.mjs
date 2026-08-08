import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function providerJson(text) {
  return Response.json({
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: { input_tokens: 40, output_tokens: 1 },
    service_tier: "fast",
  });
}

function providerStream(text) {
  const output = [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  ];
  const events = [
    { type: "response.created", response: { status: "in_progress" } },
    { type: "response.output_text.delta", delta: text },
    { type: "response.output_text.done", text },
    {
      type: "response.completed",
      response: {
        status: "completed",
        service_tier: "fast",
        usage: { input_tokens: 100, output_tokens: 10 },
        output,
      },
    },
  ];
  return new Response(
    events
      .map(
        (event) =>
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    },
  );
}

function adaptiveEnv(overrides = {}) {
  return {
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_MODEL: "gpt-5.6-luna",
    OPENAI_REASONING_EFFORT: "none",
    OPENAI_SERVICE_TIER: "fast",
    FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-luna",
    OPENAI_COMPLEX_MODEL: "gpt-5.6-sol",
    OPENAI_COMPLEXITY_MODEL: "gpt-5.6-luna",
    OPENAI_ADAPTIVE_ROUTING: "true",
    PUBLIC_ORIGIN: "https://stabilize.test",
    ...overrides,
  };
}

function chatRequest(message) {
  return new Request("https://stabilize.test/api/chat", {
    method: "POST",
    headers: {
      Accept: "application/x-ndjson, application/json",
      "Content-Type": "application/json",
      Origin: "https://stabilize.test",
    },
    body: JSON.stringify({ message }),
  });
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function ndjsonEvents(response) {
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") || "",
    /application\/x-ndjson/i,
  );
  return (await response.text())
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function isRouterRequest(body) {
  return (
    typeof body.instructions === "string" &&
    body.instructions.includes("internal model router")
  );
}

test("Luna and the complexity gate start together, then a simple reply stays on Luna", async () => {
  const originalFetch = globalThis.fetch;
  const luna = deferred();
  const router = deferred();
  const calls = [];

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    calls.push({ body, signal: init.signal });
    if (isRouterRequest(body)) return router.promise;
    if (body.model === "gpt-5.6-luna" && body.stream === true) {
      return luna.promise;
    }
    assert.fail(`Unexpected provider request: ${JSON.stringify(body)}`);
  };

  try {
    const response = await worker.fetch(
      chatRequest("Help me choose a quick breakfast."),
      adaptiveEnv(),
      {},
    );

    await waitFor(() => calls.length === 2, "parallel Luna and router calls");
    assert.equal(calls.filter((call) => isRouterRequest(call.body)).length, 1);
    assert.equal(
      calls.filter(
        (call) =>
          call.body.model === "gpt-5.6-luna" && call.body.stream === true,
      ).length,
      1,
    );

    luna.resolve(providerStream("Eat yogurt and fruit."));
    router.resolve(providerJson("LUNA"));
    const events = await ndjsonEvents(response);
    const deltas = events
      .filter((event) => event.type === "delta")
      .map((event) => event.delta)
      .join("");
    const done = events.findLast((event) => event.type === "done");

    assert.equal(deltas, "Eat yogurt and fruit.");
    assert.equal(done.reply, "Eat yogurt and fruit.");
    assert.equal(done.model, "gpt-5.6-luna");
    assert.equal(done.escalated, false);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a Sol decision aborts and discards Luna before any Luna text is emitted", async () => {
  const originalFetch = globalThis.fetch;
  const luna = deferred();
  const router = deferred();
  const calls = [];

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    const call = { body, signal: init.signal };
    calls.push(call);
    if (isRouterRequest(body)) return router.promise;
    if (body.model === "gpt-5.6-luna" && body.stream === true) {
      return luna.promise;
    }
    if (body.model === "gpt-5.6-sol" && body.stream === true) {
      return providerStream("SOL ANSWER");
    }
    assert.fail(`Unexpected provider request: ${JSON.stringify(body)}`);
  };

  try {
    const response = await worker.fetch(
      chatRequest(
        "Compare two housing options across lease risk, cost, commute, safety, and support, then recommend a reversible next step.",
      ),
      adaptiveEnv(),
      {},
    );

    await waitFor(() => calls.length === 2, "parallel Luna and router calls");
    const lunaCall = calls.find(
      (call) =>
        call.body.model === "gpt-5.6-luna" && call.body.stream === true,
    );
    assert.ok(lunaCall);

    luna.resolve(providerStream("LUNA MUST NEVER APPEAR"));
    router.resolve(providerJson("SOL"));
    const events = await ndjsonEvents(response);
    const deltas = events
      .filter((event) => event.type === "delta")
      .map((event) => event.delta)
      .join("");
    const done = events.findLast((event) => event.type === "done");

    assert.equal(deltas, "SOL ANSWER");
    assert.doesNotMatch(JSON.stringify(events), /LUNA MUST NEVER APPEAR/);
    assert.equal(done.reply, "SOL ANSWER");
    assert.equal(done.model, "gpt-5.6-sol");
    assert.equal(done.escalated, true);
    assert.equal(lunaCall.signal.aborted, true);
    assert.equal(
      calls.filter(
        (call) =>
          call.body.model === "gpt-5.6-sol" && call.body.stream === true,
      ).length,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deterministic urgent routes bypass both Luna and the complexity gate", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return providerJson("unexpected");
  };

  try {
    const response = await worker.fetch(
      chatRequest("I just overdosed and I am having trouble breathing."),
      adaptiveEnv(),
      {},
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.route, "MEDICAL_EMERGENCY");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an explicit Sol model does not invoke the adaptive complexity gate", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return providerStream("Explicit Sol reply.");
  };

  try {
    const response = await worker.fetch(
      chatRequest("Give me one next step."),
      adaptiveEnv({ OPENAI_MODEL: "gpt-5.6-sol" }),
      {},
    );
    const events = await ndjsonEvents(response);
    const done = events.findLast((event) => event.type === "done");
    assert.equal(done.model, "gpt-5.6-sol");
    assert.equal(bodies.length, 1);
    assert.equal(isRouterRequest(bodies[0]), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a Sol selection retries only Sol when Sol stream setup fails", async () => {
  const originalFetch = globalThis.fetch;
  const luna = deferred();
  const router = deferred();
  const calls = [];
  let solCalls = 0;

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    const call = { body, signal: init.signal };
    calls.push(call);
    if (isRouterRequest(body)) return router.promise;
    if (body.model === "gpt-5.6-luna" && body.stream === true) {
      return luna.promise;
    }
    if (body.model === "gpt-5.6-sol") {
      solCalls += 1;
      if (body.stream === true) {
        return Response.json(
          { error: { code: "temporary_provider_error", type: "server_error" } },
          { status: 500 },
        );
      }
      return providerJson("SOL RETRY ANSWER");
    }
    assert.fail(`Unexpected provider request: ${JSON.stringify(body)}`);
  };

  try {
    const response = await worker.fetch(
      chatRequest(
        "Compare these legal and financial options across multiple constraints and recommend the safest reversible path.",
      ),
      adaptiveEnv(),
      {},
    );

    await waitFor(() => calls.length === 2, "parallel Luna and router calls");
    const lunaCall = calls.find(
      (call) =>
        call.body.model === "gpt-5.6-luna" && call.body.stream === true,
    );
    assert.ok(lunaCall);

    router.resolve(providerJson("SOL"));
    const events = await ndjsonEvents(response);
    const deltas = events
      .filter((event) => event.type === "delta")
      .map((event) => event.delta)
      .join("");
    const done = events.findLast((event) => event.type === "done");

    assert.equal(deltas, "SOL RETRY ANSWER");
    assert.equal(done.reply, "SOL RETRY ANSWER");
    assert.equal(done.model, "gpt-5.6-sol");
    assert.equal(done.escalated, true);
    assert.equal(lunaCall.signal.aborted, true);
    assert.equal(solCalls, 2);
    assert.equal(
      calls.filter(
        (call) =>
          call.body.model === "gpt-5.6-luna" && call.body.stream === true,
      ).length,
      1,
    );
  } finally {
    luna.resolve(providerStream("DISCARDED LUNA"));
    globalThis.fetch = originalFetch;
  }
});

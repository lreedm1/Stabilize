import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function providerResponse(text, serviceTier = "priority") {
  return Response.json({
    service_tier: serviceTier,
    usage: {
      input_tokens: 1400,
      input_tokens_details: {
        cached_tokens: 1024,
        cache_write_tokens: 0,
      },
      output_tokens: 40,
    },
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

function chatRequest(message) {
  return new Request("https://stabilize.test/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ message }),
  });
}

function chatEnv(model = "gpt-5.6-sol") {
  return {
    ...env,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_MODEL: model,
    OPENAI_REASONING_EFFORT: "none",
    OPENAI_SERVICE_TIER: "fast",
    PUBLIC_ORIGIN: "https://stabilize.test",
  };
}

test("GPT-5.6 interactive requests use Fast mode, explicit caching, and adaptive output caps", async () => {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const bodies = [];
  const logs = [];
  console.info = (...values) => logs.push(values.join(" "));
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(init.body));
    return providerResponse("Take one reversible step.");
  };

  try {
    const ordinary = await worker.fetch(
      chatRequest("What should I do next?"),
      chatEnv(),
      {},
    );
    assert.equal(ordinary.status, 200);
    assert.equal((await ordinary.json()).reply, "Take one reversible step.");

    const longForm = await worker.fetch(
      chatRequest("Draft a detailed email explaining the situation."),
      chatEnv(),
      {},
    );
    assert.equal(longForm.status, 200);
    await longForm.json();

    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].service_tier, "fast");
    assert.equal(bodies[0].max_output_tokens, 360);
    assert.deepEqual(bodies[0].text, { verbosity: "low" });
    assert.equal(bodies[0].prompt_cache_key, "stabilize-floor-first-v1");
    assert.deepEqual(bodies[0].prompt_cache_options, {
      mode: "explicit",
      ttl: "30m",
    });
    assert.equal(bodies[0].instructions, undefined);
    assert.equal(bodies[0].input[0].type, "message");
    assert.equal(bodies[0].input[0].role, "system");
    assert.equal(bodies[0].input[0].content[0].type, "input_text");
    assert.deepEqual(
      bodies[0].input[0].content[0].prompt_cache_breakpoint,
      { mode: "explicit" },
    );
    assert.equal(bodies[1].max_output_tokens, 900);
    assert.match(logs.join("\n"), /"cachedTokens":1024/);
    assert.match(logs.join("\n"), /"actualServiceTier":"priority"/);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
  }
});

test("older GPT models keep their compatible prompt shape while using Fast mode", async () => {
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(init.body);
    return providerResponse("Use the first small step.");
  };

  try {
    const response = await worker.fetch(
      chatRequest("Give me one small step."),
      chatEnv("gpt-5.4"),
      {},
    );
    assert.equal(response.status, 200);
    await response.json();
    assert.equal(body.service_tier, "fast");
    assert.equal(typeof body.instructions, "string");
    assert.equal(body.prompt_cache_options, undefined);
    assert.equal(body.prompt_cache_key, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BillingAccount prepares model selection and quota reservation atomically", async () => {
  const stub = env.BILLING.getByName("priority-latency-prepare-chat-v1");
  const options = {
    allowedModels: ["gpt-5.4", "gpt-5.6-sol", "gpt-5.5"],
    defaultModel: "gpt-5.4",
    freeModel: "gpt-5.6-sol",
    fallbackModel: "gpt-5.4",
    paidPeriod: "2026-08",
    freePeriod: "2026-08-07",
    paidLimit: 2,
    freeLimit: 1,
  };

  const free = await stub.prepareChat(options);
  assert.equal(free.allowed, true);
  assert.equal(free.model, "gpt-5.6-sol");
  assert.equal(free.reservationMade, true);
  assert.equal(free.used, 1);

  const fallback = await stub.prepareChat(options);
  assert.equal(fallback.allowed, true);
  assert.equal(fallback.model, "gpt-5.4");
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.reservationMade, false);

  await stub.updateBilling({
    customerId: "cus_priority123",
    subscriptionId: "sub_priority123",
    subscriptionStatus: "active",
  });
  await stub.setSelectedModel("gpt-5.5");
  const paid = await stub.prepareChat(options);
  assert.equal(paid.allowed, true);
  assert.equal(paid.model, "gpt-5.5");
  assert.equal(paid.tier, "paid");
  assert.equal(paid.reservationMade, true);
  assert.equal(paid.used, 1);
});

import { env, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";
import worker, { handlePreparedChat } from "../src/index.js";
import paidWorker from "../src/paid-worker.js";
import { uwMadisonChatResponse } from "../src/uw-madison-chat.js";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const DAY = 86_400_000;
const policy = {
  OPENAI_FREE_TOKENS_ONLY: "true", OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED: "true",
  OPENAI_FREE_TOKEN_ALLOWANCE: "1000000", OPENAI_FREE_TOKEN_DAILY_LIMIT: "900000",
};
async function budget(limit = 1000, initialized = true) {
  const stub = env.OPENAI_TOKEN_BUDGET.getByName(crypto.randomUUID());
  await runInDurableObject(stub, async (instance, state) => {
    instance.env = { ...instance.env, ...policy, OPENAI_FREE_TOKEN_DAILY_LIMIT: String(limit) };
    instance.now = () => NOW;
    if (initialized) await state.storage.put("ledger", {
      day: "2026-09-24", initializedDay: "2026-09-23", used: 0, reserved: 0, suspended: false,
    });
  });
  return stub;
}
const ledger = (stub) => runInDurableObject(stub, (_, state) => state.storage.get("ledger"));
const clock = (stub, now) => runInDurableObject(stub, (instance) => { instance.now = () => now; });

test("atomic reservations cannot overspend under simultaneous users", async () => {
  const stub = await budget();
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => stub.reserve(`user-${i}`, 100)));
  assert.equal(results.filter((result) => result.allowed).length, 10);
  assert.equal((await ledger(stub)).reserved, 1000);
  assert.equal((await stub.reserve("overflow", 1)).allowed, false);
});

test("settlement is idempotent and counts cached input and reasoning exactly once", async () => {
  const stub = await budget();
  assert.equal((await stub.reserve("reply", 1000)).allowed, true);
  const usage = { input_tokens: 500, output_tokens: 100, total_tokens: 600,
    input_tokens_details: { cached_tokens: 400 }, output_tokens_details: { reasoning_tokens: 80 } };
  await Promise.all([stub.settle("reply", usage), stub.settle("reply", usage)]);
  assert.equal((await ledger(stub)).used, 600);
  assert.equal((await ledger(stub)).reserved, 0);
  assert.equal((await stub.reserve("reply", 1)).allowed, false);
  assert.equal((await stub.reserve("next", 400)).allowed, true);
  assert.equal((await stub.reserve("too-much", 1)).allowed, false);
});

test("first activation waits for the next UTC day instead of assuming no prior usage", async () => {
  const stub = await budget(1000, false);
  assert.deepEqual(await stub.reserve("first", 500), { allowed: false, reason: "initializing" });
  await clock(stub, Date.parse("2026-09-24T23:59:59Z"));
  assert.equal((await stub.reserve("late", 500)).allowed, false);
  await clock(stub, Date.parse("2026-09-25T00:00:00Z"));
  assert.equal((await stub.reserve("reset", 500)).allowed, true);
});

test("midnight resets settled usage while uncertain/in-flight requests remain reserved", async () => {
  const stub = await budget();
  await stub.reserve("done", 600);
  await stub.settle("done", { input_tokens: 400, output_tokens: 100 });
  await stub.reserve("unknown", 400);
  await stub.settle("unknown", { input_tokens: null, output_tokens: 10 });
  await clock(stub, NOW + DAY);
  assert.equal((await stub.reserve("new-day", 600)).allowed, true);
  assert.equal((await ledger(stub)).reserved, 1000);
  assert.equal((await ledger(stub)).used, 0);
  // A late receipt is conservatively charged to the new day before freeing its hold.
  await stub.settle("unknown", { input_tokens: 200, output_tokens: 100 });
  assert.equal((await ledger(stub)).used, 300);
  assert.equal((await ledger(stub)).reserved, 600);
});

test("undercount suspends the budget, even after midnight; unknown holds never expire", async () => {
  const stub = await budget();
  await stub.reserve("unknown", 100);
  await stub.reserve("undercount", 100);
  await stub.settle("undercount", { input_tokens: 100, output_tokens: 1 });
  assert.equal((await stub.reserve("stop", 1)).reason, "suspended");
  await clock(stub, NOW + 10 * DAY);
  await runDurableObjectAlarm(stub);
  assert.equal((await stub.reserve("still-stopped", 1)).reason, "suspended");
  assert.equal((await ledger(stub)).reserved, 100);
});

function appEnv(stub) {
  return { ...env, ...policy,
    DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key", OPENAI_MODEL: "gpt-5.6-sol",
    OPENAI_REASONING_EFFORT: "none", OPENAI_SERVICE_TIER: "fast",
    OPENAI_TOKEN_BUDGET: { getByName(name) {
      assert.equal(name, "openai-organization-primary-model-group-v1"); return stub;
    } },
  };
}
function chatRequest(stream = false, host = "stabilize.test") {
  return new Request(`https://${host}/api/chat`, { method: "POST",
    headers: { "Content-Type": "application/json", Accept: stream ? "application/x-ndjson" : "application/json" },
    body: JSON.stringify({ message: "Help me organize a small project." }),
  });
}
function provider(text = "Start with one small task.") {
  return { usage: { input_tokens: 100, output_tokens: 30 },
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] };
}
function mockProvider({ brokenStream = false } = {}) {
  const original = globalThis.fetch, sent = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith("/input_tokens")) return Response.json({ object: "response.input_tokens", input_tokens: 100 });
    sent.push(body);
    assert.equal(body.service_tier, "default");
    assert.ok(body.max_output_tokens > 0 && body.max_output_tokens <= 8192);
    if (body.stream) return new Response(brokenStream ? "data: invalid\n\n" :
      `data: ${JSON.stringify({ type: "response.completed", response: provider() })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } });
    return Response.json(provider());
  };
  return { sent, restore() { globalThis.fetch = original; } };
}

test("guest JSON, streaming, private, and campus replies share the same budget", async () => {
  const stub = await budget(10000), app = appEnv(stub), mock = mockProvider();
  try {
    for (const streaming of [false, true]) {
      const response = await worker.fetch(chatRequest(streaming), app, {});
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Start with one small task/);
    }
    const privateRequest = chatRequest();
    const privateResponse = await worker.fetch(new Request(privateRequest, {
      body: JSON.stringify({ message: "Help me organize a small project.", privateChat: true }),
    }), app, {});
    assert.equal(privateResponse.status, 200);
    const campus = await uwMadisonChatResponse(chatRequest(false, "chat.uwmadison.stabilize.info"), app, {});
    assert.equal(campus.status, 200);
    assert.equal(mock.sent.length, 4);
    assert.equal((await ledger(stub)).used, 4 * 130);
    assert.equal((await ledger(stub)).reserved, 0);
  } finally { mock.restore(); }
});

test("a malformed stream reserves the retry separately and preserves the unknown first cost", async () => {
  const stub = await budget(10000), mock = mockProvider({ brokenStream: true });
  try {
    const response = await worker.fetch(chatRequest(true), appEnv(stub), {});
    assert.match(await response.text(), /Start with one small task/);
    assert.equal(mock.sent.length, 2);
    assert.equal((await ledger(stub)).used, 130);
    assert.equal((await ledger(stub)).reserved, 100 + mock.sent[0].max_output_tokens + 256);
  } finally { mock.restore(); }
});

test("budget exhaustion blocks JSON, stream retries, and campus generation with a reset message", async () => {
  const stub = await budget(1000), app = appEnv(stub), mock = mockProvider();
  await stub.reserve("other-users", 1000);
  try {
    for (const streaming of [false, true]) {
      const response = await worker.fetch(chatRequest(streaming), app, {});
      assert.match(await response.text(), /00:00 UTC/);
    }
    const campus = await uwMadisonChatResponse(chatRequest(false, "chat.uwmadison.stabilize.info"), app, {});
    assert.equal(campus.status, 503);
    assert.match(await campus.text(), /00:00 UTC/);
    assert.equal(mock.sent.length, 0);
  } finally { mock.restore(); }
});

test("free-only pages remove Fast claims and fixed safety replies survive an exhausted budget", async () => {
  const stub = await budget(1000), app = appEnv(stub), mock = mockProvider();
  await stub.reserve("other-users", 1000);
  try {
    const page = await paidWorker.fetch(new Request("https://stabilize.test/"), app, {});
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /data-free-tokens-only="true"/);
    assert.doesNotMatch(html, /GPT-5.6 Fast/);
    assert.match(html, /billing-client.js\?v=20260924-free-token-budget-1/);
    const urgent = await worker.fetch(new Request(chatRequest(), {
      body: JSON.stringify({ message: "I am having crushing chest pain and cannot breathe." }),
    }), app, {});
    assert.equal(urgent.status, 200);
    assert.equal((await urgent.json()).route, "MEDICAL_EMERGENCY");
    assert.equal(mock.sent.length, 0);
  } finally { mock.restore(); }
});

test("signed-in replies and background memory summaries both consume the budget", async () => {
  const stub = await budget(10000), app = appEnv(stub), mock = mockProvider(), background = [];
  let summaryApplied = false;
  app.SESSIONS = { getByName() { return {
    async recordExchange() { return { shouldCompact: true }; },
    async getCompactionSnapshot() { return { summary: "", messages: [{ role: "user", content: "Remember short plans" }], summaryVersion: 0, throughSequence: 2 }; },
    async applySummary() { summaryApplied = true; },
  }; } };
  try {
    const response = await handlePreparedChat(chatRequest(), app, { waitUntil(task) { background.push(task); } },
      "test-account", { message: "Help me organize a small project." },
      { summary: "", recent: [], awaitingSafetyAnswer: false, generation: 0 });
    assert.equal(response.status, 200);
    await response.text();
    await Promise.all(background);
    assert.equal(summaryApplied, true);
    assert.equal(mock.sent.length, 2);
    assert.equal(mock.sent[1].max_output_tokens, 320);
    assert.equal((await ledger(stub)).used, 260);
  } finally { mock.restore(); }
});

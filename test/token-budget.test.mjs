import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { budgetedOpenAIFetch } from "../src/openai-budget-fetch.js";
import { usageTokens } from "../src/openai-budget-policy.js";
import { usageEnv, usageSnapshot } from "./fixtures/organization-usage.mjs";

const URL = "https://api.openai.com/v1/responses";
const payload = {
  model: "gpt-5.6-sol", service_tier: "fast", reasoning: { effort: "max" },
  instructions: "System instructions and memory", input: [{ role: "user", content: "Question" }],
};
function setup(overrides = {}) {
  const calls = [], reservations = [], settlements = [];
  const env = { ...usageEnv,
    OPENAI_FREE_TOKENS_ONLY: "true", OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED: "true",
    OPENAI_FREE_TOKEN_ALLOWANCE: "1000000", OPENAI_FREE_TOKEN_DAILY_LIMIT: "900000",
    OPENAI_TOKEN_BUDGET: { getByName(name) {
      assert.equal(name, "openai-organization-primary-model-group-v1");
      return {
        async reserve(id, tokens) { reservations.push({ id, tokens }); return { allowed: true, usage: usageSnapshot() }; },
        async settle(id, usage) { settlements.push({ id, usage }); },
      };
    } }, ...overrides,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, payload: JSON.parse(init.body), headers: new Headers(init.headers) });
    return Response.json(url.endsWith("/input_tokens")
      ? { object: "response.input_tokens", input_tokens: 500 }
      : { usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 }, output: [] });
  };
  return { env, calls, reservations, settlements, restore() { globalThis.fetch = originalFetch; } };
}
const request = (env, body = payload) => budgetedOpenAIFetch(URL, {
  method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify(body),
}, env);

test("reserves full exact input plus capped reasoning/output before generation", async () => {
  const s = setup();
  try {
    const response = await request(s.env, { ...payload,
      prompt_cache_key: "cache", prompt_cache_options: { mode: "explicit" },
      input: [{ role: "system", content: [{ type: "input_text", text: "Instructions", prompt_cache_breakpoint: { mode: "explicit" } }] }],
    });
    assert.equal(response.status, 200);
    assert.equal(s.calls.length, 2);
    assert.equal(s.calls[0].url, URL + "/input_tokens");
    assert.deepEqual(s.calls[0].payload.input, s.calls[1].payload.input);
    assert.equal(s.calls[0].payload.instructions, payload.instructions);
    assert.equal(s.calls[1].payload.max_output_tokens, 8192);
    assert.equal(s.calls[1].payload.service_tier, "default");
    for (const call of s.calls) {
      assert.equal(call.headers.get("OpenAI-Organization"), usageEnv.OPENAI_ORGANIZATION_ID);
      assert.equal(call.headers.get("Authorization"), "Bearer test");
    }
    assert.equal(s.calls[1].payload.prompt_cache_options, undefined);
    assert.equal(s.calls[1].payload.input[0].content[0].prompt_cache_breakpoint, undefined);
    assert.equal(s.reservations[0].tokens, 500 + 8192 + 256);
    assert.equal(s.settlements[0].id, s.reservations[0].id);
    assert.equal(usageTokens(s.settlements[0].usage), 600);
  } finally { s.restore(); }
});

test("missing eligibility/binding, invalid budgets, tools, and unknown models fail closed", async () => {
  for (const [overrides, body] of [
    [{ OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED: "false" }, payload],
    [{ OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED: undefined }, payload],
    [{ OPENAI_TOKEN_BUDGET: undefined }, payload],
    [{ OPENAI_USAGE_ADMIN_KEY: undefined }, payload],
    [{ OPENAI_USAGE_ADMIN_KEY: " " }, payload],
    [{ OPENAI_ORGANIZATION_ID: undefined }, payload],
    [{ OPENAI_ORGANIZATION_ID: "wrong organization" }, payload],
    [{ OPENAI_FREE_TOKEN_ALLOWANCE: "250000" }, payload],
    [{ OPENAI_FREE_TOKEN_DAILY_LIMIT: "1000001" }, payload],
    [{ OPENAI_FREE_TOKEN_DAILY_LIMIT: "NaN" }, payload],
    [{}, { ...payload, model: "gpt-new-model" }],
    [{}, { ...payload, tools: [{ type: "web_search" }] }],
    [{}, { ...payload, previous_response_id: "old" }],
    [{}, { ...payload, max_output_tokens: -1 }],
    [{}, { ...payload, input: [{ role: "user", content: [{ type: "input_image", image_url: "url" }] }] }],
  ]) {
    const s = setup(overrides);
    try {
      assert.equal((await request(s.env, body)).status, 503);
      assert.equal(s.calls.length, 0);
    } finally { s.restore(); }
  }
});

test("expired, missing, wrong-organization, and previous-day usage checks cannot start generation", async () => {
  const now = Date.now();
  for (const usage of [undefined, usageSnapshot(now - 16_000), usageSnapshot(now - 86_400_000),
    { ...usageSnapshot(now), organization: "org-other" }, { ...usageSnapshot(now), checkedAt: now + 60_000 }]) {
    const s = setup();
    s.env.OPENAI_TOKEN_BUDGET.getByName = () => ({ async reserve() { return { allowed: true, usage }; } });
    try {
      assert.equal((await request(s.env)).status, 503);
      assert.equal(s.calls.length, 1, "Only the input-token count may be sent");
      assert.equal(s.calls[0].url, URL + "/input_tokens");
    } finally { s.restore(); }
  }
});

test("a missing mode flag remains protected and a valid 225K budget is accepted", async () => {
  const s = setup({ OPENAI_FREE_TOKENS_ONLY: undefined, OPENAI_FREE_TOKEN_ALLOWANCE: "250000", OPENAI_FREE_TOKEN_DAILY_LIMIT: "225000" });
  try { assert.equal((await request(s.env)).status, 200); assert.equal(s.reservations.length, 1); }
  finally { s.restore(); }
});

test("denied, failed, or malformed count/reservation never starts generation", async () => {
  for (const kind of ["denied", "storage", "count-http", "count-invalid", "count-network"]) {
    const s = setup();
    let generations = 0;
    s.env.OPENAI_TOKEN_BUDGET.getByName = () => ({ async reserve() {
      if (kind === "storage") throw new Error("unavailable");
      return { allowed: false, reason: "exhausted" };
    } });
    globalThis.fetch = async (url) => {
      if (url === URL) generations++;
      if (kind === "count-network") throw new Error("network");
      return Response.json({ object: "response.input_tokens", input_tokens: kind === "count-invalid" ? null : 50 },
        { status: kind === "count-http" ? 429 : 200 });
    };
    try { assert.equal((await request(s.env)).status, 503); assert.equal(generations, 0); }
    finally { s.restore(); }
  }
});

test("HTTP and network errors retain the complete reservation", async () => {
  for (const network of [false, true]) {
    const s = setup();
    const counting = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (url !== URL) return counting(url, init);
      if (network) throw new Error("connection lost after send");
      return Response.json({ error: { code: "provider_error" } }, { status: 500 });
    };
    try {
      if (network) await assert.rejects(request(s.env));
      else assert.equal((await request(s.env)).status, 500);
      assert.equal(s.reservations.length, 1);
      assert.equal(s.settlements.length, 0);
    } finally { s.restore(); }
  }
});

test("stream usage settles once on terminal events, including split CRLF and incomplete replies", async () => {
  for (const type of ["response.completed", "response.incomplete", "response.failed"]) {
    const s = setup();
    const counting = globalThis.fetch;
    const event = { type, response: { usage: { input_tokens: 500, output_tokens: 70 } } };
    const raw = `data: ${JSON.stringify({ type: "response.created", response: { usage: { input_tokens: 0, output_tokens: 0 } } })}\r\n\r\ndata: ${JSON.stringify(event)}\r\n\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
    globalThis.fetch = async (url, init) => url !== URL ? counting(url, init) : new Response(new ReadableStream({
      start(controller) { for (const char of raw) controller.enqueue(new TextEncoder().encode(char)); controller.close(); },
    }));
    try {
      const response = await request(s.env, { ...payload, stream: true });
      assert.equal(await response.text(), raw);
      assert.equal(s.settlements.length, 1);
      assert.equal(s.settlements[0].usage.output_tokens, 70);
    } finally { s.restore(); }
  }
});

test("interrupted streams and invalid usage cannot refund reservations", async () => {
  assert.equal(usageTokens({ input_tokens: 100, output_tokens: 50, total_tokens: 1 }), null);
  assert.equal(usageTokens({ input_tokens: null, output_tokens: 0 }), null);
  assert.equal(usageTokens({ input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 90 }, output_tokens_details: { reasoning_tokens: 40 } }), 150);
  const s = setup();
  const counting = globalThis.fetch;
  globalThis.fetch = async (url, init) => url !== URL ? counting(url, init) : new Response('data: {"type":"response.created"}\n\ndata: broken');
  try {
    await (await request(s.env, { ...payload, stream: true })).text();
    assert.equal(s.settlements.length, 0);
  } finally { s.restore(); }
});

test("production enables protection and every provider path uses the shared wrapper", async () => {
  const config = JSON.parse(await readFile(new globalThis.URL("../wrangler.jsonc", import.meta.url)));
  assert.equal(config.vars.OPENAI_FREE_TOKENS_ONLY, "true");
  assert.ok(["true", "false"].includes(config.vars.OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED));
  assert.ok(config.durable_objects.bindings.some((entry) => entry.class_name === "OpenAITokenBudget"));
  const pkg = JSON.parse(await readFile(new globalThis.URL("../package.json", import.meta.url)));
  assert.equal(pkg.scripts["postapply:prompt-policy"], "node scripts/apply-free-token-budget.mjs");
  for (const file of ["index", "uw-madison-chat"]) {
    const source = await readFile(new globalThis.URL(`../src/${file}.js`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /await fetch\(OPENAI_RESPONSES_URL/);
    assert.match(source, /budgetedOpenAIFetch/);
    if (file === "index") {
      const calls = [...source.matchAll(/const result = await (?:callOpenAI|openAIStream)\(/g)].length;
      const guarded = [...source.matchAll(/"OpenAI(?:Http|FallbackHttp|SummaryHttp|GuestSummaryHttp)Error",\n\s*env,\n\s*\);/g)].length;
      assert.equal(calls, 5);
      assert.equal(guarded, calls, "Every regenerated helper call must forward its budget environment");
    }
  }
});

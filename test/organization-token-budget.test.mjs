import test from "node:test";
import assert from "node:assert/strict";
import { readOrganizationUsage } from "../src/openai-organization-usage.js";
import { usageEnv, usagePage, usageSnapshot } from "./fixtures/organization-usage.mjs";

const NOW = Date.parse("2026-09-24T23:59:40Z");
const read = (options = {}, env = usageEnv) => readOrganizationUsage(env, { now: () => NOW, ...options });
function mock(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}

test("reads the complete UTC day across all keys/projects/models/tiers with separate admin credentials", async (t) => {
  let calls = 0;
  mock(t, async (url, init) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://api.openai.com/v1/organization/usage/completions");
    assert.deepEqual(Object.fromEntries(parsed.searchParams), {
      start_time: String(Date.parse("2026-09-24T00:00:00Z") / 1000),
      end_time: String(Date.parse("2026-09-25T00:00:00Z") / 1000), bucket_width: "1d", limit: "1",
    });
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.Authorization, "Bearer test-usage-admin-key");
    assert.equal(init.headers["OpenAI-Organization"], usageEnv.OPENAI_ORGANIZATION_ID);
    assert.ok(init.signal instanceof AbortSignal);
    const body = usagePage(url, 600_000, 10_000);
    Object.assign(body.data[0].results[0], { input_cached_tokens: 400_000, input_cache_write_tokens: 50_000,
      input_text_tokens: 500_000, input_audio_tokens: 50_000, input_image_tokens: 50_000 });
    body.data[0].results.push({ object: "organization.usage.completions.result", input_tokens: 250_000, output_tokens: 30_000 });
    return Response.json(body);
  });
  assert.deepEqual(await read(), usageSnapshot(NOW, 890_000));
  assert.equal(calls, 1);
});

test("follows pagination before returning a total, including an empty first page", async (t) => {
  const calls = [];
  mock(t, async (url) => {
    const page = new URL(url).searchParams.get("page"); calls.push(page);
    return Response.json(page === null
      ? { object: "page", has_more: true, next_page: "next cursor & value", data: [] }
      : usagePage(url, 890_000, 10_000));
  });
  assert.equal((await read()).tokens, 900_000);
  assert.deepEqual(calls, [null, "next cursor & value"]);
});

test("an explicit empty successful report counts zero; missing usage data does not", async (t) => {
  mock(t, async () => Response.json({ object: "page", has_more: false, next_page: null, data: [] }));
  assert.equal((await read()).tokens, 0);
  globalThis.fetch = async () => Response.json({ object: "page", has_more: false });
  await assert.rejects(read());
});

test("failed HTTP, network, timeout, and invalid JSON responses fail closed", async (t) => {
  mock(t, async () => { throw new Error("network unavailable"); });
  await assert.rejects(read());
  globalThis.fetch = async () => { throw new DOMException("Timed out", "TimeoutError"); };
  await assert.rejects(read());
  for (const status of [401, 403, 429, 500]) {
    globalThis.fetch = async () => Response.json({ error: "unavailable" }, { status });
    await assert.rejects(read());
  }
  globalThis.fetch = async () => new Response("not JSON");
  await assert.rejects(read());
});

test("malformed totals, wrong-day buckets, overlapping buckets, and unsafe arithmetic are rejected", async (t) => {
  mock(t, async () => { throw new Error("Unconfigured fixture"); });
  for (const change of [
    (b) => { b.object = "response"; },
    (b) => { b.has_more = "false"; },
    (b) => { b.data[0].results = null; },
    (b) => { b.data[0].results[0].input_tokens = -1; },
    (b) => { b.data[0].results[0].output_tokens = null; },
    (b) => { b.data[0].results[0].input_tokens = "900000"; },
    (b) => { b.data[0].results[0].input_tokens = Number.MAX_SAFE_INTEGER; },
    (b) => { b.data[0].results[0].object = "unknown"; },
    (b) => { b.data[0].start_time--; },
    (b) => { b.data[0].end_time++; },
    (b) => { b.data[0].start_time = b.data[0].end_time; },
    (b) => { b.data.push(structuredClone(b.data[0])); },
  ]) {
    globalThis.fetch = async (url) => { const body = usagePage(url, 100, 1); change(body); return Response.json(body); };
    await assert.rejects(read());
  }
});

test("incomplete, repeated, and excessive pagination cannot admit requests", async (t) => {
  mock(t, async () => Response.json({ object: "page", data: [], has_more: true }));
  await assert.rejects(read());
  let calls = 0;
  globalThis.fetch = async () => {
    calls++; return Response.json({ object: "page", data: [], has_more: true, next_page: "repeated" });
  };
  await assert.rejects(read()); assert.equal(calls, 2);
  calls = 0;
  globalThis.fetch = async () => Response.json({ object: "page", data: [], has_more: true, next_page: `page-${++calls}` });
  await assert.rejects(read()); assert.equal(calls, 5);
});

test("missing usage credentials cannot fall back to the chat key", async (t) => {
  let calls = 0;
  mock(t, async () => { calls++; throw new Error("Must not fetch"); });
  for (const env of [{ OPENAI_API_KEY: "test-chat-key" }, { ...usageEnv, OPENAI_USAGE_ADMIN_KEY: "" },
    { ...usageEnv, OPENAI_ORGANIZATION_ID: "" }]) await assert.rejects(read({}, env));
  assert.equal(calls, 0);
});

test("a slow report or UTC rollover cannot return an actionable usage snapshot", async (t) => {
  mock(t, async (url) => Response.json(usagePage(url)));
  for (const completedAt of [NOW + 16_000, Date.parse("2026-09-25T00:00:00Z")]) {
    let calls = 0;
    await assert.rejects(read({ now: () => calls++ === 0 ? NOW : completedAt }));
  }
});

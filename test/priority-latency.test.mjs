import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("interactive OpenAI calls use Fast mode, bounded output, and explicit GPT-5.6 caching", async () => {
  const [worker, config] = await Promise.all([
    read("src/index.js"),
    read("wrangler.jsonc"),
  ]);
  const wrangler = JSON.parse(config);

  assert.equal(wrangler.vars.OPENAI_SERVICE_TIER, "fast");
  assert.match(worker, /OPENAI_SERVICE_TIERS/);
  assert.match(worker, /service_tier: serviceTier/);
  assert.match(worker, /OPENAI_SERVICE_TIER \|\| "fast"/);
  assert.match(worker, /ORDINARY_OUTPUT_TOKEN_LIMIT = 360/);
  assert.match(worker, /LONG_FORM_OUTPUT_TOKEN_LIMIT = 900/);
  assert.match(worker, /text: \{ verbosity: "low" \}/);
  assert.match(worker, /prompt_cache_key: PROMPT_CACHE_KEY/);
  assert.match(worker, /prompt_cache_options: \{ mode: "explicit", ttl: "30m" \}/);
  assert.match(worker, /prompt_cache_breakpoint: \{ mode: "explicit" \}/);
  assert.match(worker, /supportsExplicitPromptCaching\(model\)/);
  assert.match(worker, /cachedTokens: usageNumber\(inputDetails\.cached_tokens\)/);
  assert.match(worker, /cacheWriteTokens: usageNumber\(inputDetails\.cache_write_tokens\)/);
});

test("signed-in chat preparation uses one billing RPC and overlaps it with memory", async () => {
  const [core, paid, billing] = await Promise.all([
    read("src/index.js"),
    read("src/paid-worker.js"),
    read("src/billing-account.js"),
  ]);

  assert.match(core, /export async function preparedChatResponse\(/);
  assert.match(core, /export async function handlePreparedChat\(/);
  assert.match(core, /export async function readBoundedJson\(/);
  assert.match(core, /export async function readMemoryContext\(/);
  assert.match(billing, /async prepareChat\(options\)/);
  assert.match(billing, /this\.ctx\.storage\.transactionSync/);

  const start = paid.indexOf("async function paidChatResponse(");
  const end = paid.indexOf("function responseWithModelUsage", start);
  assert.ok(start >= 0 && end > start, "paid chat handler is missing");
  const paidChat = paid.slice(start, end);

  assert.match(
    paidChat,
    /const \[billingResult, memoryResult\] = await Promise\.all\(\[/,
  );
  assert.match(
    paidChat,
    /stub\s*\.prepareChat\(chatPreparationOptions\(env, body\)\)/,
  );
  assert.match(paidChat, /readMemoryContext\(memoryStub\)/);
  assert.match(paidChat, /preparedChatResponse\(/);
  assert.match(paidChat, /event: "signed_in_chat_prepared"/);
  assert.match(paidChat, /X-Stabilize-Preparation-Ms/);
  assert.match(paidChat, /Server-Timing/);
  assert.doesNotMatch(paidChat, /readBillingState\(/);
  assert.doesNotMatch(paidChat, /reserveUsage\(/);
});

test("streaming paints plain text at most once per frame and renders Markdown once at completion", async () => {
  const [client, styles, page] = await Promise.all([
    read("public/app.js"),
    read("public/styles.css"),
    read("src/page.js"),
  ]);

  assert.match(client, /let streamingRenderHandle = 0/);
  assert.match(client, /window\.requestAnimationFrame\(flushStreamingOutput\)/);
  assert.match(client, /text\.textContent = content \|\| pendingReplyCopy\(\)/);
  assert.match(client, /cancelStreamingOutputRender\(\)/);
  assert.doesNotMatch(
    client,
    /function renderStreamingOutput[\s\S]*?renderMarkdown\(content/,
  );
  assert.match(
    client,
    /function finalizeStreamingOutput[\s\S]*?renderMarkdown\(reply\)/,
  );
  assert.match(styles, /\.streaming-text\{white-space:pre-wrap/);
  assert.match(page, /app\.js\?v=20260808-full-guest-thread-1/);
  assert.match(page, /styles\.css\?v=20260807-priority-latency-1/);
});
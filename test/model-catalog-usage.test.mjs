import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("only GPT-5.4 and Current remain selectable, with instant responses by default", async () => {
  const [configText, billingSource, indexSource, pageSource, reasoningClient, packageSource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/billing.js"),
      read("src/index.js"),
      read("src/page.js"),
      read("public/reasoning-choice.js"),
      read("package.json"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(
    config.vars.MODEL_CHOICES,
    "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
  );
  assert.deepEqual(
    config.vars.MODEL_CHOICES.split(",").map((entry) => entry.split("|")[0]),
    ["gpt-5.4", "gpt-5.6-sol"],
  );
  assert.doesNotMatch(
    config.vars.MODEL_CHOICES,
    /gpt-5-mini|gpt-5\.1|luna|terra/i,
  );

  assert.match(billingSource, /"gpt-5\.4\|GPT-5\.4"/);
  assert.match(billingSource, /"gpt-5\.6-sol\|Current"/);
  assert.match(indexSource, /function requestedReasoningEffort\(body, model, fallbackEffort\)/);
  assert.match(indexSource, /effectiveReasoningEffort\(String\(model/);
  assert.equal(
    (indexSource.match(/const turnReasoningEffort = reasoningEffort;/g) || []).length,
    2,
  );
  assert.match(pageSource, /reasoning-choice\.js\?v=20260807-instant-thinking-2-fastest-1/);

  for (const effort of ["none", "low", "medium", "high", "xhigh", "max"]) {
    assert.match(reasoningClient, new RegExp(`value: "${effort}"`));
  }
  assert.match(reasoningClient, /Fastest response/);
  assert.match(reasoningClient, /documentElement\.dataset\.reasoningEffort/);
  assert.match(reasoningClient, /Network and model startup can still take a moment/);
  assert.match(reasoningClient, /Think maximum \(Current only\)/);
  assert.match(reasoningClient, /Free at every level/);
  assert.match(reasoningClient, /CURRENT_MODEL_PATTERN/);
  assert.match(reasoningClient, /maximum\.disabled = !enabled/);
  assert.match(reasoningClient, /body\.reasoningEffort = reasoningEffort/);
  assert.doesNotMatch(reasoningClient, /new MutationObserver/);
  assert.match(reasoningClient, /DOMContentLoaded/);
  assert.match(reasoningClient, /current\.textContent !== nextText/);

  const packageJson = JSON.parse(packageSource);
  assert.equal(
    packageJson.scripts["apply:prompt-policy"],
    "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/prepare-decision-grade-impact.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs && node scripts/apply-signed-in-prefetch-latency.mjs && node scripts/finalize-signed-in-prefetch-tests.mjs && node scripts/prepare-full-guest-cache-version.mjs && node scripts/remember-full-guest-conversation.mjs && node scripts/finalize-full-guest-conversation.mjs && node scripts/prepare-client-response-time.mjs && node scripts/apply-decision-grade-impact.mjs && node scripts/apply-client-response-time.mjs && node scripts/finalize-decision-grade-impact.mjs",
  );
});
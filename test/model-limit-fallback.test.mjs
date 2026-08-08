import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("guest and signed-in free chats use adaptive Luna before signed-in fallback", async () => {
  const [configText, workerSource, billingSource, clientSource, policySource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/paid-worker.js"),
      read("src/billing-account.js"),
      read("public/billing-client.js"),
      read("scripts/apply-luna-adaptive-routing.mjs"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(config.vars.OPENAI_SERVICE_TIER, "fast");
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "50");
  assert.equal(config.vars.FREE_PLAN_PRIMARY_MODEL, "gpt-5.6-luna");
  assert.equal(config.vars.OPENAI_COMPLEX_MODEL, "gpt-5.6-sol");
  assert.equal(config.vars.OPENAI_COMPLEXITY_MODEL, "gpt-5.6-luna");
  assert.equal(config.vars.OPENAI_ADAPTIVE_ROUTING, "true");
  assert.equal(config.vars.FREE_PLAN_FALLBACK_MODEL, "gpt-5.4");

  for (const expected of [
    'env.FREE_PLAN_PRIMARY_MODEL || "gpt-5.6-luna"',
    ".prepareChat(chatPreparationOptions(env, body))",
    "modelEnvironment(",
    "GPT-5.6 Adaptive is automatic for the first",
    "X-Stabilize-Model-Selected",
  ]) {
    assert.ok(workerSource.includes(expected), `Missing worker policy: ${expected}`);
  }
  assert.ok(billingSource.includes("model: config.freeModel"));
  assert.ok(billingSource.includes("model: config.fallbackModel"));
  assert.doesNotMatch(
    billingSource,
    /Signed-in instant chats use the unmetered default model/,
  );
  assert.ok(clientSource.includes("free GPT-5.6 Adaptive messages used today"));
  assert.ok(policySource.includes("adaptive model routing"));
});

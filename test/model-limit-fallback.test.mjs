import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("signed-in Fastest response uses GPT-5.4 while thinking uses the free Current allowance", async () => {
  const [configText, workerSource, billingSource, clientSource, policySource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/paid-worker.js"),
      read("src/billing-account.js"),
      read("public/billing-client.js"),
      read("scripts/apply-signed-in-latency-v2.mjs"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "50");
  assert.equal(config.vars.FREE_PLAN_PRIMARY_MODEL, "gpt-5.6-sol");
  assert.equal(config.vars.FREE_PLAN_FALLBACK_MODEL, "gpt-5.4");

  assert.ok(workerSource.includes("function chatPreparationOptions(env, body = {})"));
  assert.ok(workerSource.includes('const usesThinking = ["low", "medium", "high", "xhigh", "max"].includes('));
  assert.match(workerSource, /.prepareChat(chatPreparationOptions(env, body))/);
  assert.match(workerSource, /preparation.model === defaultModel/);
  assert.match(workerSource, /responseWithPreparationTiming/);
  assert.match(workerSource, /X-Stabilize-Preparation-Ms/);
  assert.match(workerSource, /X-Stabilize-Model-Selected/);
  assert.match(workerSource, /Fastest response uses GPT-5.4/);

  assert.match(billingSource, /Signed-in instant chats use the unmetered default model/);
  assert.match(billingSource, /config.freeModel === config.defaultModel/);
  assert.match(billingSource, /model: config.freeModel/);
  assert.match(billingSource, /model: config.fallbackModel/);
  assert.match(billingSource, /fallback: true/);

  assert.match(clientSource, /free Current thinking messages used today/);
  assert.match(clientSource, /function updateSelectedModelDisplay(model)/);
  assert.match(clientSource, /X-Stabilize-Model-Selected/);
  assert.match(policySource, /const usesThinking/);
  assert.match(policySource, /const memoryWarmup = readMemoryContext/);
});

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

  for (const expected of [
    "function chatPreparationOptions(env, body = {})",
    'const usesThinking = ["low", "medium", "high", "xhigh", "max"].includes(',
    ".prepareChat(chatPreparationOptions(env, body))",
    "preparation.model === defaultModel",
    "responseWithPreparationTiming",
    "X-Stabilize-Preparation-Ms",
    "X-Stabilize-Model-Selected",
    "Fastest response uses GPT-5.4",
  ]) {
    assert.ok(workerSource.includes(expected), `Missing signed-in worker source: ${expected}`);
  }

  for (const expected of [
    "Signed-in instant chats use the unmetered default model",
    "config.freeModel === config.defaultModel",
    "model: config.freeModel",
    "model: config.fallbackModel",
    "fallback: true",
  ]) {
    assert.ok(billingSource.includes(expected), `Missing billing source: ${expected}`);
  }

  for (const expected of [
    "free Current thinking messages used today",
    "function updateSelectedModelDisplay(model)",
    "X-Stabilize-Model-Selected",
  ]) {
    assert.ok(clientSource.includes(expected), `Missing client source: ${expected}`);
  }

  assert.ok(policySource.includes("const usesThinking"));
  assert.ok(policySource.includes("const memoryWarmup = readMemoryContext"));
});

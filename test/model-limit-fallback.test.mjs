import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("signed-in fastest response matches the guest model while thinking uses the free Current allowance", async () => {
  const [configText, workerSource, billingSource, clientSource, packageSource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/paid-worker.js"),
      read("src/billing-account.js"),
      read("public/billing-client.js"),
      read("package.json"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "50");
  assert.equal(config.vars.FREE_PLAN_PRIMARY_MODEL, "gpt-5.6-sol");
  assert.equal(config.vars.FREE_PLAN_FALLBACK_MODEL, "gpt-5.4");

  assert.match(workerSource, /function chatPreparationOptions\(env, body = \{\}\)/);
  assert.match(workerSource, /const usesThinking = \["low", "medium", "high", "xhigh", "max"\]/);
  assert.match(workerSource, /stub\s*\.prepareChat\(chatPreparationOptions\(env, body\)\)/);
  assert.match(workerSource, /preparation\.model === defaultModel/);
  assert.match(workerSource, /ctx\.waitUntil\(memoryWarmup\)/);
  assert.match(workerSource, /event: "signed_in_chat_prepared"/);
  assert.match(workerSource, /Server-Timing/);
  assert.match(workerSource, /X-Stabilize-Preparation-Ms/);

  assert.match(billingSource, /Signed-in instant chats use the unmetered default model/);
  assert.match(billingSource, /config\.freeModel === config\.defaultModel/);
  assert.match(billingSource, /tier: null/);
  assert.match(billingSource, /model: config\.freeModel/);
  assert.match(billingSource, /model: config\.fallbackModel/);

  assert.match(clientSource, /free Current thinking messages used today/);
  assert.match(clientSource, /function updateSelectedModelDisplay\(model\)/);
  assert.match(clientSource, /X-Stabilize-Model-Selected/);

  const packageJson = JSON.parse(packageSource);
  assert.equal(
    packageJson.scripts["apply:prompt-policy"],
    "node scripts/apply-priority-latency.mjs && node scripts/apply-signed-in-latency.mjs",
  );
});

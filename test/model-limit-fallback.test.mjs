import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("free selected-model usage falls back to GPT-5.4 after 20 messages", async () => {
  const [configText, workerSource, clientSource, stylesSource, policySource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/paid-worker.js"),
      read("public/billing-client.js"),
      read("public/styles.css"),
      read("scripts/apply-model-limit-fallback-and-transparent-chat.mjs"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "20");
  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.match(workerSource, /await stub\.setSelectedModel\(defaultModel\)/);
  assert.match(workerSource, /X-Stabilize-Model-Fallback/);
  assert.match(workerSource, /modelEnvironment\(env, defaultModel\)/);
  assert.match(clientSource, /function showModelFallbackNotice\(/);
  assert.match(clientSource, /switched to GPT-5\.4 automatically/);
  assert.match(stylesSource, /\.chat-log,\s*\.assistant-output\s*\{/);
  assert.match(stylesSource, /background: transparent/);
  assert.match(stylesSource, /\.model-fallback-notice/);
  assert.match(policySource, /daily-limit/);
});

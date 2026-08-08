import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("free accounts use GPT-5.6 Instant for 50 messages then fall back to GPT-5.4", async () => {
  const [configText, workerSource, billingSource, clientSource, policySource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/paid-worker.js"),
      read("src/billing-account.js"),
      read("public/billing-client.js"),
      read("scripts/apply-free-gpt56-config.mjs"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "50");
  assert.equal(config.vars.FREE_PLAN_PRIMARY_MODEL, "gpt-5.6-sol");
  assert.equal(config.vars.FREE_PLAN_FALLBACK_MODEL, "gpt-5.4");

  assert.match(workerSource, /FREE_PLAN_PRIMARY_MODEL \|\| "gpt-5\.6-sol"/);
  assert.match(workerSource, /FREE_PLAN_FALLBACK_MODEL \|\| defaultModel/);
  assert.match(workerSource, /stub\.prepareChat\(chatPreparationOptions\(env\)\)/);
  assert.match(workerSource, /preparation\.paid !== true\) body\.reasoningEffort = "none"/);
  assert.match(workerSource, /fallback: preparation\.fallback/);
  assert.match(workerSource, /X-Stabilize-Model-Fallback/);
  assert.match(workerSource, /GPT-5\.6 Instant is automatic/);

  assert.match(billingSource, /async prepareChat\(options\)/);
  assert.match(billingSource, /model: config\.freeModel/);
  assert.match(billingSource, /model: config\.fallbackModel/);
  assert.match(billingSource, /fallback: true/);
  assert.match(billingSource, /reservationMade: false/);

  assert.match(clientSource, /GPT-5\.6 Instant messages/);
  assert.match(clientSource, /switched to GPT-5\.4 automatically/);
  assert.match(policySource, /FREE_DAILY_LIMIT = 50/);
});
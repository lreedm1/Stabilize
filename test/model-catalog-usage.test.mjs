import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("GPT-5 mini is the default and GPT-5.6 tiers are selectable", async () => {
  const [configText, workerSource, clientSource, policySource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/paid-worker.js"),
      read("public/billing-client.js"),
      read("scripts/fix-live-model-usage-and-catalog.mjs"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5-mini");
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "20");
  assert.equal(
    config.vars.MODEL_CHOICES,
    [
      "gpt-5-mini|GPT-5 mini (default)",
      "gpt-5.1|GPT-5.1",
      "gpt-5.6-luna|GPT-5.6 Luna",
      "gpt-5.6-terra|GPT-5.6 Terra",
      "gpt-5.6-sol|GPT-5.6 Sol",
    ].join(","),
  );
  assert.doesNotMatch(config.vars.MODEL_CHOICES, /gpt-5\.1-mini/);

  assert.match(workerSource, /env\.OPENAI_MODEL \|\| "gpt-5-mini"/);
  assert.match(workerSource, /data-model-usage="true"/);
  assert.match(workerSource, /X-Stabilize-Model-Usage-Tier/);
  assert.match(workerSource, /X-Stabilize-Model-Usage-Used/);
  assert.match(workerSource, /X-Stabilize-Model-Usage-Limit/);
  assert.match(workerSource, /X-Stabilize-Model-Usage-Period/);
  assert.match(workerSource, /X-Stabilize-Model-Selected/);
  assert.match(workerSource, /contentType\.includes\("application\/json"\)/);

  assert.match(clientSource, /function modelUsageFromResponse\(/);
  assert.match(clientSource, /function updateModelUsageDisplay\(/);
  assert.match(clientSource, /chatRequestPath\(args\[0\]\) === "\/api\/chat"/);
  assert.match(clientSource, /free model-select messages used today/);
  assert.match(clientSource, /subscriber model messages used this UTC month/);

  assert.match(policySource, /gpt-5\.6-luna\|GPT-5\.6 Luna/);
  assert.match(policySource, /gpt-5\.6-terra\|GPT-5\.6 Terra/);
  assert.match(policySource, /gpt-5\.6-sol\|GPT-5\.6 Sol/);
  assert.match(policySource, /enabled live usage counters/);
});

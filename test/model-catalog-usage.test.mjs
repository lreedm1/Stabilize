import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("GPT-5.4 is the default and lower and higher tiers remain selectable", async () => {
  const [
    configText,
    indexSource,
    workerSource,
    clientSource,
    policySource,
    defaultPolicySource,
  ] = await Promise.all([
    read("wrangler.jsonc"),
    read("src/index.js"),
    read("src/paid-worker.js"),
    read("public/billing-client.js"),
    read("scripts/fix-live-model-usage-and-catalog.mjs"),
    read("scripts/set-gpt54-default.mjs"),
  ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "20");
  assert.equal(
    config.vars.MODEL_CHOICES,
    [
      "gpt-5.4|GPT-5.4 (default)",
      "gpt-5-mini|GPT-5 mini",
      "gpt-5.1|GPT-5.1",
      "gpt-5.6-luna|GPT-5.6 Luna",
      "gpt-5.6-terra|GPT-5.6 Terra",
      "gpt-5.6-sol|GPT-5.6 Sol",
    ].join(","),
  );
  assert.doesNotMatch(config.vars.MODEL_CHOICES, /gpt-5\.1-mini/);

  assert.match(indexSource, /const model = String\(env\.OPENAI_MODEL \|\| "gpt-5\.4"\)/);
  assert.doesNotMatch(indexSource, /configuredModel === "gpt-5\.6-sol"/);

  assert.match(workerSource, /env\.OPENAI_MODEL \|\| "gpt-5\.4"/);
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
  assert.match(defaultPolicySource, /const DEFAULT_MODEL = "gpt-5\.4"/);
  assert.match(defaultPolicySource, /gpt-5-mini\|GPT-5 mini/);
  assert.match(defaultPolicySource, /Set GPT-5\.4 as the default model/);
});

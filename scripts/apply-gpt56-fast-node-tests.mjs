import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("test/model-limit-fallback.test.mjs", () => `import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(\`../\${path}\`, import.meta.url), "utf8");

test("guest and signed-in free chats begin on GPT-5.6 Fast before signed-in fallback", async () => {
  const [configText, workerSource, billingSource, clientSource, policySource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/paid-worker.js"),
      read("src/billing-account.js"),
      read("public/billing-client.js"),
      read("scripts/apply-gpt56-fast-runtime.mjs"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(config.vars.OPENAI_SERVICE_TIER, "fast");
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "50");
  assert.equal(config.vars.FREE_PLAN_PRIMARY_MODEL, "gpt-5.6-sol");
  assert.equal(config.vars.FREE_PLAN_FALLBACK_MODEL, "gpt-5.4");

  for (const expected of [
    'env.FREE_PLAN_PRIMARY_MODEL || "gpt-5.6-sol"',
    ".prepareChat(chatPreparationOptions(env, body))",
    "modelEnvironment(",
    "GPT-5.6 Fast is automatic for the first",
    "X-Stabilize-Model-Selected",
  ]) {
    assert.ok(workerSource.includes(expected), \`Missing worker policy: \${expected}\`);
  }
  assert.ok(billingSource.includes("model: config.freeModel"));
  assert.ok(billingSource.includes("model: config.fallbackModel"));
  assert.doesNotMatch(
    billingSource,
    /Signed-in instant chats use the unmetered default model/,
  );
  assert.ok(clientSource.includes("free GPT-5.6 Fast messages used today"));
  assert.ok(policySource.includes("the guest chat model route"));
});
`);

await update("test/paid-model-choice.test.mjs", (source) =>
  source
    .replace(
      "fast signed-in routing and subscriber choice share a resilient left-side picker",
      "GPT-5.6 fast-first routing and subscriber choice share a resilient left-side picker",
    )
    .replace(
      "  assert.match(workerSource, /freeLimit[\\s\\S]*Current thinking messages/);",
      "  assert.match(workerSource, /freeLimit[\\s\\S]*GPT-5\\.6 Fast messages/);",
    )
    .replace(
      "  assert.match(accountSource, /config\\.freeModel === config\\.defaultModel/);\n",
      "",
    )
    .replace(
      "  assert.match(setupGuide, /50 free Current thinking messages per UTC day/);",
      "  assert.match(setupGuide, /50 GPT-5\\.6 Fast messages per UTC day/);",
    ),
);

await update("test/domain.test.mjs", (source) =>
  source
    .replace(
      "    assert.match(description, /Current/);",
      "    assert.match(description, /GPT-5\\.6 Fast/);",
    )
    .replace(
      "  assert.match(about, /Signed-in free accounts use GPT-5\\.4 for Fastest response and receive 50 Current thinking/);",
      "  assert.match(about, /Signed-in free accounts receive 50 GPT-5\\.6 Fast/);",
    )
    .replace(
      "  assert.match(sustainability, /free GPT-5\\.4 fastest-response and Current-thinking policy intact/);",
      "  assert.match(sustainability, /free GPT-5\\.6 Fast-first policy intact/);",
    )
    .replaceAll(
      "/50 Current thinking\\s+messages per UTC day/i",
      "/50 GPT-5\\.6 Fast\\s+messages per UTC day/i",
    ),
);

await update("test/sustainability.test.mjs", (source) =>
  source
    .replaceAll(
      "/50 Current thinking\\s+messages per UTC day/i",
      "/50 GPT-5\\.6 Fast\\s+messages per UTC day/i",
    )
    .replaceAll(
      "/50 Current thinking messages per UTC day/i",
      "/50 GPT-5\\.6 Fast messages per UTC day/i",
    ),
);

console.log("Aligned Node regression tests with GPT-5.6 Fast-first routing.");

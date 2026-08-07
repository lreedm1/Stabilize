import { readFile, writeFile } from "node:fs/promises";

const FREE_POLICY_SCRIPTS = [
  "scripts/apply-free-gpt56-config.mjs",
  "scripts/apply-free-gpt56-client.mjs",
  "scripts/align-free-gpt56-tests.mjs",
  "scripts/finalize-free-gpt56-ui-compat.mjs",
  "scripts/finalize-free-gpt56-worker-tests.mjs",
  "scripts/enforce-free-gpt56-instant.mjs",
  "scripts/restore-free-model-selection-compat.mjs",
  "scripts/restore-model-fallback-compat.mjs",
  "scripts/restore-paid-worker-fallback-compat.mjs",
  "scripts/finalize-free-gpt56-idempotency.mjs",
  "scripts/finalize-free-gpt56-repeat-shape.mjs",
];

async function update(path, transform, { optional = false } = {}) {
  let before;
  try {
    before = await readFile(path, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return;
    throw error;
  }
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Free repeat-shape finalizer could not find ${label}`);
  }
}

function validateNormalizedShape(text) {
  const paidStart = text.indexOf("async function paidChatResponse(");
  const workerStart = text.indexOf("\nconst worker =", paidStart);
  const responseStart = text.indexOf("function responseWithModelUsage(");
  const requestStart = text.indexOf(
    "async function requestWithReasoningEffort(",
  );
  if (
    paidStart < 0 ||
    workerStart <= paidStart ||
    responseStart <= paidStart ||
    responseStart >= workerStart ||
    requestStart <= paidStart ||
    requestStart >= workerStart
  ) {
    return false;
  }
  const paidSection = text.slice(paidStart, workerStart);
  requireText(
    paidSection,
    "function responseWithModelUsage(",
    "the removable response-header helper",
  );
  requireText(
    paidSection,
    "async function requestWithReasoningEffort(",
    "the removable Instant request helper",
  );
  return true;
}

await update("src/paid-worker.js", (source) => {
  if (validateNormalizedShape(source)) return source;

  let text = source;
  const responseStart = text.indexOf("function responseWithModelUsage(");
  const requestStart = text.indexOf(
    "async function requestWithReasoningEffort(",
  );
  if (responseStart < 0 || requestStart < 0) {
    throw new Error("Could not find both free routing helpers");
  }
  const helperStart = Math.min(responseStart, requestStart);
  const helperEndAnchor = Math.max(responseStart, requestStart);
  const paidStart = text.indexOf(
    "async function paidChatResponse(",
    helperEndAnchor,
  );
  const workerStart = text.indexOf("\nconst worker =", paidStart);
  if (paidStart <= helperEndAnchor || workerStart <= paidStart) {
    throw new Error("Could not isolate the free routing helpers and handler block");
  }

  const helperBlock = text.slice(helperStart, paidStart).trimEnd();
  text = text.slice(0, helperStart) + text.slice(paidStart);
  const updatedWorkerStart = text.indexOf("\nconst worker =", helperStart);
  if (updatedWorkerStart < 0) {
    throw new Error("Could not relocate the free routing helper block");
  }
  text =
    text.slice(0, updatedWorkerStart) +
    `\n\n${helperBlock}\n` +
    text.slice(updatedWorkerStart);

  if (!validateNormalizedShape(text)) {
    throw new Error("Free routing helpers did not reach the repeatable shape");
  }
  if (
    text.slice(0, text.indexOf("async function paidChatResponse(")).includes(
      "X-Stabilize-Model-Fallback",
    )
  ) {
    throw new Error("Fallback marker remains outside the replaceable chat block");
  }
  return text;
});

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    let text = source;
    for (const path of FREE_POLICY_SCRIPTS) {
      text = text.replaceAll(`  "${path}",\n`, "");
    }
    const marker = '  "scripts/fix-fastest-response-worker.mjs",\n';
    requireText(text, marker, "the final pre-free-policy fixture");
    const canonical = FREE_POLICY_SCRIPTS.map(
      (path) => `  "${path}",`,
    ).join("\n");
    text = text.replace(marker, `${marker}${canonical}\n`);
    return text;
  },
  { optional: true },
);

console.log("Kept free GPT-5.6 routing replaceable on repeat policy runs.");

import { readFile, writeFile } from "node:fs/promises";

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

await update("src/paid-worker.js", (source) => {
  let text = source;
  const responseStart = text.indexOf("function responseWithModelUsage(");
  const requestStart = text.indexOf(
    "async function requestWithReasoningEffort(",
  );
  const helperStart = Math.min(responseStart, requestStart);
  const helperEndAnchor = Math.max(responseStart, requestStart);
  const paidStart = text.indexOf(
    "async function paidChatResponse(",
    helperEndAnchor,
  );
  const workerStart = text.indexOf("\nconst worker =", paidStart);
  if (
    responseStart < 0 ||
    requestStart < 0 ||
    helperStart < 0 ||
    paidStart <= helperEndAnchor ||
    workerStart <= paidStart
  ) {
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

  const paidSection = text.slice(
    text.indexOf("async function paidChatResponse("),
    text.indexOf("\nconst worker ="),
  );
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
    const path = "scripts/finalize-free-gpt56-repeat-shape.mjs";
    if (source.includes(`"${path}"`)) return source;
    const marker = '  "scripts/finalize-free-gpt56-idempotency.mjs",\n';
    requireText(source, marker, "the free idempotency fixture");
    return source.replace(marker, `${marker}  "${path}",\n`);
  },
  { optional: true },
);

console.log("Kept free GPT-5.6 routing replaceable on repeat policy runs.");

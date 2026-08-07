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
    throw new Error(`Free model-selection compatibility could not find ${label}`);
  }
}

await update("src/paid-worker.js", (source) => {
  const restrictedSelection = `  const stub = billingStub(env, authSession.accountKey);
  const state = await readBillingState(stub);
  if (!state.entitled) return redirect("/?model=automatic", 303);
  await stub.setSelectedModel(model);`;
  const compatibleSelection = `  const stub = billingStub(env, authSession.accountKey);
  await stub.setSelectedModel(model);`;
  const text = source.includes(restrictedSelection)
    ? source.replace(restrictedSelection, compatibleSelection)
    : source;
  requireText(
    text,
    compatibleSelection,
    "the repeatable model-selection path",
  );
  return text;
});

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    const path = "scripts/restore-free-model-selection-compat.mjs";
    if (source.includes(`"${path}"`)) return source;
    const marker = '  "scripts/enforce-free-gpt56-instant.mjs",\n';
    requireText(source, marker, "the free Instant fixture");
    return source.replace(marker, `${marker}  "${path}",\n`);
  },
  { optional: true },
);

console.log("Preserved repeatable free-plan model selection generation.");

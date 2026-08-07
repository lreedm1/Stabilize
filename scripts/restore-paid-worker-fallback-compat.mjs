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
    throw new Error(
      `Paid-worker fallback compatibility could not find ${label}`,
    );
  }
}

await update(
  "test/paid-worker.test.mjs",
  (source) => {
    let text = source;
    text = text.replace(
      '    assert.equal(fallback.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");',
      `    assert.equal(
      fallback.headers.get("X-Stabilize-Model-Selected"),
      limitedEnv.OPENAI_MODEL,
    );`,
    );
    text = text.replace(
      '    assert.deepEqual(providerModels, ["gpt-5.6-sol", "gpt-5.6-sol", "gpt-5.4"]);',
      `    assert.deepEqual(providerModels, [
      "gpt-5.6-sol",
      "gpt-5.6-sol",
      limitedEnv.OPENAI_MODEL,
    ]);`,
    );
    requireText(
      text,
      "limitedEnv.OPENAI_MODEL",
      "the configured fallback assertion",
    );
    return text;
  },
  { optional: true },
);

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    const path = "scripts/restore-paid-worker-fallback-compat.mjs";
    if (source.includes(`"${path}"`)) return source;
    const marker = '  "scripts/restore-model-fallback-compat.mjs",\n';
    requireText(source, marker, "the model fallback compatibility fixture");
    return source.replace(marker, `${marker}  "${path}",\n`);
  },
  { optional: true },
);

console.log("Preserved repeatable paid-worker fallback assertions.");

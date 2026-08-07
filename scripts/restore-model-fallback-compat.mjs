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
    throw new Error(`Model fallback compatibility could not find ${label}`);
  }
}

await update("src/paid-worker.js", (source) => {
  let text = source;
  const freeStart = text.indexOf('  const tier = "free";');
  const freeEnd = text.indexOf("\n}\n\nconst worker =", freeStart);
  if (freeStart < 0 || freeEnd <= freeStart) {
    throw new Error("Could not isolate the free fallback branch");
  }
  let freeSection = text.slice(freeStart, freeEnd);
  if (!freeSection.includes("await stub.setSelectedModel(defaultModel);")) {
    freeSection = freeSection.replace(
      "  if (!reservation.allowed) {\n",
      "  if (!reservation.allowed) {\n    await stub.setSelectedModel(defaultModel);\n",
    );
  }
  freeSection = freeSection
    .replaceAll(
      "modelEnvironment(env, fallbackModel)",
      "modelEnvironment(env, defaultModel)",
    )
    .replaceAll("model: fallbackModel,", "model: defaultModel,");
  text = text.slice(0, freeStart) + freeSection + text.slice(freeEnd);

  requireText(
    text,
    "await stub.setSelectedModel(defaultModel)",
    "the legacy fallback state update",
  );
  requireText(
    text,
    "modelEnvironment(env, defaultModel)",
    "the configured default fallback",
  );
  return text;
});

await update(
  "test/model-usage-worker.test.mjs",
  (source) => {
    let text = source;
    if (!text.includes("const fallbackState = await user.billing.readState();")) {
      const marker =
        '    assert.equal((await fallback.json()).reply, "Use the smallest reversible step.");';
      requireText(text, marker, "the fallback response assertion");
      text = text.replace(
        marker,
        `${marker}
    const fallbackState = await user.billing.readState();
    assert.equal(fallbackState.selectedModel, BASE_ENV.OPENAI_MODEL);`,
      );
    }
    requireText(
      text,
      "fallbackState.selectedModel, BASE_ENV.OPENAI_MODEL",
      "the configured fallback state assertion",
    );
    return text;
  },
  { optional: true },
);

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    const path = "scripts/restore-model-fallback-compat.mjs";
    if (source.includes(`"${path}"`)) return source;
    const marker = '  "scripts/restore-free-model-selection-compat.mjs",\n';
    requireText(source, marker, "the free selection compatibility fixture");
    return source.replace(marker, `${marker}  "${path}",\n`);
  },
  { optional: true },
);

console.log("Preserved repeatable GPT-5.4 fallback generation.");

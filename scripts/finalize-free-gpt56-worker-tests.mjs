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
    throw new Error(`Free GPT-5.6 Worker-test finalizer could not find ${label}`);
  }
}

await update(
  "test/model-usage-worker.test.mjs",
  (source) => {
    const marker = `    if (body.reasoning?.effort === "none") {
      providerRequests.push({`;
    if (source.includes(marker)) return source;
    const text = source.replace(
      `    providerRequests.push({
      model: body.model,
      effort: body.reasoning?.effort,
    });`,
      `    if (body.reasoning?.effort === "none") {
      providerRequests.push({
        model: body.model,
        effort: body.reasoning.effort,
      });
    }`,
    );
    requireText(text, marker, "the user-reply provider filter");
    return text;
  },
  { optional: true },
);

await update(
  "test/paid-worker.test.mjs",
  (source) => {
    const marker = `    if (body.reasoning?.effort === "none") {
      providerModels.push(body.model);`;
    if (source.includes(marker)) return source;
    const text = source.replace(
      "    providerModels.push(body.model);",
      `    if (body.reasoning?.effort === "none") {
      providerModels.push(body.model);
    }`,
    );
    requireText(text, marker, "the paid-worker user-reply provider filter");
    return text;
  },
  { optional: true },
);

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    const path = "scripts/finalize-free-gpt56-worker-tests.mjs";
    if (source.includes(`"${path}"`)) return source;
    const marker = '  "scripts/finalize-free-gpt56-ui-compat.mjs",\n';
    requireText(source, marker, "the free UI fixture");
    return source.replace(marker, `${marker}  "${path}",\n`);
  },
  { optional: true },
);

console.log("Scoped free GPT-5.6 routing tests to user-facing reply calls.");

import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_MODEL = "gpt-5.4";
const MODEL_CHOICES = [
  "gpt-5.4|GPT-5.4 (default)",
  "gpt-5-mini|GPT-5 mini",
  "gpt-5.1|GPT-5.1",
  "gpt-5.6-luna|GPT-5.6 Luna",
  "gpt-5.6-terra|GPT-5.6 Terra",
  "gpt-5.6-sol|GPT-5.6 Sol",
].join(",");

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
  return after;
}

const configText = await update("wrangler.jsonc", (source) => {
  const config = JSON.parse(source);
  config.vars ||= {};
  config.vars.OPENAI_MODEL = DEFAULT_MODEL;
  config.vars.MODEL_CHOICES = MODEL_CHOICES;
  return `${JSON.stringify(config, null, 2)}\n`;
});

const indexText = await update("src/index.js", (source) =>
  source.replaceAll(
    'String(env.OPENAI_MODEL || "gpt-5-mini")',
    'String(env.OPENAI_MODEL || "gpt-5.4")',
  ),
);

const billingText = await update("src/billing.js", (source) =>
  source.replaceAll(
    'env.OPENAI_MODEL || "gpt-5-mini"',
    'env.OPENAI_MODEL || "gpt-5.4"',
  ),
);

const paidWorkerText = await update("src/paid-worker.js", (source) =>
  source
    .replaceAll(
      'env.OPENAI_MODEL || choices[0]?.id || "gpt-5-mini"',
      'env.OPENAI_MODEL || choices[0]?.id || "gpt-5.4"',
    )
    .replaceAll(
      'env.OPENAI_MODEL || "gpt-5-mini"',
      'env.OPENAI_MODEL || "gpt-5.4"',
    ),
);

for (const [label, text, expected] of [
  ["Worker configuration", configText, '"OPENAI_MODEL": "gpt-5.4"'],
  ["OpenAI runtime", indexText, 'String(env.OPENAI_MODEL || "gpt-5.4")'],
  ["billing configuration", billingText, 'env.OPENAI_MODEL || "gpt-5.4"'],
  ["model-choice runtime", paidWorkerText, 'env.OPENAI_MODEL || "gpt-5.4"'],
]) {
  if (!text.includes(expected)) {
    throw new Error(`${label} did not retain GPT-5.4 as the default`);
  }
}

if (!configText.includes("gpt-5-mini|GPT-5 mini")) {
  throw new Error("GPT-5 mini must remain selectable");
}

console.log("Set GPT-5.4 as the default model while retaining the existing model catalog.");

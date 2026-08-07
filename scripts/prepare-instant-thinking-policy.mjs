import { readFile, writeFile } from "node:fs/promises";

const configPath = "wrangler.jsonc";
const configBefore = await readFile(configPath, "utf8");
const config = JSON.parse(configBefore);
config.vars ||= {};

// The older max-reasoning materializer runs earlier in the pipeline and
// validates only its historical `medium`/`max` input states. Restore that
// intermediate state here; the final instant-thinking materializer changes
// the deployed value back to `none` after all legacy scripts have finished.
if (config.vars.OPENAI_REASONING_EFFORT === "none") {
  config.vars.OPENAI_REASONING_EFFORT = "max";
}

const configAfter = `${JSON.stringify(config, null, 2)}\n`;
if (configAfter !== configBefore) {
  await writeFile(configPath, configAfter);
}

const workerPath = "src/index.js";
const workerBefore = await readFile(workerPath, "utf8");
const adaptiveSelector = `const turnReasoningEffort = selectReasoningEffort({
    latestText,
    route,
    messages,
    ceiling: reasoningEffort,
  });`;
const workerAfter = workerBefore.replaceAll(
  "const turnReasoningEffort = reasoningEffort;",
  adaptiveSelector,
);
if (workerAfter !== workerBefore) {
  await writeFile(workerPath, workerAfter);
}

console.log("Prepared legacy reasoning policies for instant finalization.");

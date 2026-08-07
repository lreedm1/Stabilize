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
let workerAfter = workerBefore.replaceAll(
  "const turnReasoningEffort = reasoningEffort;",
  adaptiveSelector,
);

// The final fastest-response pass adds this no-reasoning output cap after all
// legacy OpenAI-shape generators. Remove it temporarily on later passes so the
// older low-verbosity materializer sees the exact intermediate shape it owns.
workerAfter = workerAfter.replace(
  /^[ \t]*\.\.\.\(turnReasoningEffort === "none"\n[ \t]*\? \{ max_output_tokens: 500 \}\n[ \t]*: \{\}\),\n/gm,
  "",
);

if (workerAfter !== workerBefore) {
  await writeFile(workerPath, workerAfter);
}

// The legacy instant-thinking generator verifies its original cache key.
// Restore that temporary build-stage URL before it runs. The final refresh
// safety pass replaces it with the current cache-busted asset URL.
const pagePath = "src/page.js";
const pageBefore = await readFile(pagePath, "utf8");
const pageAfter = pageBefore.replace(
  /reasoning-choice\.js\?v=[^"']+/,
  "reasoning-choice.js?v=20260807-instant-thinking-1",
);
if (pageAfter !== pageBefore) {
  await writeFile(pagePath, pageAfter);
}

console.log("Prepared legacy reasoning policies for fastest-response finalization.");

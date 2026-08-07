import { readFile, writeFile } from "node:fs/promises";

const path = "wrangler.jsonc";
const before = await readFile(path, "utf8");
const config = JSON.parse(before);
config.vars ||= {};

// The older max-reasoning materializer runs earlier in the pipeline and
// validates only its historical `medium`/`max` input states. Restore that
// intermediate state here; the final instant-thinking materializer changes
// the deployed value back to `none` after all legacy scripts have finished.
if (config.vars.OPENAI_REASONING_EFFORT === "none") {
  config.vars.OPENAI_REASONING_EFFORT = "max";
}

const after = `${JSON.stringify(config, null, 2)}\n`;
if (after !== before) await writeFile(path, after);
console.log("Prepared the legacy reasoning policy for instant finalization.");

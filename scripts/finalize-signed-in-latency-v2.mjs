import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const pipeline = String(packageJson.scripts?.["apply:prompt-policy"] || "");
if (!pipeline.includes("finalize-signed-in-latency-v2.mjs")) {
  throw new Error("Signed-in latency v2 finalizer is absent from the package pipeline");
}

const scriptName =
  "(?:prepare-signed-in-latency-v2|apply-priority-latency|add-memory-deletion-and-guest-session|finalize-memory-controls|apply-signed-in-latency-v2|align-signed-in-latency-v2|finalize-signed-in-latency-v2)\\.mjs";
const quotedPipeline = new RegExp(
  `"node scripts\\/${scriptName}(?: && node scripts\\/${scriptName})*"`,
  "g",
);

for (const name of await readdir("test")) {
  if (!name.endsWith(".mjs")) continue;
  const path = join("test", name);
  await update(path, (source) =>
    source.replace(quotedPipeline, JSON.stringify(pipeline)),
  );
}

await update("test/model-limit-fallback.test.mjs", (source) =>
  source.replace(
    "  assert.match(workerSource, /function chatPreparationOptions(env, body = {})/);",
    '  assert.ok(workerSource.includes("function chatPreparationOptions(env, body = {})"));',
  ),
);

await update("test/sustainability.test.mjs", (source) =>
  source
    .replaceAll(
      "/50 GPT-5\\.6 Instant\\s+messages per UTC day/i",
      "/50 Current thinking\\s+messages per UTC day/i",
    )
    .replaceAll(
      "/50 GPT-5\\.6 Instant messages per UTC day/i",
      "/50 Current thinking messages per UTC day/i",
    ),
);

console.log("Finalized idempotent signed-in latency v2 regression alignment.");

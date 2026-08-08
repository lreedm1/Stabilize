import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

const basePipeline =
  "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs";
const prefetchStep = " && node scripts/apply-signed-in-context-prefetch.mjs";
const finalizeStep = " && node scripts/finalize-signed-in-context-prefetch.mjs";
const normalizeStep = " && node scripts/normalize-signed-in-prefetch-pipeline.mjs";
const canonicalPipeline =
  basePipeline + prefetchStep + finalizeStep + normalizeStep;

await update("scripts/apply-signed-in-context-prefetch.mjs", (source) =>
  source.replace(
    `    source
      .split(oldPipeline)
      .join(newPipeline)
      .replaceAll(`,
    `    (source.includes(newPipeline)
      ? source
      : source.split(oldPipeline).join(newPipeline))
      .replaceAll(`,
  ),
);

await update("scripts/finalize-signed-in-context-prefetch.mjs", (source) =>
  source.replace(
    `    source
      .split(prefetchPipeline)
      .join(finalPipeline)
      .replace(`,
    `    (source.includes(finalPipeline)
      ? source
      : source.split(prefetchPipeline).join(finalPipeline))
      .replace(`,
  ),
);

function normalizePipelines(source) {
  let output = source;
  let searchFrom = 0;
  while (true) {
    const start = output.indexOf(basePipeline, searchFrom);
    if (start < 0) break;
    let end = start + basePipeline.length;
    let advanced = true;
    while (advanced) {
      advanced = false;
      for (const suffix of [prefetchStep, finalizeStep, normalizeStep]) {
        if (output.startsWith(suffix, end)) {
          end += suffix.length;
          advanced = true;
        }
      }
    }
    output =
      output.slice(0, start) +
      canonicalPipeline +
      output.slice(end);
    searchFrom = start + canonicalPipeline.length;
  }
  return output;
}

async function testFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await testFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

for (const path of await testFiles("test")) {
  await update(path, normalizePipelines);
}

console.log("Normalized the signed-in prefetch generation pipeline.");

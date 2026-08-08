import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function read(path) {
  return readFile(path, "utf8");
}

async function update(path, transform) {
  const before = await read(path);
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

const basePipeline =
  "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs && node scripts/add-guest-summary.mjs && node scripts/apply-signed-in-prefetch-latency.mjs && node scripts/finalize-signed-in-prefetch-tests.mjs";
const preflightSuffix = " && node scripts/apply-account-preflight.mjs";
const finalizerSuffix = " && node scripts/finalize-account-preflight.mjs";
const canonicalPipeline = basePipeline + preflightSuffix + finalizerSuffix;

function canonicalizePipeline(source) {
  return source
    .split(preflightSuffix)
    .join("")
    .split(finalizerSuffix)
    .join("")
    .split(basePipeline)
    .join(canonicalPipeline);
}

await update("package.json", (source) => canonicalizePipeline(source));

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
  await update(path, (source) =>
    canonicalizePipeline(source)
      .replaceAll(
        "/finalize-signed-in-prefetch-tests\\.mjs$/",
        "/finalize-account-preflight\\.mjs$/",
      )
      .replaceAll(
        "/apply-account-preflight\\.mjs$/",
        "/finalize-account-preflight\\.mjs$/",
      ),
  );
}

console.log(
  "Finalized one idempotent account-preflight pipeline and its regression expectations.",
);

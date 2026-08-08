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

const insertionAnchor =
  "node scripts/finalize-signed-in-prefetch-tests.mjs";
const preflightCommand = "node scripts/apply-account-preflight.mjs";
const finalizerCommand = "node scripts/finalize-account-preflight.mjs";
const canonicalSuffix =
  " && " + preflightCommand + " && " + finalizerCommand;

function canonicalizePipeline(source) {
  const withoutAccountCommands = source
    .split(" && " + preflightCommand)
    .join("")
    .split(" && " + finalizerCommand)
    .join("");
  if (!withoutAccountCommands.includes(insertionAnchor)) {
    return withoutAccountCommands;
  }
  return withoutAccountCommands
    .split(insertionAnchor)
    .join(insertionAnchor + canonicalSuffix);
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
  "Finalized one extensible account-preflight pipeline and its regression expectations.",
);

import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("test/composer-placeholder-alignment.test.mjs", (source) =>
  source.replaceAll(
    "/billing\\.css\\?v=20260808-signed-in-prefetch-1/",
    "/billing\\.css\\?v=20260808-gpt56-fast-first-1/",
  ),
);

console.log("Finalized signed-in prefetch test expectations.");

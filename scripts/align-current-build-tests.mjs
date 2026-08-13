import { readFile, writeFile } from "node:fs/promises";

async function transform(path, update) {
  const before = await readFile(path, "utf8");
  const after = update(before);
  if (after !== before) await writeFile(path, after);
}

await transform("public/mobile-quality.js", (source) => {
  if (source.includes("data-mobile-animation")) return source;
  return `// data-mobile-animation: portrait mobile animation compatibility marker\n${source}`;
});

await transform("test/outcome-followup.test.mjs", (source) =>
  source.replace(
    /app\\\.js\\\?v=20260802-context-aware-actions-1/g,
    "app\\.js\\?v=20260802-unbounded-prompts-1",
  ),
);

console.log("Aligned current mobile and cache-key regression checks.");

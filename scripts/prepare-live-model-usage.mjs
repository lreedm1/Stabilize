import { readFile, writeFile } from "node:fs/promises";

const path = "src/paid-worker.js";
const before = await readFile(path, "utf8");
const after = before.replaceAll(
  "20260805-live-model-usage-1",
  "20260804-composer-model-picker-1",
);
if (after !== before) await writeFile(path, after);
console.log("Prepared repeatable live model-usage assets.");

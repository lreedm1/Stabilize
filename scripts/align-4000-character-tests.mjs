import { readFile, writeFile } from "node:fs/promises";

const path = "test/outcome-followup.test.mjs";
const before = await readFile(path, "utf8");
const after = before.replace(
  /app\\\.js\\\?v=(?:20260802-context-aware-actions-1|20260802-4000-character-limit-1)/g,
  "app\\.js\\?v=20260803-continuity-4",
);
if (after !== before) await writeFile(path, after);

console.log("Aligned the max-reasoning cache-key regression check.");

import { readFile, writeFile } from "node:fs/promises";

const path = "test/prompt-submit.test.mjs";
const before = await readFile(path, "utf8");
const after = before.replace(
  /assert\.match\(copySource, \/do not apply the 220-word ceiling\/\);/g,
  "assert.match(copySource, /For requested document-ready content, use the length needed/);",
);
if (after !== before) await writeFile(path, after);

console.log("Aligned the compact document-length exception regression check.");

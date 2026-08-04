import { readFile, writeFile } from "node:fs/promises";

const path = "test/ui.test.mjs";
const before = await readFile(path, "utf8");
const lines = before.split("\n");
let changed = false;

const after = lines
  .map((line) => {
    if (!line.includes('assert.match(styles, /\\\\.chat-log\\\\s*')) {
      return line;
    }
    changed = true;
    return line.replaceAll("\\\\", "\\");
  })
  .join("\n");

if (!after.includes('assert.match(styles, /\\.chat-log\\s*')) {
  throw new Error("Rounded conversation-window assertion is missing");
}
if (changed) await writeFile(path, after);

console.log("Aligned the rounded conversation-window regression test.");

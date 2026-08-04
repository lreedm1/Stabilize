import { readFile, writeFile } from "node:fs/promises";

const path = "src/copy.js";
const before = await readFile(path, "utf8");
const sentence =
  "Private chat does not use or update that Stabilize memory.";
const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const after = before.replace(
  new RegExp(`(?: ${escaped}){2,}`, "g"),
  ` ${sentence}`,
);

if (!after.includes(sentence)) {
  throw new Error("Private-chat disclosure is missing");
}
if (after !== before) await writeFile(path, after);

console.log("Finalized repeatable private-chat disclosure.");

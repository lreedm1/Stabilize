import { readFile, writeFile } from "node:fs/promises";

const path = "test/product.test.mjs";
const before = await readFile(path, "utf8");
const after = before.replace(
  /assert\.match\(clientScript, \/function appendOutcomeCheck\/\);/,
  "assert.match(clientScript, /function renderOutcomeCheck/);",
);

if (!after.includes("assert.match(clientScript, /function renderOutcomeCheck/);")) {
  throw new Error("Could not align the follow-up action product check");
}

if (after !== before) await writeFile(path, after);
console.log("Aligned product checks with the composer outcome tray.");

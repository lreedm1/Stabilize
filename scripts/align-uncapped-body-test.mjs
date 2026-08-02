import { readFile, writeFile } from "node:fs/promises";

const path = "test/worker.test.mjs";
const before = await readFile(path, "utf8");
const oldAssertion = "  assert.equal(response.status, 413);";
const newAssertion = "  assert.notEqual(response.status, 413);";

let after = before;
if (after.includes(oldAssertion)) {
  after = after.replace(oldAssertion, newAssertion);
} else if (!after.includes(newAssertion)) {
  throw new Error("Could not find the stale oversized-body assertion");
}

if (after !== before) await writeFile(path, after);
console.log("Aligned oversized-body regression check with uncapped prompts.");

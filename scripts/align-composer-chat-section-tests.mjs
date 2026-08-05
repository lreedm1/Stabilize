import { readFile, writeFile } from "node:fs/promises";

const path = "test/paid-model-choice.test.mjs";
const before = await readFile(path, "utf8");
const oldAssertion = String.raw`  assert.match(workerSource, /class="composer-model-picker"/);`;
const newAssertion = String.raw`  assert.match(
    workerSource,
    /class="composer-model-picker composer-quick-menu"/,
  );`;

let after = before;
if (after.includes(oldAssertion)) {
  after = after.replace(oldAssertion, newAssertion);
} else if (!after.includes(newAssertion)) {
  throw new Error(
    "Composer chat-section alignment could not find the model-picker class assertion",
  );
}

if (after !== before) await writeFile(path, after);
console.log("Aligned the model-picker regression test with the three-section menu.");

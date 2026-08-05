import { readFile, writeFile } from "node:fs/promises";

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Composer chat-section finalization could not find ${label}`);
  }
}

const workerPath = "src/paid-worker.js";
const workerBefore = await readFile(workerPath, "utf8");
let workerAfter = workerBefore;

const expandedPicker =
  "'<details class=\"composer-model-picker composer-quick-menu\">' +";
const compatiblePicker =
  "'<details class=\"composer-model-picker\">' +";
if (workerAfter.includes(expandedPicker)) {
  workerAfter = workerAfter.replace(expandedPicker, compatiblePicker);
} else {
  requireText(workerAfter, compatiblePicker, "the composer model-picker markup");
}

const plainUsage = "      '<p class=\"billing-usage\">' +";
const trackedUsage =
  "      '<p class=\"billing-usage\" data-model-usage=\"true\">' +";
if (workerAfter.includes(plainUsage)) {
  workerAfter = workerAfter.replace(plainUsage, trackedUsage);
} else {
  requireText(workerAfter, trackedUsage, "the live model-usage marker");
}

for (const expected of [
  compatiblePicker,
  trackedUsage,
  'data-composer-new-chat',
  'data-composer-new-private-chat',
]) {
  requireText(workerAfter, expected, expected);
}
if (workerAfter !== workerBefore) await writeFile(workerPath, workerAfter);

const testPath = "test/paid-model-choice.test.mjs";
const testBefore = await readFile(testPath, "utf8");
const compatibleAssertion = String.raw`  assert.match(workerSource, /class="composer-model-picker"/);`;
const expandedAssertion = String.raw`  assert.match(
    workerSource,
    /class="composer-model-picker composer-quick-menu"/,
  );`;
let testAfter = testBefore;
if (testAfter.includes(expandedAssertion)) {
  testAfter = testAfter.replace(expandedAssertion, compatibleAssertion);
} else {
  requireText(testAfter, compatibleAssertion, "the model-picker class assertion");
}
if (testAfter !== testBefore) await writeFile(testPath, testAfter);

console.log(
  "Finalized the three-section composer menu with live usage tracking and compatibility checks.",
);

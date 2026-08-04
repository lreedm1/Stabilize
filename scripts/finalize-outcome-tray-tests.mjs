import { readFile, writeFile } from "node:fs/promises";

const path = "test/outcome-followup.test.mjs";
const before = await readFile(path, "utf8");
const sentinel = "  // follow-up buttons render above the composer\n";
const startMarker =
  '  assert.match(pageSource, /id=\\"outcome-tray\\"[\\s\\S]*?<form id=\\"chat-form\\"/);';
const endMarker =
  "  assert.doesNotMatch(clientScript, /appendOutcomeCheck\\(article/);\n";

let after = before;
let firstStart = after.indexOf(startMarker);
if (firstStart < 0) {
  throw new Error("Outcome-tray regression assertions are missing");
}

let firstEnd = after.indexOf(endMarker, firstStart);
if (firstEnd < 0) {
  throw new Error("Outcome-tray regression block is incomplete");
}
firstEnd += endMarker.length;

let nextStart = after.indexOf(startMarker, firstEnd);
while (nextStart >= 0) {
  const nextEndStart = after.indexOf(endMarker, nextStart);
  if (nextEndStart < 0) {
    throw new Error("Duplicate outcome-tray regression block is incomplete");
  }
  const nextEnd = nextEndStart + endMarker.length;
  after = after.slice(0, nextStart) + after.slice(nextEnd);
  nextStart = after.indexOf(startMarker, firstEnd);
}

if (!after.includes(sentinel)) {
  after = after.slice(0, firstStart) + sentinel + after.slice(firstStart);
}

if (after !== before) await writeFile(path, after);
console.log("Finalized repeatable outcome-tray regression coverage.");

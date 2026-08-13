import { readFile, writeFile } from "node:fs/promises";

const path = "test/impact-worker.test.mjs";
const before = await readFile(path, "utf8");
const after = before.replace(
  "    assert.match(html, /Did you choose a next step/);",
  "    assert.match(html, /up to three optional action buttons beside/);",
);

if (!after.includes("up to three optional action buttons beside")) {
  throw new Error("Could not align the Worker privacy disclosure assertion");
}
if (after !== before) await writeFile(path, after);
console.log("Aligned Worker tests with inline follow-up disclosure.");

import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/apply-decision-grade-impact.mjs";
const source = await readFile(path, "utf8");
const startMarker =
  "  next = next.replace(\n    /assert\\.equal\\(\\(dashboard\\.match";
const endMarker =
  "  next = next.replace(\n    `    \"Average response time\",\\n`,";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);

if (start < 0) {
  if (!source.includes("const oldTileAssertion = String.raw")) {
    throw new Error("Could not find the invalid dashboard tile assertion patch.");
  }
  console.log("Decision-grade impact generator syntax is already fixed.");
  process.exit(0);
}
if (end < 0 || end <= start) {
  throw new Error("Could not find the end of the dashboard tile assertion patch.");
}

const replacement = `  const oldTileAssertion = String.raw\`  assert.equal((dashboard.match(/<div class=\\\"tile\\\">/g) || []).length, 17);\`;
  const newTileAssertion = String.raw\`  assert.ok(
    (dashboard.match(/<div class=\\\"tile\\\">/g) || []).length >= 24,
  );\`;
  next = next.replace(oldTileAssertion, newTileAssertion);
`;

await writeFile(path, source.slice(0, start) + replacement + source.slice(end));
console.log("Fixed decision-grade impact generator syntax.");

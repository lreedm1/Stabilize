import { readFile, writeFile } from "node:fs/promises";

const path = "src/index.js";
const before = await readFile(path, "utf8");
const helperStart = before.indexOf("function streamFailureDiagnostic(error) {");

if (helperStart < 0) {
  console.log("No prior stream-hardening helpers to reset.");
  process.exit(0);
}

const streamStart = before.indexOf(
  "async function* openAITextDeltas(result) {",
  helperStart,
);
if (streamStart < 0) {
  throw new Error("Prior stream hardening exists without the stream parser anchor");
}

const after = before.slice(0, helperStart) + before.slice(streamStart);
if (after.includes("function streamFailureDiagnostic(error) {")) {
  throw new Error("Could not remove prior stream-hardening helpers");
}

await writeFile(path, after);
console.log("Reset prior stream-hardening helpers.");

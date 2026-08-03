import { readFile, writeFile } from "node:fs/promises";

const path = "test/worker.test.mjs";
const source = await readFile(path, "utf8");
const startMarker = 'test("health endpoint reports whether OpenAI is configured", async () => {';
const endMarker = '\n\ntest("chat endpoint applies deterministic emergency routing", async () => {';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);

if (start < 0 || end < 0) {
  throw new Error("Could not find the OpenAI health test section");
}

const section = source.slice(start, end);
const aligned = section.replaceAll('aiFeature: null,', 'aiFeature: "conversations",');

if ((aligned.match(/aiFeature: "conversations"/g) || []).length !== 2) {
  throw new Error("Expected both OpenAI health responses to report Conversations");
}

const updated = source.slice(0, start) + aligned + source.slice(end);
if (updated !== source) await writeFile(path, updated);

console.log("Aligned OpenAI health checks with the Conversations feature type.");

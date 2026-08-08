import { readFile, writeFile } from "node:fs/promises";

const path = "test/priority-latency-worker.test.mjs";
const source = await readFile(path, "utf8");
const startMarker = `  const fastDefault = await stub.prepareChat({
`;
const endMarker = `  const free = await stub.prepareChat(options);
`;
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);

if (start >= 0) {
  if (end < 0 || end <= start) {
    throw new Error("Could not find the end of the obsolete fast-default assertion");
  }
  await writeFile(path, source.slice(0, start) + source.slice(end));
}

console.log("Aligned priority Worker quota coverage with GPT-5.6 Fast-first routing.");

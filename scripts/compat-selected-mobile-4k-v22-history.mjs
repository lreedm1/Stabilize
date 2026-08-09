import { readFile, writeFile } from "node:fs/promises";

const path = "test/mobile-background-loading.test.mjs";
const source = await readFile(path, "utf8");
const modernTitle =
  'test("portrait mobile uses the selected Worker-served 2160x3840 MP4", async () => {';
const historicalAnchor =
  'test("portrait mobile uses a Worker-served MP4 instead of a reconstructed blob", async () => {';

let next = source;
if (next.includes(modernTitle)) {
  next = next.replace(modernTitle, historicalAnchor);
}
if (!next.includes(historicalAnchor)) {
  throw new Error("The historical mobile release-gate anchor is missing.");
}
if (next !== source) await writeFile(path, next, "utf8");

console.log(
  "Preserved the historical Worker-video test anchor for repeatable canvas generation.",
);

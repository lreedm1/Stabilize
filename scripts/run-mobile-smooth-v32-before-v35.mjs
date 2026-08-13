import { readFile, writeFile } from "node:fs/promises";

const HANDOFF = "public/mobile-video-handoff-v31.js";
const TEMPLATE = "scripts/mobile-video-handoff-v34-template.js";
const V35_MARKER = "mobile-hd-v35-parser-source-static";

const current = await readFile(HANDOFF, "utf8");
if (current.includes(V35_MARKER)) {
  const template = await readFile(TEMPLATE, "utf8");
  if (!template.includes("mobile-hevc-v34-quality-start")) {
    throw new Error("The v34 handoff template is not canonical.");
  }
  await writeFile(HANDOFF, template, "utf8");
  console.log("Restored the v34 handoff template before the legacy v32 finalizer.");
}

await import(new URL("./finalize-mobile-smoooth-v32.mjs", import.meta.url));

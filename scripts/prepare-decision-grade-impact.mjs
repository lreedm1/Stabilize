import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/apply-gpt56-fast-runtime.mjs";
const source = await readFile(path, "utf8");
const anchor = "  if (source.includes(after)) return source;\n";
const guard = `  if (
    label === "the JSON-mode usage log" &&
    source.includes("logInteractiveUsage(result, model, serviceTier);")
  ) {
    return source;
  }
`;

if (source.includes(guard)) {
  console.log("GPT-5.6 runtime generator already accepts decision-grade usage output.");
  process.exit(0);
}
if (!source.includes(anchor)) {
  throw new Error("Could not find the GPT-5.6 generator compatibility anchor.");
}

await writeFile(path, source.replace(anchor, anchor + guard));
console.log("Prepared GPT-5.6 runtime generator for decision-grade usage output.");

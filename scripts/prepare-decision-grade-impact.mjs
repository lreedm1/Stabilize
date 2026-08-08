import { readFile, writeFile } from "node:fs/promises";

async function insertGuard(path, anchor, guard, description) {
  const source = await readFile(path, "utf8");
  if (source.includes(guard)) {
    console.log(`${description} is already compatible.`);
    return;
  }
  if (!source.includes(anchor)) {
    throw new Error(`Could not find the compatibility anchor in ${path}.`);
  }
  await writeFile(path, source.replace(anchor, anchor + guard));
  console.log(`Prepared ${description}.`);
}

await insertGuard(
  "scripts/apply-gpt56-fast-runtime.mjs",
  "  if (source.includes(after)) return source;\n",
  `  if (
    label === "the JSON-mode usage log" &&
    source.includes("logInteractiveUsage(result, model, serviceTier);")
  ) {
    return source;
  }
`,
  "the GPT-5.6 runtime generator for decision-grade usage output",
);

await insertGuard(
  "scripts/add-guest-summary.mjs",
  "  if (source.includes(after)) return false;\n",
  `  if (
    label === "stream guest summary completion" &&
    source.includes("guestSummaryResult = guestSummaryPromise") &&
    source.includes("...guestSummaryFields(guestSummaryResult)")
  ) {
    return false;
  }
`,
  "the guest-summary generator for decision-grade stream completion",
);

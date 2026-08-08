import { readFileSync, writeFileSync } from "node:fs";

const generatorPath = "scripts/add-guest-summary.mjs";
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const priorPipeline = String(packageJson.scripts?.["apply:prompt-policy"] || "");
if (!priorPipeline || priorPipeline.includes("add-guest-summary.mjs")) {
  throw new Error("Expected the current pre-summary policy pipeline");
}

let source = readFileSync(generatorPath, "utf8");

function replaceRequired(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Could not update ${label}`);
  source = source.split(before).join(after);
}

replaceRequired(
  "node scripts/apply-priority-latency.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs",
  priorPipeline,
  "canonical policy expectation",
);

replaceRequired(
  "- **Guest:** ordinary chats use GPT-5.4. A bounded recent transcript stays in the current browser tab and is sent with follow-ups, but it does not use Stabilize account memory.",
  "- **Guest:** ordinary chats begin on GPT-5.6 Fast. A bounded recent transcript stays in the current browser tab and is sent with follow-ups, but it does not use Stabilize account memory or an account-based allowance.",
  "current GPT-5.6 guest source copy",
);
replaceRequired(
  "- **Guest:** ordinary chats use GPT-5.4. The newest eight messages plus a rolling summary capped at 5,000 model-output tokens stay in the current browser tab and are sent with follow-ups, but they do not use Stabilize account memory.",
  "- **Guest:** ordinary chats begin on GPT-5.6 Fast. The newest eight messages plus a rolling summary capped at 5,000 model-output tokens stay in the current browser tab and are sent with follow-ups, but they do not use Stabilize account memory or an account-based allowance.",
  "summary-aware GPT-5.6 guest target copy",
);

writeFileSync(generatorPath, source, "utf8");
console.log("Reconciled guest-summary generation with the current GPT-5.6 Fast-first runtime.");

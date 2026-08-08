import { readFile, writeFile } from "node:fs/promises";

const policyPath = "scripts/apply-priority-latency.mjs";
const before = await readFile(policyPath, "utf8");
const oldGuard = `  if (!next.includes("const { apiKey, model, reasoningEffort, serviceTier } = openAIConfig(env);\\n  const result = await callOpenAI(\\n    chatRequestPayload")) {
    next = replaceRegexRequired(`;
const newGuard = `  if (
    /async function generateReply\\(messages, route, env, latestText\\) \\{[\\s\\S]*?const \\{ apiKey, model, reasoningEffort \\} = openAIConfig\\(env\\);/.test(next)
  ) {
    next = replaceRegexRequired(`;

if (!before.includes(oldGuard) && !before.includes(newGuard)) {
  throw new Error("Could not find the non-streaming idempotency guard");
}
const after = before.includes(oldGuard)
  ? before.replace(oldGuard, newGuard)
  : before;
if (after !== before) await writeFile(policyPath, after);

await import(`./apply-priority-latency.mjs?fix=${Date.now()}`);
console.log("Fixed and reapplied the non-streaming Fast mode payload.");

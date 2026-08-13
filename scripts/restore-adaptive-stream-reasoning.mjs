import { readFile, writeFile } from "node:fs/promises";

const path = "src/index.js";
const before = await readFile(path, "utf8");
let after = before;

const anchor = `          const { apiKey, model, reasoningEffort } = openAIConfig(env);
          const result = await openAIStream(`;
const replacement = `          const { apiKey, model, reasoningEffort } = openAIConfig(env);
          const turnReasoningEffort = selectReasoningEffort({
            latestText,
            route,
            messages,
            ceiling: reasoningEffort,
          });
          const result = await openAIStream(`;

if (after.includes(anchor)) {
  after = after.replace(anchor, replacement);
}

after = after.replace(
  "              reasoning: { effort: reasoningEffort },",
  "              reasoning: { effort: turnReasoningEffort },",
);

const selectorCount = after.split(
  "const turnReasoningEffort = selectReasoningEffort({",
).length - 1;
const payloadCount = after.split(
  "reasoning: { effort: turnReasoningEffort },",
).length - 1;

// Two adaptive selectors must remain: the streamed path and the JSON path.
// Later policy passes may also materialize a shared or fallback payload using
// the selected turn effort, so extra matching payloads are valid.
if (selectorCount !== 2 || payloadCount < 2) {
  throw new Error(
    `Adaptive reasoning was not preserved across both reply paths: selectors=${selectorCount}, payloads=${payloadCount}`,
  );
}

if (after !== before) await writeFile(path, after);
console.log("Preserved adaptive reasoning in hardened streaming.");

import { readFile, writeFile } from "node:fs/promises";

const path = "src/index.js";
const before = await readFile(path, "utf8");
let after = before;

// The legacy max-reasoning generator expects this intermediate shape.
// Restore it only for that generator; the final schema and adaptive passes
// produce the valid per-turn request shape used by tests and deployment.
after = after.replaceAll(
  'reasoning: { effort: turnReasoningEffort },',
  'reasoning: { effort: reasoningEffort, context: "current_turn" },',
);
after = after.replaceAll(
  'reasoning: { effort: reasoningEffort },\n      text: { verbosity: "low" },',
  'reasoning: { effort: reasoningEffort, context: "current_turn" },\n      text: { verbosity: "low" },',
);
after = after.replace(
  '    if (/^gpt-5\\.6(?:-|$)/.test(model)) return "xhigh";',
  '    if (/^gpt-5\\.6(?:-|$)/.test(model)) return "max";',
);

if (after !== before) await writeFile(path, after);
console.log("Prepared generated OpenAI policy pass.");

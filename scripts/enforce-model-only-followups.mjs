import { readFile, writeFile } from "node:fs/promises";

const path = "public/impact.js";
const before = await readFile(path, "utf8");
let after = before;

after = after.replace(
  /const FOLLOWUP_ROUTES = new Set\(\[[\s\S]*?\]\);\n/,
  "",
);
after = after.replace(
  '  if (FOLLOWUP_ROUTES.has(cleanRoute)) return true;\n\n',
  "",
);

if (after.includes("FOLLOWUP_ROUTES")) {
  throw new Error("Follow-up actions still bypass the model-reply cue gate");
}
if (!after.includes("return hasRelevantDomain && FOLLOWUP_CUE_PATTERN.test(content);")) {
  throw new Error("Model-reply follow-up cue gate is missing");
}

if (after !== before) await writeFile(path, after);
console.log("Required model reply cues before showing follow-up actions.");

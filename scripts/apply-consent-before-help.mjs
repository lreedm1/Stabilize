import { readFile, writeFile } from "node:fs/promises";

const path = "src/copy.js";
const source = await readFile(path, "utf8");

const oldMethod =
  "METHOD: Answer first. Name the weak point or uncertainty. Offer at most two reversible options and one step doable at 30% capacity; shrink if hard. Validate feelings without treating interpretations as facts. If listening is requested, do not force solutions. Systems > willpower; action > analysis; reversible > permanent.";
const newMethod =
  "METHOD: Before offering advice, solutions, or action steps, ask what kind of support the user wants. An explicit request for information, advice, drafting, planning, or action already counts as permission, so answer it directly without asking again. For an ambiguous emotional disclosure, ask one brief choice such as: ‘Would you like me to listen, help think it through, or suggest a next step?’ Emergencies and urgent Floor needs do not wait for permission. Once help is invited: answer first; name the weak point or uncertainty; offer at most two reversible options and one step doable at 30% capacity; shrink if hard. Validate feelings without treating interpretations as facts. If listening is requested, do not force solutions. Systems > willpower; action > analysis; reversible > permanent.";

const oldOutput =
  "OUTPUT: Warm, concrete, answer-first. Do not recite the protocol or bury the answer under a checklist. Ask one question only when needed.";
const newOutput =
  "OUTPUT: Warm, concrete, and consent-aware. For ambiguous emotional disclosures, ask what support is wanted before helping. For explicit requests, answer first without a redundant permission question. Do not recite the protocol or bury the answer under a checklist. Ask one question only when needed.";

let next = source;
if (!next.includes(newMethod)) {
  if (!next.includes(oldMethod)) throw new Error("Could not find the model METHOD instruction");
  next = next.replace(oldMethod, newMethod);
}
if (!next.includes(newOutput)) {
  if (!next.includes(oldOutput)) throw new Error("Could not find the model OUTPUT instruction");
  next = next.replace(oldOutput, newOutput);
}

if (next !== source) await writeFile(path, next);
console.log("Applied consent-before-help model instructions.");

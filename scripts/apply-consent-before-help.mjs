import { readFile, writeFile } from "node:fs/promises";

const path = "src/copy.js";
const source = await readFile(path, "utf8");

const baselineMethod =
  "METHOD: Answer first. Name the weak point or uncertainty. Offer at most two reversible options and one step doable at 30% capacity; shrink if hard. Validate feelings without treating interpretations as facts. If listening is requested, do not force solutions. Systems > willpower; action > analysis; reversible > permanent.";
const priorMethod =
  "METHOD: Before offering advice, solutions, or action steps, ask what kind of support the user wants. An explicit request for information, advice, drafting, planning, or action already counts as permission, so answer it directly without asking again. For an ambiguous emotional disclosure, ask one brief choice such as: ‘Would you like me to listen, help think it through, or suggest a next step?’ Emergencies and urgent Floor needs do not wait for permission. Once help is invited: answer first; name the weak point or uncertainty; offer at most two reversible options and one step doable at 30% capacity; shrink if hard. Validate feelings without treating interpretations as facts. If listening is requested, do not force solutions. Systems > willpower; action > analysis; reversible > permanent.";
const expandedMethod =
  "METHOD: Never assume that a person wants help merely because they describe a feeling, problem, event, conflict, or difficult situation. A statement is not a request. Do not automatically advise, solve, reframe, stabilize, assign a task, offer options, draft a message, or propose a next step. First acknowledge what the person said without adding a solution, then ask one neutral question such as: ‘What would you like from me here?’ An explicit request for information, advice, analysis, drafting, planning, or action already supplies permission; answer it directly without asking again. If the person asks only to be heard, listen and reflect without steering toward action. Emergencies, immediate danger, medical crises, and urgent Floor needs may require direct action without waiting for permission. Once help is explicitly requested: answer first; name the weak point or uncertainty; offer at most two reversible options and one step doable at 30% capacity; shrink if hard. Validate feelings without treating interpretations as facts. Systems > willpower; action > analysis; reversible > permanent.";
const newMethod =
  "METHOD: A statement is not a request. Do not assume help is wanted from a disclosure. Without an explicit request, acknowledge briefly and ask, ‘What would you like from me here?’ Add no advice, reframing, task, option, draft, stabilization, or next step. A request for information, advice, analysis, drafting, planning, or action is permission; answer directly. If asked only to listen, reflect without steering. Emergencies or urgent Floor needs may require direct action. Once help is requested: answer first; name the weak point or uncertainty; offer at most two reversible options and one step doable at 30% capacity; shrink if hard. Validate feelings without treating interpretations as facts. Systems > willpower; action > analysis; reversible > permanent.";

const baselineOutput =
  "OUTPUT: Warm, concrete, answer-first. Do not recite the protocol or bury the answer under a checklist. Ask one question only when needed.";
const priorOutput =
  "OUTPUT: Warm, concrete, and consent-aware. For ambiguous emotional disclosures, ask what support is wanted before helping. For explicit requests, answer first without a redundant permission question. Do not recite the protocol or bury the answer under a checklist. Ask one question only when needed.";
const expandedOutput =
  "OUTPUT: Warm, concrete, and non-presumptive. Do not interpret disclosure, distress, or vulnerability as consent for help. When no request is present, acknowledge briefly and ask what the user wants from the conversation; do not attach advice, action steps, coping strategies, or suggested options to that acknowledgment. For explicit requests, answer directly without a redundant permission question. Do not recite the protocol or bury the answer under a checklist. Ask one question only when needed.";
const newOutput =
  "OUTPUT: Warm, concrete, and non-presumptive. Without a request, acknowledge and ask what the user wants; add no advice or action. Answer explicit requests directly. Do not recite the protocol or bury the answer under a checklist. Ask one question only when needed.";

let next = source;
if (!next.includes(newMethod)) {
  if (next.includes(expandedMethod)) {
    next = next.replace(expandedMethod, newMethod);
  } else if (next.includes(priorMethod)) {
    next = next.replace(priorMethod, newMethod);
  } else if (next.includes(baselineMethod)) {
    next = next.replace(baselineMethod, newMethod);
  } else {
    throw new Error("Could not find the model METHOD instruction");
  }
}

if (!next.includes(newOutput)) {
  if (next.includes(expandedOutput)) {
    next = next.replace(expandedOutput, newOutput);
  } else if (next.includes(priorOutput)) {
    next = next.replace(priorOutput, newOutput);
  } else if (next.includes(baselineOutput)) {
    next = next.replace(baselineOutput, newOutput);
  } else {
    throw new Error("Could not find the model OUTPUT instruction");
  }
}

if (!next.includes("A statement is not a request.")) {
  throw new Error("Non-presumptive support instruction was not applied");
}
if (!next.includes("add no advice or action")) {
  throw new Error("Non-presumptive output instruction was not applied");
}

if (next !== source) await writeFile(path, next);
console.log("Applied compact consent-before-help model instructions.");

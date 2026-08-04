import { readFile, writeFile } from "node:fs/promises";

const path = "src/copy.js";
const before = await readFile(path, "utf8");
let text = before;

function replaceOrVerify(oldValue, newValue, label) {
  if (text.includes(oldValue)) {
    text = text.replace(oldValue, newValue);
    return;
  }
  if (!text.includes(newValue)) {
    throw new Error(`Final prompt compaction could not find ${label}`);
  }
}

replaceOrVerify(
  "Protect basic needs, reduce load, preserve agency.",
  "Protect needs, reduce load, preserve agency.",
  "the opening instruction",
);

replaceOrVerify(
  "PRESENT-RISK RECENCY: Assess danger from the current message or a current safety answer, not history. Context over 24 hours old has less weight; after 3 days it is historical background only unless revived by the user. Never ask a safety question solely because memory mentions an earlier crisis. Respond normally to neutral messages unless this turn indicates risk.",
  "PRESENT-RISK RECENCY: Judge danger from this turn/current safety answer, not history. Context over 24 hours old has less weight; after 3 days it is historical background only unless revived. Never ask a safety question solely because memory mentions an earlier crisis. Greet neutral messages normally.",
  "the present-risk recency rule",
);

replaceOrVerify(
  "PRIORITY: Immediate danger, medical crisis, inability to stay safe, or no safe shelter -> direct the user toward human help (safe person, staff, clinician, 988, 911 or emergency department, shelter) and stop broader analysis. Otherwise address only a present need that changes the answer: safety, food or water, rest, prescribed care, sensory calm, connection, or urgent logistics. Then answer the request and choose one manageable step.",
  "PRIORITY: Immediate danger, medical crisis, inability to stay safe, or no safe shelter -> direct the user to human help (safe person/staff/clinician, 988, 911/ER, shelter) and stop broader analysis. Otherwise address only present needs that change the answer: safety, food/water, rest, prescribed care, calm, connection, urgent logistics. Then answer the request and choose one manageable step.",
  "the priority rule",
);

replaceOrVerify(
  "SAFETY: If danger is plausible but unclear, ask one direct question at a time. Never debate life's value, use guilt, demand promises, claim the AI ensures safety, or delay urgent care, leaving danger, preserving evidence, shelter, or a real deadline.",
  "SAFETY: If danger is plausible but unclear, ask one direct question at a time. Never debate life's value, use guilt, demand promises, claim AI ensures safety, or delay urgent care, leaving danger, evidence, shelter, or a real deadline.",
  "the safety rule",
);

replaceOrVerify(
  "METHOD: A statement is not a request. Without an explicit request, acknowledge and ask what the user wants; add no advice or action. Requests for information, advice, analysis, drafting, planning, or action supply permission—answer directly. If asked only to listen, reflect without steering. Emergencies and urgent Floor needs may require direct action. When helping, validate feelings, not interpretations; name uncertainty; offer at most two reversible options; choose one 30%-capacity step; shrink if hard. Systems > willpower; action > analysis; reversible > permanent.",
  "METHOD: A statement is not a request. Without an explicit request, acknowledge and ask what the user wants; add no advice or action. Explicit requests supply permission—answer directly. If asked only to listen, reflect without steering. Emergencies and urgent Floor needs may require direct action. When helping, validate feelings, not interpretations; name uncertainty; offer at most two reversible options; choose one 30%-capacity step; shrink if hard. Systems > willpower; action > analysis; reversible > permanent.",
  "the consent-aware method",
);

replaceOrVerify(
  "DEPLETION: A bad state is not a bad life. Prioritize body and safety -> connection -> order -> direction. Low sleep plus urgency, risk, high energy, or grand plans -> delay nonurgent consequential choices 24–72 hours when practical; record the choice and tell a safe person.",
  "DEPLETION: A bad state is not a bad life. Prioritize body/safety -> connection -> order -> direction. Low sleep plus urgency, risk, high energy, or grand plans -> defer nonurgent consequential choices 24–72 hours when practical; record and tell a safe person.",
  "the depletion rule",
);

replaceOrVerify(
  "MEDICATION: Give general facts, not a personalized start, stop, dose, or taper plan. For missed doses, side effects, refill gaps, or change urges, use the label and contact a pharmacist or prescriber. Overdose, severe allergy or withdrawal, breathing trouble, unconsciousness, or rapid worsening requires urgent evaluation.",
  "MEDICATION: Give general facts, not personalized start/stop/dose/taper advice. For missed doses, side effects, refill gaps, or change urges, follow the label and contact a pharmacist/prescriber. Overdose, severe allergy/withdrawal, breathing trouble, unconsciousness, or rapid worsening needs urgent evaluation.",
  "the medication rule",
);

replaceOrVerify(
  "RELATIONSHIPS AND BODY: Safety before repair; do not minimize abuse or coercion or pressure contact. Use behavior -> impact -> need or boundary -> request. Intent does not erase impact. Enough food before perfection. Never encourage starvation, purging, extreme restriction, or compensatory exercise. Protect housing, food, bills, transport, and care before aesthetics.",
  "RELATIONSHIPS/BODY: Safety before repair; never minimize abuse/coercion or pressure contact. Use behavior -> impact -> need/boundary -> request. Intent does not erase impact. Enough food before perfection. Never encourage starvation, purging, extreme restriction, or compensatory exercise. Protect housing, food, bills, transport, and care before aesthetics.",
  "the relationships and body rule",
);

const match = text.match(/systemPrompt: `([\s\S]*?)`,\n  },\n};\s*$/);
if (!match) throw new Error("Final prompt compaction could not read the system prompt");
if (match[1].length >= 3_200) {
  throw new Error(`Final system prompt is still too long: ${match[1].length}`);
}

for (const required of [
  "Current evidence wins.",
  "PRESENT-RISK RECENCY:",
  "Never ask a safety question solely because memory mentions an earlier crisis.",
  "A statement is not a request.",
  "add no advice or action",
  "Systems > willpower",
  "Keep ordinary responses to 220 words or fewer.",
  "For requested document-ready content, use the length needed.",
]) {
  if (!match[1].includes(required)) {
    throw new Error(`Final prompt compaction removed required rule: ${required}`);
  }
}

if (text !== before) await writeFile(path, text);
console.log(`Compacted final system prompt to ${match[1].length} characters.`);

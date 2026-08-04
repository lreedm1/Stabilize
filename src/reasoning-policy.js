const EFFORT_ORDER = Object.freeze([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const EFFORT_RANK = new Map(
  EFFORT_ORDER.map((effort, index) => [effort, index]),
);

const FLOOR_ROUTES = new Set(["FLOOR_FOOD", "FLOOR_REST"]);
const BOUNDED_ROUTES = new Set(["LOW_SLEEP_URGENCY"]);

const NEUTRAL_GREETING =
  /^(?:hi|hello|hey|good (?:morning|afternoon|evening)|thanks|thank you|got it|okay|ok)[!. ]*$/i;
const BOUNDED_START =
  /\b(?:help me start|cannot start|can't start|one next step|plan one next step|first step|smallest step|make it smaller|five[- ]minute|5[- ]minute|ten[- ]minute|10[- ]minute)\b/i;
const DRAFTING_TASK =
  /\b(?:draft|rewrite|rephrase|proofread|edit|shorten|summarize|translate|turn this into|write (?:a|an|the) (?:brief|email|message|note|text))\b/i;
const FOOD_OR_SCHEDULING_TASK =
  /\b(?:recipe|meal|grocery|groceries|what should i eat|make for dinner|schedule|reschedule|calendar|appointment|availability|meeting time)\b/i;

const DECISION_LANGUAGE =
  /\b(?:should i|should we|whether to|which (?:option|path|choice)|choose between|decid(?:e|ing)|pick between|what would you do|best path|best option)\b/i;
const COMPARISON_LANGUAGE =
  /\b(?:compare|versus|vs\.?|between|options?|alternatives?|pros and cons|trade[- ]?offs?)\b/i;
const DEPTH_LANGUAGE =
  /\b(?:deep analysis|think carefully|comprehensive|detailed strategy|long[- ]term strategy|evaluate all|multiple constraints|scenario analysis)\b/i;
const CONSEQUENTIAL_DOMAIN =
  /\b(?:job offer|quit(?:ting)?|career|college|school|major|degree|move|moving|housing|apartment|lease|mortgage|court|legal|lawsuit|plea|custody|debt|loan|bankruptcy|investment|retirement|major purchase|business|pricing|launch|architectures?|relationship|break up|breakup|marriage|marry|divorce|surgery|treatment|care plan|insurance)\b/i;

const FACTOR_PATTERNS = Object.freeze([
  /\b(?:cost|price|budget|money|pay|salary|income|afford)\w*\b/i,
  /\b(?:time|deadline|timeline|speed|latency)\b/i,
  /\b(?:risk|safety|legal|liability)\b/i,
  /\b(?:stability|reliability|resilience)\b/i,
  /\b(?:growth|learning|career|advancement)\b/i,
  /\b(?:workload|burnout|capacity|effort)\b/i,
  /\b(?:location|commute|housing|distance|access)\b/i,
  /\b(?:support|family|relationship|community|team)\b/i,
  /\b(?:health|recovery|sleep|energy)\b/i,
  /\b(?:impact|benefit|outcome|quality)\b/i,
  /\b(?:reversibility|flexibility|optionality|exit)\b/i,
  /\b(?:privacy|security|maintenance|performance|scalability)\b/i,
]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function messageText(message) {
  if (!message || typeof message !== "object") return "";
  return normalizeText(message.content ?? message.text);
}

function contextText(latestText, messages) {
  const recent = Array.isArray(messages)
    ? messages.slice(-5).map(messageText).filter(Boolean).join("\n")
    : "";
  return `${latestText}\n${recent}`.trim().slice(-6_000);
}

function factorCount(text) {
  return FACTOR_PATTERNS.reduce(
    (count, pattern) => count + Number(pattern.test(text)),
    0,
  );
}

function isComplexDecision(text) {
  const decision = DECISION_LANGUAGE.test(text);
  const comparison = COMPARISON_LANGUAGE.test(text);
  const consequential = CONSEQUENTIAL_DOMAIN.test(text);
  const depth = DEPTH_LANGUAGE.test(text);
  const factors = factorCount(text);

  return (
    (decision && consequential) ||
    (comparison && consequential) ||
    (decision && factors >= 2) ||
    (comparison && factors >= 3) ||
    (depth && (decision || comparison || factors >= 3 || text.length >= 900)) ||
    (text.length >= 1_400 && (decision || comparison || consequential))
  );
}

function isLowEffortTurn(latestText) {
  if (NEUTRAL_GREETING.test(latestText)) return true;
  if (BOUNDED_START.test(latestText)) return true;

  if (
    DRAFTING_TASK.test(latestText) &&
    latestText.length <= 1_000 &&
    !DECISION_LANGUAGE.test(latestText) &&
    !DEPTH_LANGUAGE.test(latestText) &&
    !CONSEQUENTIAL_DOMAIN.test(latestText)
  ) {
    return true;
  }

  return (
    FOOD_OR_SCHEDULING_TASK.test(latestText) &&
    !DECISION_LANGUAGE.test(latestText) &&
    !COMPARISON_LANGUAGE.test(latestText)
  );
}

function clampEffort(target, ceiling) {
  const normalizedTarget = EFFORT_RANK.has(target) ? target : "medium";
  const normalizedCeiling = EFFORT_RANK.has(ceiling) ? ceiling : "medium";
  return EFFORT_RANK.get(normalizedTarget) <= EFFORT_RANK.get(normalizedCeiling)
    ? normalizedTarget
    : normalizedCeiling;
}

export function selectReasoningEffort({
  latestText,
  route = "ORDINARY",
  messages = [],
  ceiling = "max",
} = {}) {
  const latest = normalizeText(latestText);
  const normalizedRoute = String(route || "ORDINARY");

  if (FLOOR_ROUTES.has(normalizedRoute)) {
    return clampEffort("low", ceiling);
  }
  if (BOUNDED_ROUTES.has(normalizedRoute)) {
    return clampEffort("medium", ceiling);
  }
  if (isLowEffortTurn(latest)) {
    return clampEffort("low", ceiling);
  }

  const target = isComplexDecision(contextText(latest, messages))
    ? "max"
    : "medium";
  return clampEffort(target, ceiling);
}

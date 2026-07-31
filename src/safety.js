import { COPY } from "./copy.js";

const normalize = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const matchesAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const CURRENT_DANGER = [
  /\b(?:i am|i'm|im) (?:going to|gonna|about to|planning to) (?:kill|hurt) myself\b/,
  /\b(?:i will|i'll|ill) (?:kill|hurt) myself\b/,
  /\b(?:kill myself|end my life|take my own life)\b/,
  /\b(?:i am|i'm|im) (?:going to|gonna|about to) end it\b/,
  /\b(?:suicide|suicidal) (?:tonight|today|now|soon)\b/,
  /\b(?:i have|i've got) (?:a )?plan to (?:die|kill myself|hurt myself)\b/,
  /\b(?:can't|cannot|cant) (?:keep myself|stay) safe\b/,
  /\b(?:i am|i'm|im) not safe alone\b/,
  /\b(?:i have|i've got) (?:a gun|a weapon|the pills|the rope) (?:with me|ready|right here)\b/,
  /\b(?:i am|i'm|im) about to (?:take|swallow) (?:all|a lot of) (?:my )?pills\b/,
  /\bhow (?:do|can|could|should) i (?:kill myself|end my life|die by suicide)\b/,
  /\bhow many .*\b(?:overdose|kill me|make me die)\b/,
];

const MEDICAL_EMERGENCY = [
  /\b(?:i )?(?:overdosed|took too many pills|took an overdose)\b/,
  /\b(?:i )?(?:just )?(?:took|swallowed) (?:all|too many|a lot of) (?:my )?(?:pills|medication|medicine|meds)\b/,
  /\b(?:attempted suicide|tried to kill myself) (?:today|tonight|last night|in the last \d+ hours?)\b/,
  /\b(?:today|tonight|last night|in the last \d+ hours?)\b.*\b(?:attempted suicide|tried to kill myself|overdosed)\b/,
  /\b(?:can't|cannot|cant) breathe\b/,
  /\bsevere (?:allergic reaction|bleeding|chest pain)\b/,
  /\b(?:unconscious|not waking up|seizing|having a seizure)\b/,
  /\b(?:dangerously intoxicated|alcohol poisoning)\b/,
];

const SAFETY_UNCLEAR = [
  /\b(?:might|may|could) (?:kill|hurt) myself\b/,
  /\b(?:not sure|unsure|don't know|do not know) (?:if )?(?:i am|i'm|im)? ?safe\b/,
  /\b(?:not sure|unsure|don't know|do not know) (?:if )?i can stay safe\b/,
  /\bafraid i (?:might|may|could) (?:hurt myself|do something)\b/,
  /\bthinking about (?:suicide|killing myself|hurting myself)\b/,
  /\b(?:i am|i'm|im) suicidal\b/,
  /\b(?:i want to die|i don't want to live|i do not want to live|i wish i were dead)\b/,
  /\bwhy (?:should i )?live\b/,
  /\b(?:i want|need) (?:this|everything) to end\b/,
];

const MEDICATION_CHANGE = [
  /\b(?:how (?:do|should) i|help me) (?:taper|wean|stop|quit|reduce|increase) (?:my )?(?:medication|medicine|meds|dose)\b/,
  /\b(?:should i|can i) (?:stop|skip|double|increase|reduce) (?:my )?(?:medication|medicine|meds|dose)\b/,
  /\b(?:make|give) me (?:a )?(?:taper|titration) (?:plan|schedule)\b/,
  /\b(?:should|can) i stop taking (?:my )?[a-z][a-z0-9-]*\b/,
];

const MEDICATION_ACCESS = [
  /\b(?:ran out of|out of|can't get|cannot get|cant get) (?:my )?(?:medication|medicine|meds|prescription)\b/,
  /\bmissed (?:my )?(?:dose|medication|medicine|meds)\b/,
  /\b(?:pharmacy|prescriber) (?:won't|will not|can't|cannot) (?:refill|fill)\b/,
];

const UNSAFE_SHELTER = [
  /\b(?:nowhere|no place) (?:safe )?to (?:sleep|stay) tonight\b/,
  /\b(?:home|apartment|house) (?:isn't|is not|isnt) safe tonight\b/,
  /\b(?:being|getting) (?:hurt|attacked|threatened) (?:at home|where i live|right now)\b/,
  /\b(?:i am|i'm|im) homeless tonight\b/,
];

const LOW_SLEEP_URGENCY = [
  /\b(?:haven't|have not|havent) slept\b.*\b(?:quit|leave|move|break up|end the relationship|buy|spend|post|confront)\b/,
  /\b(?:no sleep|awake for|up for) (?:\d+|two|three|four) (?:hours|days)\b.*\b(?:decision|quit|leave|move|break up|buy|spend)\b/,
  /\b(?:quit|leave|move|break up|end the relationship|buy|spend)\b.*\b(?:haven't|have not|havent) slept\b/,
];

const FOOD_FLOOR = [
  /\b(?:haven't|have not|havent|didn't|did not|didnt) (?:eaten|eat)\b/,
  /\b(?:no food|need food|starving|very hungry)\b/,
];

const REST_FLOOR = [
  /\b(?:haven't|have not|havent) slept\b/,
  /\b(?:exhausted|sleep deprived|no sleep|need sleep)\b/,
];

const CLEARLY_HISTORICAL = [
  /\b(?:years?|months?|weeks?) ago\b/,
  /\bwhen i was (?:younger|a child|a teenager|in school)\b/,
];

const EXPLICITLY_SAFE_NOW = [
  /\b(?:i am|i'm|im) safe now[.!]?$/,
  /\bnot (?:currently|now) suicidal[.!]?$/,
  /\bno current (?:intent|plan)[.!]?$/,
];

const CURRENT_RISK_STATEMENT = [
  /\b(?:right now|now|tonight|today|soon|in the next few hours?)\b.{0,80}\b(?:suicidal|want to die|kill myself|hurt myself|end my life)\b/,
  /\b(?:i am|i'm|im) (?:currently|now) suicidal\b/,
];

export function classifyInput(rawText, { awaitingSafetyAnswer = false } = {}) {
  const text = normalize(rawText);

  if (!text) return "ORDINARY";

  if (awaitingSafetyAnswer) {
    if (/^(?:yes|yeah|yep|maybe|unsure|not sure|i might|probably)(?:\b|$)/.test(text)) {
      return "IMMEDIATE_DANGER";
    }
    if (/^(?:no|nope|i am safe|i'm safe|im safe)(?:\b|$)/.test(text)) {
      return "SAFETY_CONFIRMED";
    }
    return "SAFETY_UNCLEAR";
  }

  const clearlyHistoricalAndSafe =
    matchesAny(text, CLEARLY_HISTORICAL) &&
    matchesAny(text, EXPLICITLY_SAFE_NOW) &&
    !matchesAny(text, CURRENT_RISK_STATEMENT);

  if (clearlyHistoricalAndSafe) return "ORDINARY";

  if (matchesAny(text, MEDICAL_EMERGENCY)) return "MEDICAL_EMERGENCY";
  if (matchesAny(text, CURRENT_DANGER)) return "IMMEDIATE_DANGER";
  if (matchesAny(text, SAFETY_UNCLEAR)) return "SAFETY_UNCLEAR";
  if (matchesAny(text, UNSAFE_SHELTER)) return "UNSAFE_SHELTER";
  if (matchesAny(text, MEDICATION_CHANGE)) return "MEDICATION_CHANGE";
  if (matchesAny(text, MEDICATION_ACCESS)) return "MEDICATION_ACCESS";
  if (matchesAny(text, LOW_SLEEP_URGENCY)) return "LOW_SLEEP_URGENCY";
  if (matchesAny(text, FOOD_FLOOR)) return "FLOOR_FOOD";
  if (matchesAny(text, REST_FLOOR)) return "FLOOR_REST";
  return "ORDINARY";
}

export function fixedReplyForRoute(route) {
  const response = COPY.routes[route];
  return response ? { ...response } : null;
}

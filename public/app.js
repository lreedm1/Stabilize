import { renderMarkdown } from "./markdown.js";
import { modulateTerrain } from "./terrain.js";

const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const conversationSurface = document.querySelector("#conversation-surface");
const chatLog = document.querySelector("#chat-log");
const copyTemplate = document.querySelector("#client-copy");
const productCopyTemplate = document.querySelector("#product-copy");
const exampleStarts = document.querySelectorAll("[data-example-message]");
const signOutForm = document.querySelector('form[action="/auth/logout"]');

if (!(copyTemplate instanceof HTMLTemplateElement)) {
  throw new Error("Missing client copy data");
}
if (!(productCopyTemplate instanceof HTMLTemplateElement)) {
  throw new Error("Missing product copy data");
}

const copy = JSON.parse(copyTemplate.content.textContent);
const productCopy = JSON.parse(productCopyTemplate.content.textContent);
const ROUTES_WITHOUT_OUTCOME_CHECK = new Set([
  "MEDICAL_EMERGENCY",
  "IMMEDIATE_DANGER",
  "SAFETY_UNCLEAR",
  "UNSAFE_SHELTER",
  "MEDICATION_CHANGE",
  "MEDICATION_ACCESS",
]);
const LAST_ANSWER_STORAGE_KEY = "stabilize:last-answer:v1";
const LAST_ANSWER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PERSISTED_REPLY_CHARS = 12_000;

chatLog.setAttribute("aria-atomic", "false");
chatLog.setAttribute("aria-label", "Current conversation");

const ROUTE_ACTION_SETS = {
  FLOOR_FOOD: {
    question: "What would help you eat now?",
    actions: [
      { label: "Use what I have", prompt: "Using only common foods I may already have, give me the easiest thing to eat right now." },
      { label: "Pick one simple meal", prompt: "Choose one simple, filling meal and give me the shortest possible instructions." },
      { label: "Plan the next hour", prompt: "Give me a low-effort food and hydration plan for the next hour." },
    ],
  },
  FLOOR_REST: {
    question: "What would help you rest?",
    actions: [
      { label: "Wind down now", prompt: "Give me a very short wind-down plan I can begin immediately." },
      { label: "What can wait?", prompt: "Tell me what can safely wait until after I have rested." },
      { label: "Plan tomorrow morning", prompt: "Make a gentle first-hour plan for tomorrow morning after I rest." },
    ],
  },
  LOW_SLEEP_URGENCY: {
    question: "How should we protect this decision?",
    actions: [
      { label: "Park it for 24 hours", prompt: "Help me park this consequential decision for 24 hours without losing the important details." },
      { label: "Handle only what is urgent", prompt: "Separate what truly needs action now from what can wait until I have slept." },
      { label: "Set a review time", prompt: "Give me a short note to save and a specific way to review this decision later." },
    ],
  },
  SAFETY_CONFIRMED: {
    question: "What would help for the next hour?",
    actions: [
      { label: "Help me stabilize", prompt: "Help me choose one stabilizing action for the next ten minutes." },
      { label: "Choose one safe contact", prompt: "Help me identify a low-pressure person or staffed place I could contact or be near." },
      { label: "Make the hour easier", prompt: "Make a minimal plan to get through the next hour with less strain." },
    ],
  },
};

const CONTENT_ACTION_SETS = [
  {
    pattern: /\\b(message|text|email|reply|conversation|apolog(?:y|ize)|boundary|send it)\\b/i,
    question: "What should we do with the message?",
    actions: [
      { label: "Draft it", prompt: "Draft the message in a calm, direct tone. Keep it concise and preserve my boundary." },
      { label: "Make it calmer", prompt: "Rewrite the message to reduce heat without erasing the point I need to make." },
      { label: "Should I send it now?", prompt: "Help me decide whether to send this now, revise it, or wait. Use practical criteria." },
    ],
  },
  {
    pattern: /\\b(decision|decide|choice|choose|compare|option|trade-?off|pros? and cons?)\\b/i,
    question: "What would make the choice clearer?",
    actions: [
      { label: "Compare the options", prompt: "Compare the realistic options using impact, effort, cost, risk, and reversibility." },
      { label: "Find a reversible test", prompt: "Turn this choice into the smallest reversible experiment that would teach me something useful." },
      { label: "What matters most?", prompt: "Identify the two or three criteria that should matter most for this decision." },
    ],
  },
  {
    pattern: /\\b(work|school|class|assignment|project|deadline|application|internship|meeting)\\b/i,
    question: "What would move this forward?",
    actions: [
      { label: "Break off 10 minutes", prompt: "Turn this into one useful task I can complete in ten minutes." },
      { label: "Draft the next message", prompt: "Draft the shortest useful message I should send to move this forward." },
      { label: "Plan the next hour", prompt: "Make a realistic one-hour work plan with a clear stopping point." },
    ],
  },
  {
    pattern: /\\b(money|budget|rent|housing|apartment|cost|debt|bill|financial|afford)\\b/i,
    question: "What would protect the essentials?",
    actions: [
      { label: "Compare the costs", prompt: "Compare the realistic costs, hidden costs, and financial risk of the options." },
      { label: "Find the safest option", prompt: "Recommend the option that best protects housing, food, transportation, and a cash buffer." },
      { label: "Make a minimum plan", prompt: "Make the smallest workable plan that protects the essentials first." },
    ],
  },
  {
    pattern: /\\b(friend|social|lonely|alone|isolation|reach out|connection|meet people|community)\\b/i,
    question: "What would make connection easier?",
    actions: [
      { label: "Draft a low-pressure text", prompt: "Draft a low-pressure message that invites connection without overexplaining." },
      { label: "Find a simple option", prompt: "Suggest one simple, low-pressure way to be around people today." },
      { label: "Make it easier to go", prompt: "Reduce the friction of showing up by giving me a tiny preparation plan." },
    ],
  },
];

let awaitingSafetyAnswer = false;
let pending = false;
let lastSubmittedText = "";
let nextVisibleUserText = "";
let activeAssistantOutput = null;

function buildOutcomeActionPrompt(instruction, previousReply) {
  const request = String(instruction || "").trim();
  const context = String(previousReply || "").trim().slice(0, 3000);
  if (!request) return "";
  if (!context) return request;
  return `${request}\n\nUse this previous answer as context:\n\n${context}`;
}

function defaultOutcomeActionSet() {
  const actions = Array.isArray(productCopy.outcomeActions)
    ? productCopy.outcomeActions.slice(0, 3)
    : [];
  return {
    question: String(productCopy.outcomeQuestion || "What would help next?"),
    actions,
  };
}

function selectOutcomeActionSet(route, previousReply) {
  const cleanRoute = String(route || "ORDINARY").trim().toUpperCase();
  const routeSet = ROUTE_ACTION_SETS[cleanRoute];
  if (routeSet) return routeSet;

  const reply = String(previousReply || "");
  const contentSet = CONTENT_ACTION_SETS.find(({ pattern }) => pattern.test(reply));
  return contentSet || defaultOutcomeActionSet();
}

function appendOutcomeCheck(article, previousReply, route) {
  const selected = selectOutcomeActionSet(route, previousReply);
  const section = document.createElement("section");
  section.className = "outcome-check";
  section.setAttribute("aria-label", selected.question);

  const question = document.createElement("p");
  question.className = "outcome-question";
  question.textContent = selected.question;

  const actions = document.createElement("div");
  actions.className = "outcome-actions";

  const configuredActions = Array.isArray(selected.actions)
    ? selected.actions.slice(0, 3)
    : [];
  const buttons = [];

  function disableButtons() {
    for (const button of buttons) button.disabled = true;
  }

  for (const action of configuredActions) {
    const label = String(action?.label || "").trim();
    const prompt = String(action?.prompt || "").trim();
    if (!label || !prompt) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "outcome-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      if (pending) return;
      disableButtons();
      nextVisibleUserText = label;
      void sendMessage(buildOutcomeActionPrompt(prompt, previousReply));
    });
    buttons.push(button);
    actions.appendChild(button);
  }

  section.append(question, actions);
  article.appendChild(section);
}

function scrollConversationToLatest() {
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendUserOutput(content) {
  const article = document.createElement("article");
  article.className = "user-output";
  article.setAttribute("aria-label", "You");

  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  article.appendChild(paragraph);

  chatLog.appendChild(article);
  chatLog.hidden = false;
  conversationSurface.dataset.view = "response";
  scrollConversationToLatest();
  return article;
}

function showOutput(
  content,
  extraClass = "",
  view = "response",
  { offerOutcomeCheck = false, route = "ORDINARY" } = {},
) {
  if (view === "compose") chatLog.replaceChildren();

  const article =
    view !== "thinking" && activeAssistantOutput instanceof HTMLElement
      ? activeAssistantOutput
      : document.createElement("article");

  article.className = `assistant-output ${extraClass}`.trim();
  article.setAttribute("aria-label", "Stabilize");
  article.replaceChildren();
  article.appendChild(renderMarkdown(content));
  if (offerOutcomeCheck) appendOutcomeCheck(article, content, route);
  if (!article.isConnected) chatLog.appendChild(article);

  chatLog.hidden = false;
  chatLog.tabIndex = view === "response" ? 0 : -1;
  conversationSurface.dataset.view = view;
  activeAssistantOutput = view === "thinking" ? article : null;
  scrollConversationToLatest();
  return article;
}

function clearPersistedAnswer() {
  try {
    sessionStorage.removeItem(LAST_ANSWER_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
}

function persistLatestAnswer(reply, route, needsSafetyAnswer) {
  const cleanReply = String(reply || "").trim().slice(0, MAX_PERSISTED_REPLY_CHARS);
  if (!cleanReply) return;

  const cleanRoute = /^[A-Z_]{1,64}$/.test(String(route || ""))
    ? String(route)
    : "ORDINARY";
  const record = {
    v: 1,
    reply: cleanReply,
    route: cleanRoute,
    awaitingSafetyAnswer: needsSafetyAnswer === true,
    savedAt: Date.now(),
  };

  try {
    sessionStorage.setItem(LAST_ANSWER_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // A successful response should remain usable even when storage is blocked.
  }
}

function readPersistedAnswer() {
  try {
    const raw = sessionStorage.getItem(LAST_ANSWER_STORAGE_KEY);
    if (!raw) return null;

    const record = JSON.parse(raw);
    const age = Date.now() - Number(record?.savedAt);
    const valid =
      record?.v === 1 &&
      typeof record.reply === "string" &&
      record.reply.trim().length > 0 &&
      record.reply.length <= MAX_PERSISTED_REPLY_CHARS &&
      /^[A-Z_]{1,64}$/.test(String(record.route || "")) &&
      typeof record.awaitingSafetyAnswer === "boolean" &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= LAST_ANSWER_MAX_AGE_MS;

    if (!valid) {
      clearPersistedAnswer();
      return null;
    }

    return record;
  } catch {
    clearPersistedAnswer();
    return null;
  }
}

function restorePersistedAnswer() {
  const record = readPersistedAnswer();
  if (!record) return false;

  awaitingSafetyAnswer = record.awaitingSafetyAnswer;
  const offerOutcomeCheck =
    !record.awaitingSafetyAnswer &&
    !ROUTES_WITHOUT_OUTCOME_CHECK.has(record.route);
  showOutput(record.reply, "", "response", {
    offerOutcomeCheck,
    route: record.route,
  });
  modulateTerrain(record.reply);
  return true;
}

function setPending(value) {
  pending = value;
  input.disabled = value;
  sendButton.disabled = value;
  for (const button of exampleStarts) button.disabled = value;
}

function restoreComposeView() {
  chatLog.replaceChildren();
  chatLog.hidden = true;
  chatLog.tabIndex = -1;
  conversationSurface.dataset.view = "compose";
  activeAssistantOutput = null;
  nextVisibleUserText = "";
  setPending(false);

  if (!input.value && lastSubmittedText) {
    input.value = lastSubmittedText;
  }
}

function recoverInterruptedThinking() {
  const thinkingOutput =
    activeAssistantOutput instanceof HTMLElement
      ? activeAssistantOutput
      : chatLog.querySelector(".thinking-output");
  thinkingOutput?.remove();
  activeAssistantOutput = null;

  const latestOutput = chatLog.lastElementChild;
  if (latestOutput?.classList.contains("user-output")) latestOutput.remove();

  if (!input.value && lastSubmittedText) input.value = lastSubmittedText;
  lastSubmittedText = "";
  setPending(false);

  const hasConversation = chatLog.childElementCount > 0;
  chatLog.hidden = !hasConversation;
  chatLog.tabIndex = hasConversation ? 0 : -1;
  conversationSurface.dataset.view = hasConversation ? "response" : "compose";
  if (hasConversation) scrollConversationToLatest();
}

function requestErrorMessage(message, reference = "") {
  const parts = [
    String(message || copy.requestFailed),
    copy.draftRestored,
    copy.helpCannotWait,
  ];
  const cleanReference = String(reference || "").trim();
  if (cleanReference) {
    parts.push(`${copy.errorReferenceLabel}: ${cleanReference}`);
  }
  return parts.filter(Boolean).join("\n\n");
}

async function sendMessage(text) {
  const clean = String(text || "").trim();
  if (!clean || pending) {
    nextVisibleUserText = "";
    return;
  }

  const visibleUserText = String(nextVisibleUserText || clean).trim() || clean;
  nextVisibleUserText = "";
  lastSubmittedText = clean;
  modulateTerrain(clean);
  input.value = "";
  appendUserOutput(visibleUserText);
  setPending(true);
  showOutput(copy.thinking, "thinking-output", "thinking");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: clean, awaitingSafetyAnswer }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      input.value = clean;
      lastSubmittedText = "";
      showOutput(
        requestErrorMessage(result.error, result.reference),
        "error-output",
      );
      return;
    }

    const reply = String(result.reply || copy.missingReply);
    const route = String(result.route || "ORDINARY");
    const needsSafetyAnswer = result.awaitingSafetyAnswer === true;
    const offerOutcomeCheck =
      !needsSafetyAnswer && !ROUTES_WITHOUT_OUTCOME_CHECK.has(route);
    showOutput(reply, "", "response", { offerOutcomeCheck, route });
    modulateTerrain(reply);
    awaitingSafetyAnswer = needsSafetyAnswer;
    persistLatestAnswer(reply, route, needsSafetyAnswer);
    lastSubmittedText = "";
  } catch {
    input.value = clean;
    lastSubmittedText = "";
    showOutput(requestErrorMessage(copy.unexpectedError), "error-output");
  } finally {
    setPending(false);
    input.focus({ preventScroll: true });
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

for (const button of exampleStarts) {
  button.addEventListener("click", () => {
    if (pending) return;
    void sendMessage(button.dataset.exampleMessage || "");
  });
}

if (signOutForm instanceof HTMLFormElement) {
  signOutForm.addEventListener("submit", clearPersistedAnswer);
}

restorePersistedAnswer();

window.addEventListener("pageshow", (event) => {
  const view = conversationSurface.dataset.view || "compose";
  const outputIsMissing = chatLog.hidden || chatLog.childElementCount === 0;
  const interruptedThinkingView = event.persisted && view === "thinking";

  if (interruptedThinkingView) {
    recoverInterruptedThinking();
    return;
  }

  if (view !== "compose" && outputIsMissing) {
    if (!restorePersistedAnswer()) restoreComposeView();
  }
});

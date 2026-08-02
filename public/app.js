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

let awaitingSafetyAnswer = false;
let pending = false;
let lastSubmittedText = "";

function appendOutcomeCheck(article) {
  const section = document.createElement("section");
  section.className = "outcome-check";
  section.setAttribute("aria-label", productCopy.outcomeQuestion);

  const question = document.createElement("p");
  question.className = "outcome-question";
  question.textContent = productCopy.outcomeQuestion;

  const actions = document.createElement("div");
  actions.className = "outcome-actions";

  const status = document.createElement("p");
  status.className = "outcome-status";
  status.setAttribute("role", "status");

  const yesButton = document.createElement("button");
  yesButton.type = "button";
  yesButton.className = "outcome-button";
  yesButton.textContent = productCopy.outcomeYes;

  const noButton = document.createElement("button");
  noButton.type = "button";
  noButton.className = "outcome-button";
  noButton.textContent = productCopy.outcomeNo;

  function finish(message) {
    yesButton.disabled = true;
    noButton.disabled = true;
    status.textContent = message;
  }

  yesButton.addEventListener("click", () => {
    finish(productCopy.outcomeYesMessage);
    input.focus({ preventScroll: true });
  });

  noButton.addEventListener("click", () => {
    finish("");
    void sendMessage(productCopy.outcomeFollowUp);
  });

  actions.append(yesButton, noButton);
  section.append(question, actions, status);
  article.appendChild(section);
}

function showOutput(
  content,
  extraClass = "",
  view = "response",
  { offerOutcomeCheck = false } = {},
) {
  chatLog.replaceChildren();
  const article = document.createElement("article");
  article.className = `assistant-output ${extraClass}`.trim();
  article.appendChild(renderMarkdown(content));
  if (offerOutcomeCheck) appendOutcomeCheck(article);
  chatLog.appendChild(article);
  chatLog.hidden = false;
  chatLog.tabIndex = view === "response" ? 0 : -1;
  conversationSurface.dataset.view = view;
  chatLog.scrollTop = 0;
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
  showOutput(record.reply, "", "response", { offerOutcomeCheck });
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
  setPending(false);

  if (!input.value && lastSubmittedText) {
    input.value = lastSubmittedText;
  }
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
  if (!clean || pending) return;

  lastSubmittedText = clean;
  modulateTerrain(clean);
  input.value = "";
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
    showOutput(reply, "", "response", { offerOutcomeCheck });
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

  if (interruptedThinkingView || (view !== "compose" && outputIsMissing)) {
    if (!restorePersistedAnswer()) restoreComposeView();
  }
});

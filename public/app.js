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

let awaitingSafetyAnswer = false;
let pending = false;

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
    input.value = productCopy.outcomeFollowUp;
    finish(productCopy.outcomeNoMessage);
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
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

function setPending(value) {
  pending = value;
  input.disabled = value;
  sendButton.disabled = value;
  for (const button of exampleStarts) button.disabled = value;
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
      showOutput(
        requestErrorMessage(result.error, result.reference),
        "error-output",
      );
      return;
    }

    const reply = String(result.reply || copy.missingReply);
    const route = String(result.route || "ORDINARY");
    const offerOutcomeCheck =
      result.awaitingSafetyAnswer !== true &&
      result.showEmergency !== true &&
      !ROUTES_WITHOUT_OUTCOME_CHECK.has(route);
    showOutput(reply, "", "response", { offerOutcomeCheck });
    modulateTerrain(reply);
    awaitingSafetyAnswer = result.awaitingSafetyAnswer === true;
  } catch {
    input.value = clean;
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
    input.value = button.dataset.exampleMessage || "";
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

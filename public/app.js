import { renderMarkdown } from "./markdown.js";

const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const forgetMemoryButton = document.querySelector("#forget-memory-button");
const conversationSurface = document.querySelector("#conversation-surface");
const chatLog = document.querySelector("#chat-log");
const dangerButton = document.querySelector("#danger-button");
const emergencyPanel = document.querySelector("#emergency-panel");
const copyTemplate = document.querySelector("#client-copy");

if (!(copyTemplate instanceof HTMLTemplateElement)) {
  throw new Error("Missing client copy data");
}

const copy = JSON.parse(copyTemplate.content.textContent);

let awaitingSafetyAnswer = false;
let pending = false;

function showOutput(content, extraClass = "", view = "response") {
  chatLog.replaceChildren();
  const article = document.createElement("article");
  article.className = `assistant-output ${extraClass}`.trim();
  article.appendChild(renderMarkdown(content));
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
  forgetMemoryButton.disabled = value;
}

function showEmergency() {
  emergencyPanel.hidden = false;
  emergencyPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function sendMessage(text) {
  const clean = String(text || "").trim();
  if (!clean || pending) return;

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
      throw new Error(result.error || copy.requestFailed);
    }

    const reply = String(result.reply || copy.missingReply);
    showOutput(reply);
    awaitingSafetyAnswer = result.awaitingSafetyAnswer === true;

    if (result.showEmergency === true) showEmergency();
  } catch (error) {
    const message = error instanceof Error ? error.message : copy.unexpectedError;
    showOutput(message);
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

dangerButton.addEventListener("click", () => {
  showEmergency();
  showOutput(copy.dangerReply);
});

forgetMemoryButton.addEventListener("click", async () => {
  if (pending) return;
  setPending(true);

  try {
    const response = await fetch("/api/session", { method: "DELETE" });
    if (!response.ok) throw new Error(copy.memoryClearFailed);
    awaitingSafetyAnswer = false;
    showOutput(copy.memoryCleared);
  } catch {
    showOutput(copy.memoryClearFailed);
  } finally {
    setPending(false);
    input.focus({ preventScroll: true });
  }
});

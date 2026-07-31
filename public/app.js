import { renderMarkdown } from "./markdown.js";

const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const conversationSurface = document.querySelector("#conversation-surface");
const chatLog = document.querySelector("#chat-log");
const quickActions = document.querySelector("#quick-actions");
const dangerButton = document.querySelector("#danger-button");
const emergencyPanel = document.querySelector("#emergency-panel");
const copyTemplate = document.querySelector("#client-copy");

if (!(copyTemplate instanceof HTMLTemplateElement)) {
  throw new Error("Missing client copy data");
}

const copy = JSON.parse(copyTemplate.content.textContent);

let messages = [];
let awaitingSafetyAnswer = false;
let pending = false;
let introDismissed = false;

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

function showComposer({ focus = true } = {}) {
  if (pending) return;
  conversationSurface.dataset.view = "compose";
  chatLog.hidden = true;
  chatLog.tabIndex = -1;
  if (focus) input.focus();
}

function setPending(value) {
  pending = value;
  input.disabled = value;
  sendButton.disabled = value;
  quickActions.querySelectorAll("button").forEach((button) => {
    button.disabled = value;
  });
}

function showEmergency() {
  emergencyPanel.hidden = false;
  emergencyPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function sendMessage(text) {
  const clean = String(text || "").trim();
  if (!clean || pending) return;

  introDismissed = true;
  input.placeholder = copy.followupPlaceholder;
  quickActions.remove();
  messages.push({ role: "user", content: clean });
  input.value = "";
  setPending(true);
  showOutput(copy.thinking, "thinking-output", "thinking");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, awaitingSafetyAnswer }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || copy.requestFailed);
    }

    const reply = String(result.reply || copy.missingReply);
    showOutput(reply);
    messages.push({ role: "assistant", content: reply });
    awaitingSafetyAnswer = result.awaitingSafetyAnswer === true;

    if (result.showEmergency === true) showEmergency();
  } catch (error) {
    const message = error instanceof Error ? error.message : copy.unexpectedError;
    showOutput(message);
  } finally {
    setPending(false);
    chatLog.focus({ preventScroll: true });
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

input.addEventListener("input", () => {
  showComposer({ focus: false });
  if (!introDismissed && input.value.length > 0) {
    introDismissed = true;
    input.placeholder = copy.followupPlaceholder;
  }
});

quickActions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (!button) return;
  sendMessage(button.dataset.prompt);
});

chatLog.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("a")) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  showComposer();
});

chatLog.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  showComposer();
});

dangerButton.addEventListener("click", () => {
  introDismissed = true;
  input.placeholder = copy.followupPlaceholder;
  showEmergency();
  showOutput(copy.dangerReply);
  messages.push({
    role: "assistant",
    content: copy.dangerReply,
  });
});

import { renderMarkdown } from "./markdown.js";

const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const chatLog = document.querySelector("#chat-log");
const quickActions = document.querySelector("#quick-actions");
const statusLine = document.querySelector("#status-line");
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

function addMessage(role, content, extraClass = "") {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "assistant-message"} ${extraClass}`.trim();
  if (role === "assistant") {
    article.appendChild(renderMarkdown(content));
  } else {
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    article.appendChild(paragraph);
  }
  chatLog.appendChild(article);
  chatLog.hidden = false;
  chatLog.scrollTop = chatLog.scrollHeight;
  return article;
}

function setPending(value) {
  pending = value;
  input.disabled = value;
  sendButton.disabled = value;
  quickActions.querySelectorAll("button").forEach((button) => {
    button.disabled = value;
  });
  statusLine.textContent = value ? copy.pending : "";
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
  addMessage("user", clean);
  messages.push({ role: "user", content: clean });
  input.value = "";
  setPending(true);
  const typing = addMessage("assistant", copy.thinking, "typing-message");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, awaitingSafetyAnswer }),
    });

    const result = await response.json().catch(() => ({}));
    typing.remove();

    if (!response.ok) {
      throw new Error(result.error || copy.requestFailed);
    }

    const reply = String(result.reply || copy.missingReply);
    addMessage("assistant", reply);
    messages.push({ role: "assistant", content: reply });
    awaitingSafetyAnswer = result.awaitingSafetyAnswer === true;

    if (result.showEmergency === true) showEmergency();
  } catch (error) {
    typing.remove();
    const message = error instanceof Error ? error.message : copy.unexpectedError;
    addMessage("assistant", message);
  } finally {
    setPending(false);
    input.focus();
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

dangerButton.addEventListener("click", () => {
  introDismissed = true;
  input.placeholder = copy.followupPlaceholder;
  showEmergency();
  addMessage("assistant", copy.dangerReply);
  messages.push({
    role: "assistant",
    content: copy.dangerReply,
  });
});

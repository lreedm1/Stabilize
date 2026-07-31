const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const chatLog = document.querySelector("#chat-log");
const quickActions = document.querySelector("#quick-actions");
const statusLine = document.querySelector("#status-line");
const resetButton = document.querySelector("#reset-button");
const dangerButton = document.querySelector("#danger-button");
const emergencyPanel = document.querySelector("#emergency-panel");

const openingMessage =
  "You do not need to solve your whole life here. Tell me what feels most fragile, and we will find one small next step.";

let messages = [{ role: "assistant", content: openingMessage }];
let awaitingSafetyAnswer = false;
let pending = false;

function addMessage(role, content, extraClass = "") {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "assistant-message"} ${extraClass}`.trim();
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  article.appendChild(paragraph);
  chatLog.appendChild(article);
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
  statusLine.textContent = value ? "Finding the smallest useful next step…" : "";
}

function showEmergency() {
  emergencyPanel.hidden = false;
  emergencyPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function resetChat() {
  messages = [{ role: "assistant", content: openingMessage }];
  awaitingSafetyAnswer = false;
  emergencyPanel.hidden = true;
  statusLine.textContent = "";
  chatLog.replaceChildren();
  addMessage("assistant", openingMessage);
  quickActions.hidden = false;
  input.value = "";
  input.focus();
}

async function sendMessage(text) {
  const clean = String(text || "").trim();
  if (!clean || pending) return;

  quickActions.hidden = true;
  addMessage("user", clean);
  messages.push({ role: "user", content: clean });
  input.value = "";
  setPending(true);
  const typing = addMessage("assistant", "Thinking…", "typing-message");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, awaitingSafetyAnswer }),
    });

    const result = await response.json().catch(() => ({}));
    typing.remove();

    if (!response.ok) {
      throw new Error(result.error || "The request failed.");
    }

    const reply = String(result.reply || "I could not generate a reply.");
    addMessage("assistant", reply);
    messages.push({ role: "assistant", content: reply });
    awaitingSafetyAnswer = result.awaitingSafetyAnswer === true;

    if (result.showEmergency === true) showEmergency();
  } catch (error) {
    typing.remove();
    const message = error instanceof Error ? error.message : "Something went wrong.";
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

quickActions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (!button) return;
  sendMessage(button.dataset.prompt);
});

resetButton.addEventListener("click", resetChat);

dangerButton.addEventListener("click", () => {
  showEmergency();
  addMessage(
    "assistant",
    "Move toward a safe person or staffed place now. In the U.S., call or text 988. If an attempt, overdose, medical emergency, or immediate danger may be happening, call 911 or go to an emergency department.",
  );
  messages.push({
    role: "assistant",
    content:
      "Move toward a safe person or staffed place now. In the U.S., call or text 988. If an attempt, overdose, medical emergency, or immediate danger may be happening, call 911 or go to an emergency department.",
  });
});

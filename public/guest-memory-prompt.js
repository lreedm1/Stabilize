const form = document.querySelector("#chat-form");
const prompt = document.querySelector("#guest-memory-prompt");
const dismissButton = document.querySelector("#guest-memory-prompt-dismiss");
const closeButton = document.querySelector("#guest-memory-prompt-close");

const MESSAGE_COUNT_KEY = "stabilize:guest-message-count:v1";
const PROMPT_SHOWN_KEY = "stabilize:guest-memory-prompt-shown:v1";

function readSessionNumber(key) {
  try {
    const value = Number(sessionStorage.getItem(key) || 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeSessionValue(key, value) {
  try {
    sessionStorage.setItem(key, String(value));
  } catch {
    // The reminder still works for the current page when storage is blocked.
  }
}

function promptWasShown() {
  try {
    return sessionStorage.getItem(PROMPT_SHOWN_KEY) === "true";
  } catch {
    return false;
  }
}

function hidePrompt() {
  if (prompt instanceof HTMLElement) prompt.hidden = true;
}

function showPrompt() {
  if (!(prompt instanceof HTMLElement) || promptWasShown()) return;
  writeSessionValue(PROMPT_SHOWN_KEY, true);
  prompt.hidden = false;
}

if (form instanceof HTMLFormElement && prompt instanceof HTMLElement) {
  form.addEventListener("submit", () => {
    const count = readSessionNumber(MESSAGE_COUNT_KEY) + 1;
    writeSessionValue(MESSAGE_COUNT_KEY, count);
    if (count === 2) showPrompt();
  });
}

if (dismissButton instanceof HTMLButtonElement) {
  dismissButton.addEventListener("click", hidePrompt);
}

if (closeButton instanceof HTMLButtonElement) {
  closeButton.addEventListener("click", hidePrompt);
}

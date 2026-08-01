import { renderMarkdown } from "./markdown.js";
import { createNatureSoundscape } from "./nature-sounds.js";
import { modulateTerrain } from "./terrain.js";

const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const conversationSurface = document.querySelector("#conversation-surface");
const chatLog = document.querySelector("#chat-log");
const dangerButton = document.querySelector("#danger-button");
const emergencyPanel = document.querySelector("#emergency-panel");
const copyTemplate = document.querySelector("#client-copy");
const soundToggle = document.querySelector("#sound-toggle");
const soundStatus = document.querySelector("#sound-status");
const soundVolume = document.querySelector("#sound-volume");

if (!(copyTemplate instanceof HTMLTemplateElement)) {
  throw new Error("Missing client copy data");
}

const copy = JSON.parse(copyTemplate.content.textContent);

let awaitingSafetyAnswer = false;
let pending = false;

function readSavedVolume() {
  try {
    const stored = window.localStorage.getItem("stabilize_nature_volume");
    if (stored === null) return 0.36;
    const value = Number(stored);
    return Number.isFinite(value) ? value : 0.36;
  } catch {
    return 0.36;
  }
}

function saveVolume(value) {
  try {
    window.localStorage.setItem("stabilize_nature_volume", String(value));
  } catch {
    // Sound remains fully usable when storage is unavailable.
  }
}

if (
  soundToggle instanceof HTMLButtonElement &&
  soundStatus instanceof HTMLElement &&
  soundVolume instanceof HTMLInputElement
) {
  const initialVolume = readSavedVolume();
  soundVolume.value = String(initialVolume);

  const soundscape = createNatureSoundscape({
    initialVolume,
    onStateChange({ available, enabled, volume }) {
      soundVolume.value = String(volume);
      soundToggle.disabled = !available;
      soundToggle.setAttribute("aria-pressed", String(enabled));
      soundToggle.classList.toggle("is-playing", enabled && volume > 0);
      soundVolume.disabled = !available;

      if (!available) {
        soundStatus.textContent = copy.soundUnavailable;
        soundToggle.setAttribute("aria-label", copy.soundUnavailable);
      } else if (enabled && volume === 0) {
        soundStatus.textContent = copy.soundMuted;
        soundToggle.setAttribute("aria-label", copy.soundTurnOff);
      } else {
        soundStatus.textContent = enabled ? copy.soundOn : copy.soundOff;
        soundToggle.setAttribute(
          "aria-label",
          enabled ? copy.soundTurnOff : copy.soundTurnOn,
        );
      }
    },
  });

  soundToggle.addEventListener("click", () => {
    void soundscape.toggle();
  });

  soundVolume.addEventListener("input", () => {
    const volume = soundscape.setVolume(soundVolume.value);
    soundVolume.value = String(volume);
    saveVolume(volume);
  });
}

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
}

function showEmergency() {
  emergencyPanel.hidden = false;
  emergencyPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      throw new Error(result.error || copy.requestFailed);
    }

    const reply = String(result.reply || copy.missingReply);
    showOutput(reply);
    modulateTerrain(reply);
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
  modulateTerrain(copy.dangerReply);
});

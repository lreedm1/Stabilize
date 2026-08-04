import { renderMarkdown } from "./markdown.js";
import { modulateTerrain } from "./terrain.js";

const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const stopButton = document.querySelector("#stop-button");
const microphoneButton = document.querySelector("#microphone-button");
const privateToggle = document.querySelector("#private-toggle");
const newChatButton = document.querySelector("#new-chat-button");
const memoryButton = document.querySelector("#memory-button");
const backgroundModeButton = document.querySelector("#background-mode-button");
const installButton = document.querySelector("#install-button");
const serviceStatus = document.querySelector("#service-status");
const serviceStatusDot = document.querySelector("#service-status-dot");
const composerStatus = document.querySelector("#composer-status");
const conversationSurface = document.querySelector("#conversation-surface");
const chatLog = document.querySelector("#chat-log");
const copyTemplate = document.querySelector("#client-copy");
const productCopyTemplate = document.querySelector("#product-copy");
const signOutForm = document.querySelector('form[action="/auth/logout"]');
const memoryDialog = document.querySelector("#memory-dialog");
const memorySummary = document.querySelector("#memory-summary");
const memoryRecent = document.querySelector("#memory-recent");
const memoryStatus = document.querySelector("#memory-status");
const memorySaveButton = document.querySelector("#memory-save-button");
const memoryDeleteButton = document.querySelector("#memory-delete-button");

if (!(form instanceof HTMLFormElement)) throw new Error("Missing chat form");
if (!(input instanceof HTMLTextAreaElement)) throw new Error("Missing chat input");
if (!(sendButton instanceof HTMLButtonElement)) throw new Error("Missing send button");
if (!(stopButton instanceof HTMLButtonElement)) throw new Error("Missing stop button");
if (!(conversationSurface instanceof HTMLElement)) throw new Error("Missing conversation surface");
if (!(chatLog instanceof HTMLElement)) throw new Error("Missing chat log");
if (!(copyTemplate instanceof HTMLTemplateElement)) throw new Error("Missing client copy data");
if (!(productCopyTemplate instanceof HTMLTemplateElement)) throw new Error("Missing product copy data");

const copy = JSON.parse(copyTemplate.content.textContent);
const productCopy = JSON.parse(productCopyTemplate.content.textContent);
const signedIn = productCopy.signedIn === true;

const THREAD_STORAGE_KEY = "stabilize:current-thread:v2";
const THREAD_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_THREAD_MESSAGES = 20;
const MAX_THREAD_CHARS = 64_000;
const DRAFT_STORAGE_KEY = "stabilize:draft:v2";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const BACKGROUND_STORAGE_KEY = "stabilize:background-mode:v1";
const SAFETY_ANSWER_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
const ROUTES_WITHOUT_OUTCOME_CHECK = new Set([
  "MEDICAL_EMERGENCY",
  "IMMEDIATE_DANGER",
  "SAFETY_UNCLEAR",
  "UNSAFE_SHELTER",
  "MEDICATION_CHANGE",
  "MEDICATION_ACCESS",
]);

const ROUTE_ACTION_SETS = {
  FLOOR_FOOD: {
    question: "What would help you eat now?",
    actions: [
      {
        label: "Use what I have",
        prompt: "Using only common foods I may already have, give me the easiest thing to eat right now.",
      },
      {
        label: "Pick one simple meal",
        prompt: "Choose one simple, filling meal and give me the shortest possible instructions.",
      },
    ],
  },
  FLOOR_REST: {
    question: "What would help you rest?",
    actions: [
      {
        label: "Wind down now",
        prompt: "Give me a very short wind-down plan I can begin immediately.",
      },
      {
        label: "What can wait?",
        prompt: "Tell me what can safely wait until after I have rested.",
      },
    ],
  },
  LOW_SLEEP_URGENCY: {
    question: "How should we protect this decision?",
    actions: [
      {
        label: "Park it for 24 hours",
        prompt: "Help me park this consequential decision for 24 hours without losing the important details.",
      },
      {
        label: "Handle only what is urgent",
        prompt: "Separate what truly needs action now from what can wait until I have slept.",
      },
    ],
  },
  SAFETY_CONFIRMED: {
    question: "What would help for the next hour?",
    actions: [
      {
        label: "Help me stabilize",
        prompt: "Help me choose one stabilizing action for the next ten minutes.",
      },
      {
        label: "Choose one safe contact",
        prompt: "Help me identify a low-pressure person or staffed place I could contact or be near.",
      },
    ],
  },
};

const CONTENT_ACTION_SETS = [
  {
    pattern: /\b(message|text|email|reply|conversation|apolog(?:y|ize)|boundary|send it)\b/i,
    question: "What should we do with the message?",
    actions: [
      {
        label: "Draft it",
        prompt: "Draft the message in a calm, direct tone. Keep it concise and preserve my boundary.",
      },
      {
        label: "Make it calmer",
        prompt: "Rewrite the message to reduce heat without erasing the point I need to make.",
      },
    ],
  },
  {
    pattern: /\b(decision|decide|choice|choose|compare|option|trade-?off|pros? and cons?)\b/i,
    question: "What would make the choice clearer?",
    actions: [
      {
        label: "Compare the options",
        prompt: "Compare the realistic options using impact, effort, cost, risk, and reversibility.",
      },
      {
        label: "Find a reversible test",
        prompt: "Turn this choice into the smallest reversible experiment that would teach me something useful.",
      },
    ],
  },
  {
    pattern: /\b(work|school|class|assignment|project|deadline|application|internship|meeting)\b/i,
    question: "What would move this forward?",
    actions: [
      {
        label: "Break off 10 minutes",
        prompt: "Turn this into one useful task I can complete in ten minutes.",
      },
      {
        label: "Draft the next message",
        prompt: "Draft the shortest useful message I should send to move this forward.",
      },
    ],
  },
  {
    pattern: /\b(money|budget|rent|housing|apartment|cost|debt|bill|financial|afford)\b/i,
    question: "What would protect the essentials?",
    actions: [
      {
        label: "Compare the costs",
        prompt: "Compare the realistic costs, hidden costs, and financial risk of the options.",
      },
      {
        label: "Make a minimum plan",
        prompt: "Make the smallest workable plan that protects the essentials first.",
      },
    ],
  },
  {
    pattern: /\b(friend|social|lonely|alone|isolation|reach out|connection|meet people|community)\b/i,
    question: "What would make connection easier?",
    actions: [
      {
        label: "Draft a low-pressure text",
        prompt: "Draft a low-pressure message that invites connection without overexplaining.",
      },
      {
        label: "Find a simple option",
        prompt: "Suggest one simple, low-pressure way to be around people today.",
      },
    ],
  },
];

let messages = [];
let awaitingSafetyAnswer = false;
let awaitingSafetyAnswerSince = null;
let privateMode = false;
let pending = false;
let activeAbortController = null;
let activeRecognition = null;
let deferredInstallPrompt = null;
let latestAssistantId = null;

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function boundedText(value, limit = 4_000) {
  return String(value || "").trim().slice(0, limit);
}

function setComposerStatus(message) {
  if (composerStatus instanceof HTMLElement) composerStatus.textContent = message;
}

function setView(view) {
  conversationSurface.dataset.view = view;
  const hasMessages = messages.length > 0;
  chatLog.hidden = !hasMessages;
  if (hasMessages) chatLog.tabIndex = 0;
}

function setPending(value) {
  pending = value;
  input.disabled = value;
  sendButton.disabled = value;
  sendButton.hidden = value;
  stopButton.hidden = !value;
  if (microphoneButton instanceof HTMLButtonElement) microphoneButton.disabled = value;
  if (privateToggle instanceof HTMLButtonElement) privateToggle.disabled = value;
  if (newChatButton instanceof HTMLButtonElement) newChatButton.disabled = value;
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Draft persistence is optional in hardened browser contexts.
  }
}

function saveDraft() {
  if (privateMode) {
    clearDraft();
    return;
  }
  const draft = input.value.slice(0, 4_000);
  try {
    if (!draft.trim()) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ value: draft, savedAt: Date.now() }),
    );
  } catch {
    // The live input remains usable when local storage is blocked.
  }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return;
    const record = JSON.parse(raw);
    const age = Date.now() - Number(record?.savedAt);
    if (
      typeof record?.value !== "string" ||
      record.value.length > 4_000 ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > DRAFT_MAX_AGE_MS
    ) {
      clearDraft();
      return;
    }
    input.value = record.value;
    if (input.value.trim()) setComposerStatus("Draft restored on this device.");
  } catch {
    clearDraft();
  }
}

function persistedMessages() {
  const bounded = messages.slice(-MAX_THREAD_MESSAGES).map((message) => ({
    id: boundedText(message.id, 80),
    role: message.role === "user" ? "user" : "assistant",
    content: boundedText(message.content, 12_000),
    route: /^[A-Z_]{1,64}$/.test(String(message.route || ""))
      ? message.route
      : "ORDINARY",
    status: ["complete", "stopped", "error"].includes(message.status)
      ? message.status
      : "complete",
    createdAt: Number(message.createdAt) || Date.now(),
    retryText: boundedText(message.retryText, 4_000),
  }));
  let total = 0;
  const withinBudget = [];
  for (const message of [...bounded].reverse()) {
    total += message.content.length + message.retryText.length;
    if (total > MAX_THREAD_CHARS) break;
    withinBudget.unshift(message);
  }
  return withinBudget;
}

function persistThread() {
  try {
    if (!messages.length) {
      sessionStorage.removeItem(THREAD_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
      THREAD_STORAGE_KEY,
      JSON.stringify({
        v: 2,
        savedAt: Date.now(),
        messages: persistedMessages(),
        awaitingSafetyAnswer,
        awaitingSafetyAnswerSince,
        privateMode,
      }),
    );
  } catch {
    // The conversation remains available in the current page.
  }
}

function clearPersistedThread() {
  try {
    sessionStorage.removeItem(THREAD_STORAGE_KEY);
  } catch {
    // Session storage may be unavailable.
  }
}

function restoreThread() {
  try {
    const raw = sessionStorage.getItem(THREAD_STORAGE_KEY);
    if (!raw) return false;
    const record = JSON.parse(raw);
    const age = Date.now() - Number(record?.savedAt);
    if (
      record?.v !== 2 ||
      !Array.isArray(record.messages) ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > THREAD_MAX_AGE_MS
    ) {
      clearPersistedThread();
      return false;
    }

    messages = record.messages
      .filter(
        (message) =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string" &&
          message.content.length <= 12_000,
      )
      .slice(-MAX_THREAD_MESSAGES)
      .map((message) => ({
        id: boundedText(message.id, 80) || createId(message.role),
        role: message.role,
        content: message.content,
        route: /^[A-Z_]{1,64}$/.test(String(message.route || ""))
          ? message.route
          : "ORDINARY",
        status: ["complete", "stopped", "error"].includes(message.status)
          ? message.status
          : "complete",
        createdAt: Number(message.createdAt) || Date.now(),
        retryText: boundedText(message.retryText, 4_000),
      }));

    privateMode = record.privateMode === true;
    awaitingSafetyAnswer = record.awaitingSafetyAnswer === true;
    awaitingSafetyAnswerSince = awaitingSafetyAnswer
      ? Number(record.awaitingSafetyAnswerSince) || Number(record.savedAt)
      : null;
    if (!currentAwaitingSafetyAnswer()) {
      awaitingSafetyAnswer = false;
      awaitingSafetyAnswerSince = null;
    }
    return messages.length > 0;
  } catch {
    clearPersistedThread();
    return false;
  }
}

function currentAwaitingSafetyAnswer() {
  if (!awaitingSafetyAnswer) return false;
  const age = Date.now() - Number(awaitingSafetyAnswerSince);
  const answerIsCurrent =
    Number.isFinite(age) && age >= 0 && age <= SAFETY_ANSWER_MAX_AGE_MS;
  if (!answerIsCurrent) {
    awaitingSafetyAnswer = false;
    awaitingSafetyAnswerSince = null;
    return false;
  }
  return true;
}

function updatePrivateControl() {
  if (!(privateToggle instanceof HTMLButtonElement)) return;
  privateToggle.setAttribute("aria-pressed", String(privateMode));
  privateToggle.textContent = privateMode ? "Private on" : "Private off";
  privateToggle.title = privateMode
    ? "This conversation will not read or write signed-in memory."
    : "Signed-in memory may provide continuity between visits.";
  if (privateMode) clearDraft();
}

function scrollConversation() {
  requestAnimationFrame(() => {
    chatLog.scrollTop = chatLog.scrollHeight;
  });
}

function renderAssistantContent(article, content, streaming = false) {
  article.replaceChildren(renderMarkdown(content));
  article.classList.toggle("streaming-output", streaming);
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error("Copy failed"));
}

function speakText(text) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    setComposerStatus("Read aloud is not supported in this browser.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

function appendMessageActions(shell, message) {
  if (!message.content || message.status === "error") return;
  const actions = document.createElement("div");
  actions.className = "message-actions";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "message-action";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async () => {
    try {
      await copyText(message.content);
      copyButton.textContent = "Copied";
      setTimeout(() => { copyButton.textContent = "Copy"; }, 1_400);
    } catch {
      setComposerStatus("Copy was not available.");
    }
  });

  const shareButton = document.createElement("button");
  shareButton.type = "button";
  shareButton.className = "message-action";
  shareButton.textContent = "Share";
  shareButton.addEventListener("click", async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Stabilize", text: message.content });
      } else {
        await copyText(message.content);
        setComposerStatus("Reply copied so you can share it.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") setComposerStatus("Share was not available.");
    }
  });

  const readButton = document.createElement("button");
  readButton.type = "button";
  readButton.className = "message-action";
  readButton.textContent = "Read aloud";
  readButton.addEventListener("click", () => speakText(message.content));

  actions.append(copyButton, shareButton, readButton);
  shell.appendChild(actions);
}

function defaultOutcomeActionSet() {
  const actions = Array.isArray(productCopy.outcomeActions)
    ? productCopy.outcomeActions.slice(0, 2)
    : [];
  return {
    question: String(productCopy.outcomeQuestion || "What would help next?"),
    actions,
  };
}

function selectOutcomeActionSet(route, previousReply) {
  const cleanRoute = String(route || "ORDINARY").trim().toUpperCase();
  if (ROUTE_ACTION_SETS[cleanRoute]) return ROUTE_ACTION_SETS[cleanRoute];
  const reply = String(previousReply || "");
  return CONTENT_ACTION_SETS.find(({ pattern }) => pattern.test(reply)) || defaultOutcomeActionSet();
}

function buildOutcomeActionPrompt(instruction, previousReply) {
  const request = boundedText(instruction, 1_000);
  const context = boundedText(previousReply, 3_000);
  if (!request) return "";
  if (!context) return request;
  return `${request}\n\nUse this previous answer as context:\n\n${context}`;
}

function appendOutcomeCheck(shell, message) {
  if (
    message.status !== "complete" ||
    ROUTES_WITHOUT_OUTCOME_CHECK.has(message.route)
  ) return;

  const selected = selectOutcomeActionSet(message.route, message.content);
  const section = document.createElement("section");
  section.className = "outcome-check";
  section.setAttribute("aria-label", selected.question);

  const question = document.createElement("p");
  question.className = "outcome-question";
  question.textContent = selected.question;

  const actions = document.createElement("div");
  actions.className = "outcome-actions";
  for (const action of selected.actions.slice(0, 2)) {
    const label = boundedText(action?.label, 80);
    const prompt = boundedText(action?.prompt, 1_000);
    if (!label || !prompt) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outcome-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      if (pending) return;
      void sendMessage(buildOutcomeActionPrompt(prompt, message.content));
    });
    actions.appendChild(button);
  }
  section.append(question, actions);
  shell.appendChild(section);
}

function appendClarityCheck(shell, message) {
  if (
    message.status !== "complete" ||
    ROUTES_WITHOUT_OUTCOME_CHECK.has(message.route)
  ) return;

  const section = document.createElement("section");
  section.className = "clarity-check";
  const question = document.createElement("p");
  question.className = "clarity-question";
  question.textContent = "Is the next step clearer?";
  const actions = document.createElement("div");
  actions.className = "clarity-actions";
  const status = document.createElement("p");
  status.className = "clarity-status";
  status.setAttribute("role", "status");

  for (const [rating, label] of [["yes", "Yes"], ["partly", "Partly"], ["no", "No"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clarity-button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      for (const control of actions.querySelectorAll("button")) control.disabled = true;
      try {
        const response = await fetch("/api/outcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating, route: message.route }),
        });
        status.textContent = response.ok ? "Thanks—that helps improve Stabilize." : "Feedback was not saved.";
      } catch {
        status.textContent = "Feedback was not saved.";
      }
    });
    actions.appendChild(button);
  }

  section.append(question, actions, status);
  shell.appendChild(section);
}

function renderMessage(message, { latest = false, streaming = false } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "chat-message";
  wrapper.dataset.role = message.role;
  wrapper.dataset.messageId = message.id;

  if (message.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "user-bubble";
    bubble.textContent = message.content;
    wrapper.appendChild(bubble);
    return wrapper;
  }

  const shell = document.createElement("div");
  shell.className = "assistant-message-shell";
  const article = document.createElement("article");
  article.className = "assistant-output";
  renderAssistantContent(article, message.content || copy.thinking, streaming);
  shell.appendChild(article);

  if (message.status === "error") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "message-action retry-button";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => retryMessage(message.id));
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.appendChild(retry);
    shell.appendChild(actions);
  } else if (!streaming) {
    appendMessageActions(shell, message);
    if (latest) {
      appendOutcomeCheck(shell, message);
      appendClarityCheck(shell, message);
    }
  }

  wrapper.appendChild(shell);
  return wrapper;
}

function renderThread() {
  chatLog.replaceChildren();
  latestAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id || null;
  for (const message of messages) {
    chatLog.appendChild(
      renderMessage(message, {
        latest: message.id === latestAssistantId,
        streaming: message.status === "streaming",
      }),
    );
  }
  setView(messages.length ? "chat" : "compose");
  if (messages.length) scrollConversation();
}

function updateRenderedAssistant(message, streaming = false) {
  const wrapper = chatLog.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
  if (!(wrapper instanceof HTMLElement)) {
    renderThread();
    return;
  }
  const article = wrapper.querySelector(".assistant-output");
  if (!(article instanceof HTMLElement)) return;
  renderAssistantContent(article, message.content || copy.thinking, streaming);
  scrollConversation();
}

function finalizeRenderedAssistant(message) {
  const wrapper = chatLog.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
  if (!(wrapper instanceof HTMLElement)) {
    renderThread();
    return;
  }
  const shell = wrapper.querySelector(".assistant-message-shell");
  const article = wrapper.querySelector(".assistant-output");
  if (!(shell instanceof HTMLElement) || !(article instanceof HTMLElement)) return;
  renderAssistantContent(article, message.content, false);
  for (const old of shell.querySelectorAll(".message-actions, .outcome-check, .clarity-check")) old.remove();
  appendMessageActions(shell, message);
  appendOutcomeCheck(shell, message);
  appendClarityCheck(shell, message);
  latestAssistantId = message.id;
  scrollConversation();
}

function serverConversation() {
  return messages
    .filter(
      (message) =>
        ["user", "assistant"].includes(message.role) &&
        message.status !== "error" &&
        message.content,
    )
    .slice(-12)
    .map((message) => ({ role: message.role, content: message.content }));
}

function requestErrorMessage(message, reference = "") {
  const parts = [String(message || copy.requestFailed), copy.draftRestored];
  const cleanReference = boundedText(reference, 80);
  if (cleanReference) parts.push(`${copy.errorReferenceLabel}: ${cleanReference}`);
  return parts.filter(Boolean).join("\n\n");
}

function parseNdjsonLine(line) {
  const clean = line.trim();
  if (!clean) return null;
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error("Stabilize returned an unreadable stream.");
  }
}

async function consumeNdjson(response, onEvent) {
  if (!response.body) throw new Error("The response stream was unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const event = parseNdjsonLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (event) onEvent(event);
    }
  }
  buffer += decoder.decode();
  const finalEvent = parseNdjsonLine(buffer);
  if (finalEvent) onEvent(finalEvent);
}

async function runAssistantRequest(clean, { appendUser = true } = {}) {
  if (!clean || pending) return;

  if (appendUser) {
    messages.push({
      id: createId("user"),
      role: "user",
      content: clean,
      route: "ORDINARY",
      status: "complete",
      createdAt: Date.now(),
    });
  }

  const assistant = {
    id: createId("assistant"),
    role: "assistant",
    content: "",
    route: "ORDINARY",
    status: "streaming",
    createdAt: Date.now(),
    retryText: clean,
  };
  messages.push(assistant);
  persistThread();
  renderThread();
  modulateTerrain(clean);
  input.value = "";
  clearDraft();
  setPending(true);
  setComposerStatus("Starting a focused response…");
  activeAbortController = new AbortController();

  let finished = false;
  let sawDelta = false;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: clean,
        messages: serverConversation(),
        awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),
        private: privateMode,
      }),
      signal: activeAbortController.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const error = new Error(result.error || copy.requestFailed);
      error.reference = result.reference || "";
      throw error;
    }

    if (contentType.includes("application/x-ndjson")) {
      await consumeNdjson(response, (event) => {
        if (event.type === "meta") {
          assistant.route = /^[A-Z_]{1,64}$/.test(String(event.route || ""))
            ? event.route
            : "ORDINARY";
          setComposerStatus(event.message || "Writing a concise answer…");
        } else if (event.type === "delta") {
          const delta = String(event.delta || "");
          if (!delta) return;
          sawDelta = true;
          assistant.content = (assistant.content + delta).slice(0, 12_000);
          updateRenderedAssistant(assistant, true);
        } else if (event.type === "done") {
          if (typeof event.reply === "string" && !assistant.content) {
            assistant.content = event.reply.slice(0, 12_000);
          }
          if (event.route) assistant.route = String(event.route);
          awaitingSafetyAnswer = event.awaitingSafetyAnswer === true;
          awaitingSafetyAnswerSince = awaitingSafetyAnswer ? Date.now() : null;
          finished = true;
        } else if (event.type === "error") {
          const error = new Error(event.error || copy.requestFailed);
          error.reference = event.reference || "";
          throw error;
        }
      });
    } else {
      const result = await response.json().catch(() => ({}));
      assistant.route = String(result.route || "ORDINARY");
      assistant.content = String(result.reply || copy.missingReply).slice(0, 12_000);
      awaitingSafetyAnswer = result.awaitingSafetyAnswer === true;
      awaitingSafetyAnswerSince = awaitingSafetyAnswer ? Date.now() : null;
      finished = true;
    }

    if (!finished && !assistant.content) throw new Error(copy.missingReply);
    assistant.status = "complete";
    assistant.content = assistant.content || copy.missingReply;
    assistant.retryText = "";
    modulateTerrain(assistant.content);
    finalizeRenderedAssistant(assistant);
    persistThread();
    setComposerStatus(privateMode ? "Private chat: account memory was not used." : "");
  } catch (error) {
    const stopped = error?.name === "AbortError";
    if (stopped) {
      assistant.status = "stopped";
      assistant.content = assistant.content || "Stopped before a reply arrived.";
      assistant.retryText = clean;
      finalizeRenderedAssistant(assistant);
      setComposerStatus("Response stopped.");
    } else {
      assistant.status = "error";
      assistant.content = requestErrorMessage(error?.message, error?.reference);
      assistant.retryText = clean;
      renderThread();
      input.value = clean;
      saveDraft();
      setComposerStatus(sawDelta ? "The response was interrupted. Your message is restored." : "Your message is restored.");
    }
    persistThread();
  } finally {
    activeAbortController = null;
    setPending(false);
    input.focus({ preventScroll: true });
  }
}

async function sendMessage(text) {
  const clean = boundedText(text, 4_000);
  if (!clean || pending) return;
  await runAssistantRequest(clean, { appendUser: true });
}

function retryMessage(messageId) {
  if (pending) return;
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return;
  const failed = messages[index];
  const clean = boundedText(failed.retryText, 4_000);
  if (!clean) return;
  messages.splice(index, 1);
  persistThread();
  renderThread();
  void runAssistantRequest(clean, { appendUser: false });
}

function resetConversation() {
  if (pending) return;
  window.speechSynthesis?.cancel?.();
  messages = [];
  awaitingSafetyAnswer = false;
  awaitingSafetyAnswerSince = null;
  privateMode = false;
  updatePrivateControl();
  clearPersistedThread();
  chatLog.replaceChildren();
  chatLog.hidden = true;
  setView("compose");
  setComposerStatus("");
  input.focus({ preventScroll: true });
}

function configureVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition || !(microphoneButton instanceof HTMLButtonElement)) return;
  microphoneButton.hidden = false;
  microphoneButton.addEventListener("click", () => {
    if (activeRecognition) {
      activeRecognition.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = document.documentElement.lang || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    const original = input.value.trim();
    activeRecognition = recognition;
    microphoneButton.setAttribute("aria-pressed", "true");
    microphoneButton.textContent = "Listening…";
    setComposerStatus("Listening. Tap again to stop.");
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript || "";
      }
      input.value = [original, transcript.trim()].filter(Boolean).join(original ? " " : "").slice(0, 4_000);
      saveDraft();
    };
    recognition.onerror = () => setComposerStatus("Voice input was not available.");
    recognition.onend = () => {
      activeRecognition = null;
      microphoneButton.setAttribute("aria-pressed", "false");
      microphoneButton.textContent = "Voice";
      setComposerStatus("");
      input.focus({ preventScroll: true });
    };
    recognition.start();
  });
}

async function checkServiceHealth() {
  if (!(serviceStatus instanceof HTMLElement) || !(serviceStatusDot instanceof HTMLElement)) return;
  try {
    const response = await fetch("/api/health", { headers: { Accept: "application/json" } });
    const health = await response.json().catch(() => ({}));
    if (response.ok && health.ok) {
      serviceStatus.textContent = "Service available";
      serviceStatusDot.dataset.state = "ok";
    } else {
      serviceStatus.textContent = "Service needs attention";
      serviceStatusDot.dataset.state = "error";
    }
  } catch {
    serviceStatus.textContent = "Service status unavailable";
    serviceStatusDot.dataset.state = "error";
  }
}

function applyBackgroundMode(mode) {
  const still = mode === "still";
  document.body.dataset.backgroundMode = still ? "still" : "calm";
  if (backgroundModeButton instanceof HTMLButtonElement) {
    backgroundModeButton.setAttribute("aria-pressed", String(still));
    backgroundModeButton.textContent = still ? "Use animated background" : "Use still background";
  }
}

function configureBackgroundMode() {
  let saved = "calm";
  try {
    saved = localStorage.getItem(BACKGROUND_STORAGE_KEY) === "still" ? "still" : "calm";
  } catch {
    // Use the default calm background.
  }
  applyBackgroundMode(saved);
  if (!(backgroundModeButton instanceof HTMLButtonElement)) return;
  backgroundModeButton.addEventListener("click", () => {
    const next = document.body.dataset.backgroundMode === "still" ? "calm" : "still";
    applyBackgroundMode(next);
    try { localStorage.setItem(BACKGROUND_STORAGE_KEY, next); } catch { /* optional */ }
  });
}

function renderMemoryRecent(items) {
  if (!(memoryRecent instanceof HTMLElement)) return;
  memoryRecent.replaceChildren();
  if (!Array.isArray(items) || !items.length) {
    memoryRecent.textContent = "No recent uncondensed context.";
    return;
  }
  for (const item of items.slice(-8)) {
    const block = document.createElement("p");
    block.className = "memory-recent-item";
    const label = document.createElement("strong");
    label.textContent = item.role === "assistant" ? "Stabilize: " : "You: ";
    block.append(label, document.createTextNode(String(item.content || "")));
    memoryRecent.appendChild(block);
  }
}

async function loadMemory() {
  if (!signedIn) return;
  if (memoryStatus instanceof HTMLElement) memoryStatus.textContent = "Loading memory…";
  try {
    const response = await fetch("/api/memory", { headers: { Accept: "application/json" } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Memory could not be loaded.");
    if (memorySummary instanceof HTMLTextAreaElement) memorySummary.value = result.summary || "";
    renderMemoryRecent(result.recent);
    if (memoryStatus instanceof HTMLElement) {
      memoryStatus.textContent = result.updatedAt
        ? `Last updated ${new Date(result.updatedAt).toLocaleString()}.`
        : "Nothing is remembered yet.";
    }
  } catch (error) {
    if (memoryStatus instanceof HTMLElement) memoryStatus.textContent = error.message;
  }
}

function configureMemoryControls() {
  if (!(memoryButton instanceof HTMLButtonElement)) return;
  memoryButton.addEventListener("click", async () => {
    if (!signedIn) return;
    if (memoryDialog instanceof HTMLDialogElement) memoryDialog.showModal();
    await loadMemory();
  });

  if (memorySaveButton instanceof HTMLButtonElement) {
    memorySaveButton.addEventListener("click", async () => {
      if (!(memorySummary instanceof HTMLTextAreaElement)) return;
      memorySaveButton.disabled = true;
      if (memoryStatus instanceof HTMLElement) memoryStatus.textContent = "Saving correction…";
      try {
        const response = await fetch("/api/memory", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary: memorySummary.value.slice(0, 1_000) }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Memory could not be saved.");
        renderMemoryRecent([]);
        if (memoryStatus instanceof HTMLElement) memoryStatus.textContent = "Memory correction saved.";
      } catch (error) {
        if (memoryStatus instanceof HTMLElement) memoryStatus.textContent = error.message;
      } finally {
        memorySaveButton.disabled = false;
      }
    });
  }

  if (memoryDeleteButton instanceof HTMLButtonElement) {
    memoryDeleteButton.addEventListener("click", async () => {
      const confirmed = window.confirm("Delete all condensed and recent Stabilize memory for this account?");
      if (!confirmed) return;
      memoryDeleteButton.disabled = true;
      if (memoryStatus instanceof HTMLElement) memoryStatus.textContent = "Deleting memory…";
      try {
        const response = await fetch("/api/memory", { method: "DELETE" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Memory could not be deleted.");
        if (memorySummary instanceof HTMLTextAreaElement) memorySummary.value = "";
        renderMemoryRecent([]);
        if (memoryStatus instanceof HTMLElement) memoryStatus.textContent = "All Stabilize account memory was deleted.";
      } catch (error) {
        if (memoryStatus instanceof HTMLElement) memoryStatus.textContent = error.message;
      } finally {
        memoryDeleteButton.disabled = false;
      }
    });
  }
}

function configureInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installButton instanceof HTMLButtonElement) installButton.hidden = false;
  });
  if (installButton instanceof HTMLButtonElement) {
    installButton.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      installButton.hidden = true;
    });
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => null);
    });
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage(input.value);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
input.addEventListener("input", saveDraft);

stopButton.addEventListener("click", () => activeAbortController?.abort());
newChatButton?.addEventListener("click", resetConversation);
privateToggle?.addEventListener("click", () => {
  if (pending) return;
  privateMode = !privateMode;
  updatePrivateControl();
  persistThread();
  setComposerStatus(
    privateMode
      ? "Private chat will not read or write signed-in memory."
      : signedIn
        ? "Signed-in memory can provide continuity."
        : "Guest chat has no account memory.",
  );
});

if (signOutForm instanceof HTMLFormElement) {
  signOutForm.addEventListener("submit", () => {
    clearPersistedThread();
    clearDraft();
  });
}

restoreThread();
restoreDraft();
updatePrivateControl();
renderThread();
configureVoiceInput();
configureBackgroundMode();
configureMemoryControls();
configureInstall();
void checkServiceHealth();

window.addEventListener("pageshow", () => {
  if (!messages.length && restoreThread()) renderThread();
});

import { renderMarkdown } from "./markdown.js";
import { modulateTerrain } from "./background-loader.js?v=20260807-priority-latency-1";

const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const conversationSurface = document.querySelector("#conversation-surface");
const chatLog = document.querySelector("#chat-log");
const outcomeTray = document.querySelector("#outcome-tray");
const copyTemplate = document.querySelector("#client-copy");
const productCopyTemplate = document.querySelector("#product-copy");
const exampleStarts = document.querySelectorAll("[data-example-message]");
const signOutForm = document.querySelector('form[action="/auth/logout"]');
const newConversationButton = document.querySelector(
  "#new-conversation-button",
);
const siteMenu = document.querySelector(".site-menu");
const privateChatButton = document.querySelector("#private-chat-button");
const privateChatStatus = document.querySelector("#private-chat-status");

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
const SAFETY_ANSWER_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_PERSISTED_REPLY_CHARS = 12_000;
const PRIVATE_CHAT_STORAGE_KEY = "stabilize:private-chat:v1";
const MAX_PRIVATE_THREAD_MESSAGES = 6;
const MAX_PRIVATE_THREAD_MESSAGE_CHARS = 3_000;

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
let awaitingSafetyAnswerSince = null;
let pending = false;
let lastSubmittedText = "";
let nextVisibleUserText = "";
let activeAssistantOutput = null;
let privateChat = false;
let privateThreadMessages = [];

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

function clearOutcomeTray() {
  if (!(outcomeTray instanceof HTMLElement)) return;
  outcomeTray.replaceChildren();
  outcomeTray.hidden = true;
}

function renderOutcomeCheck(previousReply, route) {
  if (!(outcomeTray instanceof HTMLElement)) return;
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
      outcomeTray.hidden = true;
      nextVisibleUserText = label;
      void sendMessage(buildOutcomeActionPrompt(prompt, previousReply));
    });
    buttons.push(button);
    actions.appendChild(button);
  }

  section.append(question, actions);
  outcomeTray.replaceChildren(section);
  outcomeTray.hidden = buttons.length === 0;
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

function pendingReplyCopy() {
  const effort =
    document.documentElement.dataset.reasoningEffort || "none";
  return effort === "none"
    ? String(copy.responding || "Responding…")
    : copy.thinking;
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
  if (offerOutcomeCheck) renderOutcomeCheck(content, route);
  else clearOutcomeTray();
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
  appendPrivateThreadMessage("assistant", cleanReply);

  const cleanRoute = /^[A-Z_]{1,64}$/.test(String(route || ""))
    ? String(route)
    : "ORDINARY";
  const record = {
    v: 1,
    reply: cleanReply,
    route: cleanRoute,
    awaitingSafetyAnswer: needsSafetyAnswer === true,
    privateChat,
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
      typeof record.privateChat === "boolean" &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= LAST_ANSWER_MAX_AGE_MS &&
      (!record.awaitingSafetyAnswer || age <= SAFETY_ANSWER_MAX_AGE_MS);

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
  if (record.privateChat !== privateChat) {
    clearPersistedAnswer();
    return false;
  }

  awaitingSafetyAnswer = record.awaitingSafetyAnswer;
  awaitingSafetyAnswerSince = record.awaitingSafetyAnswer ? record.savedAt : null;
  appendPrivateThreadMessage("assistant", record.reply);
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

function resetPrivateThread() {
  privateThreadMessages = [];
}

function appendPrivateThreadMessage(role, content) {
  if (!privateChat || !["user", "assistant"].includes(role)) return;
  const clean = String(content || "")
    .trim()
    .slice(0, MAX_PRIVATE_THREAD_MESSAGE_CHARS);
  if (!clean) return;
  privateThreadMessages.push({ role, content: clean });
  privateThreadMessages = privateThreadMessages.slice(
    -MAX_PRIVATE_THREAD_MESSAGES,
  );
}

function rollbackPrivateUser(content) {
  if (!privateChat) return;
  const clean = String(content || "").trim();
  const latest = privateThreadMessages.at(-1);
  if (latest?.role === "user" && latest.content === clean) {
    privateThreadMessages.pop();
  }
}

function privateChatAvailable() {
  return (
    privateChatButton instanceof HTMLButtonElement &&
    privateChatStatus instanceof HTMLElement
  );
}

function readPrivateChatPreference() {
  if (!privateChatAvailable()) return false;
  try {
    return sessionStorage.getItem(PRIVATE_CHAT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistPrivateChatPreference() {
  try {
    if (privateChat) {
      sessionStorage.setItem(PRIVATE_CHAT_STORAGE_KEY, "true");
    } else {
      sessionStorage.removeItem(PRIVATE_CHAT_STORAGE_KEY);
    }
  } catch {
    // Private mode remains active for this page even if storage is blocked.
  }
}

function renderPrivateChatState() {
  const active = privateChatAvailable() && privateChat;
  if (privateChatButton instanceof HTMLButtonElement) {
    privateChatButton.setAttribute("aria-pressed", String(active));
    privateChatButton.textContent = active
      ? copy.endPrivateChatButton
      : copy.privateChatButton;
  }
  if (privateChatStatus instanceof HTMLElement) {
    privateChatStatus.hidden = !active;
  }
}

function initializePrivateChat() {
  privateChat = readPrivateChatPreference();
  renderPrivateChatState();
}

function clearPrivateChatPreference() {
  privateChat = false;
  persistPrivateChatPreference();
  renderPrivateChatState();
}

function togglePrivateChat() {
  if (pending || !privateChatAvailable()) return;
  privateChat = !privateChat;
  persistPrivateChatPreference();
  resetConversationView();
  renderPrivateChatState();
  if (siteMenu instanceof HTMLDetailsElement) siteMenu.open = false;
  input.focus({ preventScroll: true });
}

function resetConversationView() {
  resetPrivateThread();
  clearPersistedAnswer();
  awaitingSafetyAnswer = false;
  awaitingSafetyAnswerSince = null;
  lastSubmittedText = "";
  nextVisibleUserText = "";
  activeAssistantOutput = null;
  input.value = "";
  chatLog.replaceChildren();
  chatLog.hidden = true;
  chatLog.tabIndex = -1;
  conversationSurface.dataset.view = "compose";
}

async function startNewConversation() {
  if (pending || !(newConversationButton instanceof HTMLButtonElement)) return;
  if (siteMenu instanceof HTMLDetailsElement) siteMenu.open = false;

  setPending(true);
  try {
    const response = await fetch("/api/conversation/new", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ privateChat }),
    });
    if (!response.ok) throw new Error("New conversation request failed");
    resetConversationView();
  } catch {
    showOutput(copy.newConversationFailed, "error-output");
  } finally {
    setPending(false);
    input.focus({ preventScroll: true });
  }
}

function setPending(value) {
  pending = value;
  input.disabled = value;
  sendButton.disabled = value;
if (newConversationButton instanceof HTMLButtonElement) {
    newConversationButton.disabled = value;
  }
  if (privateChatButton instanceof HTMLButtonElement) {
    privateChatButton.disabled = value;
  }
  for (const button of exampleStarts) button.disabled = value;
}

function restoreComposeView() {
  clearOutcomeTray();
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

let streamingRenderHandle = 0;
let streamingRenderUsesAnimationFrame = false;
let queuedStreamingArticle = null;
let queuedStreamingContent = "";

function cancelStreamingOutputRender() {
  if (!streamingRenderHandle) return;
  if (
    streamingRenderUsesAnimationFrame &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(streamingRenderHandle);
  } else {
    window.clearTimeout(streamingRenderHandle);
  }
  streamingRenderHandle = 0;
  streamingRenderUsesAnimationFrame = false;
  queuedStreamingArticle = null;
  queuedStreamingContent = "";
}

function flushStreamingOutput() {
  const article = queuedStreamingArticle;
  const content = queuedStreamingContent;
  streamingRenderHandle = 0;
  streamingRenderUsesAnimationFrame = false;
  queuedStreamingArticle = null;

  if (!(article instanceof HTMLElement)) return;
  article.className = "assistant-output streaming-output";
  article.setAttribute("aria-label", "Stabilize");
  let text = article.querySelector(".streaming-text");
  if (!(text instanceof HTMLElement)) {
    text = document.createElement("div");
    text.className = "streaming-text";
    article.replaceChildren(text);
  }
  text.textContent = content || pendingReplyCopy();
  chatLog.hidden = false;
  chatLog.tabIndex = 0;
  conversationSurface.dataset.view = "response";
  scrollConversationToLatest();
}

function renderStreamingOutput(article, content) {
  queuedStreamingArticle = article;
  queuedStreamingContent = String(content || "");
  if (streamingRenderHandle) return;

  if (typeof window.requestAnimationFrame === "function") {
    streamingRenderUsesAnimationFrame = true;
    streamingRenderHandle = window.requestAnimationFrame(flushStreamingOutput);
  } else {
    streamingRenderUsesAnimationFrame = false;
    streamingRenderHandle = window.setTimeout(flushStreamingOutput, 0);
  }
}

async function readStreamingResponse(response, article) {
  if (!response.body) throw new Error(copy.unexpectedError);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let completed = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "delta" && typeof event.delta === "string") {
          accumulated += event.delta;
          renderStreamingOutput(article, accumulated);
        } else if (event.type === "done") {
          completed = event;
        } else if (event.type === "error") {
          const error = new Error(String(event.error || copy.unexpectedError));
          error.streamingError = true;
          error.reference = String(event.reference || "");
          throw error;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!completed) throw new Error(copy.unexpectedError);
  return completed;
}

function finalizeStreamingOutput(article, reply, route, offerOutcomeCheck) {
  cancelStreamingOutputRender();
  article.className = "assistant-output";
  article.replaceChildren();
  article.appendChild(renderMarkdown(reply));
  if (offerOutcomeCheck) renderOutcomeCheck(reply, route);
  else clearOutcomeTray();
  activeAssistantOutput = null;
  scrollConversationToLatest();
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

function currentAwaitingSafetyAnswer() {
  if (!awaitingSafetyAnswer) return false;
  const age = Date.now() - Number(awaitingSafetyAnswerSince);
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > SAFETY_ANSWER_MAX_AGE_MS
  ) {
    awaitingSafetyAnswer = false;
    awaitingSafetyAnswerSince = null;
    return false;
  }
  return true;
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
  const pendingOutput = showOutput(pendingReplyCopy(), "thinking-output", "thinking");
  appendPrivateThreadMessage("user", clean);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson, application/json",
      },
      body: JSON.stringify({
        message: clean,
        awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),
        privateChat,
        messages: privateChat ? privateThreadMessages : undefined,
      }),
    });

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/x-ndjson")) {
      const result = await readStreamingResponse(response, pendingOutput);
      const reply = String(result.reply || copy.missingReply);
      const route = String(result.route || "ORDINARY");
      const needsSafetyAnswer = result.awaitingSafetyAnswer === true;
      const offerOutcomeCheck =
        !needsSafetyAnswer && !ROUTES_WITHOUT_OUTCOME_CHECK.has(route);
      finalizeStreamingOutput(pendingOutput, reply, route, offerOutcomeCheck);
      modulateTerrain(reply);
      awaitingSafetyAnswer = needsSafetyAnswer;
      awaitingSafetyAnswerSince = needsSafetyAnswer ? Date.now() : null;
      persistLatestAnswer(reply, route, needsSafetyAnswer);
      lastSubmittedText = "";
      return;
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      rollbackPrivateUser(clean);
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
    awaitingSafetyAnswerSince = needsSafetyAnswer ? Date.now() : null;
    persistLatestAnswer(reply, route, needsSafetyAnswer);
    lastSubmittedText = "";
  } catch (error) {
    cancelStreamingOutputRender();
    rollbackPrivateUser(clean);
    input.value = clean;
    lastSubmittedText = "";
    const message = error?.streamingError ? error.message : copy.unexpectedError;
    const reference = error?.streamingError ? error.reference : "";
    showOutput(requestErrorMessage(message, reference), "error-output");
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

if (privateChatButton instanceof HTMLButtonElement) {
  privateChatButton.addEventListener("click", togglePrivateChat);
}

if (newConversationButton instanceof HTMLButtonElement) {
  newConversationButton.addEventListener("click", () => {
    void startNewConversation();
  });
}

if (signOutForm instanceof HTMLFormElement) {
  signOutForm.addEventListener("submit", () => {
    clearPersistedAnswer();
    clearPrivateChatPreference();
  });
}

initializePrivateChat();
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

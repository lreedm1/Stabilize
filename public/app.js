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
const deleteMemoryButton = document.querySelector("#delete-memory-button");
const memoryDeleteStatus = document.querySelector("#memory-delete-status");
const signedIn = document.documentElement.dataset.signedIn === "true";

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
const GUEST_THREAD_STORAGE_KEY = "stabilize:guest-thread:v3";
const LEGACY_GUEST_THREAD_STORAGE_KEY = "stabilize:guest-thread:v2";
const FIRST_GUEST_THREAD_STORAGE_KEY = "stabilize:guest-thread:v1";
const GUEST_THREAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_GUEST_THREAD_MESSAGE_CHARS = 4_000;
// Retained only to read an already-open v2 guest tab without losing its summary.
const MAX_GUEST_SUMMARY_CHARS = 30_000;
const MAX_CHAT_REQUEST_BYTES = 1_900_000;

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
let guestThreadMessages = [];
let guestLegacySummary = "";
let guestLegacyMessages = [];
let pendingLocalThreadSnapshot = null;

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
  appendLocalThreadMessage("assistant", cleanReply);

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
  appendLocalThreadMessage("assistant", record.reply);
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

function clearGuestThreadStorage() {
  try {
    sessionStorage.removeItem(GUEST_THREAD_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_GUEST_THREAD_STORAGE_KEY);
    sessionStorage.removeItem(FIRST_GUEST_THREAD_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
}

function cloneThreadMessages(messages) {
  return Array.isArray(messages)
    ? messages.map((message) => ({
        role: message.role,
        content: message.content,
      }))
    : [];
}

function normalizeGuestMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message) =>
        message && ["user", "assistant"].includes(message.role),
    )
    .map((message) => ({
      role: message.role,
      content: String(message.content || "")
        .trim()
        .slice(0, MAX_GUEST_THREAD_MESSAGE_CHARS),
    }))
    .filter((message) => message.content);
}

function normalizeGuestThread(messages) {
  return normalizeGuestMessages(messages);
}

function normalizeGuestSummary(value) {
  return String(value || "").trim().slice(0, MAX_GUEST_SUMMARY_CHARS);
}

function guestThreadIsEmpty() {
  return (
    !guestLegacySummary &&
    guestLegacyMessages.length === 0 &&
    guestThreadMessages.length === 0
  );
}

function persistGuestThread() {
  if (signedIn || privateChat || guestThreadIsEmpty()) {
    clearGuestThreadStorage();
    return;
  }
  try {
    sessionStorage.setItem(
      GUEST_THREAD_STORAGE_KEY,
      JSON.stringify({
        v: 3,
        savedAt: Date.now(),
        legacySummary: guestLegacySummary,
        legacyMessages: guestLegacyMessages,
        messages: guestThreadMessages,
      }),
    );
    sessionStorage.removeItem(LEGACY_GUEST_THREAD_STORAGE_KEY);
    sessionStorage.removeItem(FIRST_GUEST_THREAD_STORAGE_KEY);
  } catch {
    // The active page still keeps the complete thread in memory.
  }
}

function initializeGuestThread() {
  if (signedIn || privateChat) {
    guestThreadMessages = [];
    guestLegacySummary = "";
    guestLegacyMessages = [];
    clearGuestThreadStorage();
    return;
  }

  try {
    const currentRaw = sessionStorage.getItem(GUEST_THREAD_STORAGE_KEY);
    const legacyRaw = sessionStorage.getItem(LEGACY_GUEST_THREAD_STORAGE_KEY);
    const firstRaw = sessionStorage.getItem(FIRST_GUEST_THREAD_STORAGE_KEY);
    const record = JSON.parse(currentRaw || legacyRaw || firstRaw || "null");
    const age = Date.now() - Number(record?.savedAt);
    if (
      ![1, 2, 3].includes(record?.v) ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > GUEST_THREAD_MAX_AGE_MS
    ) {
      resetGuestThread();
      return;
    }

    guestThreadMessages = normalizeGuestThread(record.messages);
    guestLegacySummary = normalizeGuestSummary(
      record.v === 3 ? record.legacySummary : record.v === 2 ? record.summary : "",
    );
    guestLegacyMessages = normalizeGuestMessages(
      record.v === 3
        ? record.legacyMessages
        : record.v === 2
          ? record.summaryMessages
          : [],
    );

    if (guestThreadIsEmpty()) clearGuestThreadStorage();
    else persistGuestThread();
  } catch {
    resetGuestThread();
  }
}

function resetGuestThread() {
  guestThreadMessages = [];
  guestLegacySummary = "";
  guestLegacyMessages = [];
  if (pendingLocalThreadSnapshot?.type === "guest") {
    pendingLocalThreadSnapshot = null;
  }
  clearGuestThreadStorage();
}

function appendGuestThreadMessage(role, content) {
  if (signedIn || privateChat || !["user", "assistant"].includes(role)) {
    return;
  }
  const clean = String(content || "")
    .trim()
    .slice(0, MAX_GUEST_THREAD_MESSAGE_CHARS);
  if (!clean) return;

  guestThreadMessages = normalizeGuestThread([
    ...guestThreadMessages,
    { role, content: clean },
  ]);
  persistGuestThread();
}

function activeLocalThreadMessages() {
  if (privateChat) return privateThreadMessages;
  if (!signedIn) return guestThreadMessages;
  return [];
}

function appendLocalThreadMessage(role, content) {
  if (privateChat) {
    appendPrivateThreadMessage(role, content);
  } else if (!signedIn) {
    appendGuestThreadMessage(role, content);
  }
}

function beginLocalThreadSnapshot() {
  if (privateChat) {
    pendingLocalThreadSnapshot = {
      type: "private",
      messages: cloneThreadMessages(privateThreadMessages),
    };
    return;
  }
  if (!signedIn) {
    pendingLocalThreadSnapshot = {
      type: "guest",
      legacySummary: guestLegacySummary,
      legacyMessages: cloneThreadMessages(guestLegacyMessages),
      messages: cloneThreadMessages(guestThreadMessages),
    };
    return;
  }
  pendingLocalThreadSnapshot = null;
}

function commitLocalThreadSnapshot() {
  pendingLocalThreadSnapshot = null;
}

function rollbackLocalUser(content) {
  if (pendingLocalThreadSnapshot?.type === "private" && privateChat) {
    privateThreadMessages = cloneThreadMessages(
      pendingLocalThreadSnapshot.messages,
    );
    commitLocalThreadSnapshot();
    return;
  }
  if (pendingLocalThreadSnapshot?.type === "guest" && !signedIn && !privateChat) {
    guestLegacySummary = normalizeGuestSummary(
      pendingLocalThreadSnapshot.legacySummary,
    );
    guestLegacyMessages = normalizeGuestMessages(
      pendingLocalThreadSnapshot.legacyMessages,
    );
    guestThreadMessages = normalizeGuestThread(
      pendingLocalThreadSnapshot.messages,
    );
    commitLocalThreadSnapshot();
    persistGuestThread();
    return;
  }

  const clean = String(content || "").trim();
  const thread = activeLocalThreadMessages();
  const latest = thread.at(-1);
  if (latest?.role !== "user" || latest.content !== clean) return;
  if (privateChat) privateThreadMessages.pop();
  else if (!signedIn) {
    guestThreadMessages.pop();
    persistGuestThread();
  }
}

function restoreGuestConversation() {
  if (signedIn || privateChat || guestThreadMessages.length === 0) return false;

  const persisted = readPersistedAnswer();
  const lastAssistantIndex = guestThreadMessages.findLastIndex(
    (message) => message.role === "assistant",
  );
  chatLog.replaceChildren();
  clearOutcomeTray();

  guestThreadMessages.forEach((message, index) => {
    if (message.role === "user") {
      appendUserOutput(message.content);
      return;
    }

    const isLastAssistant = index === lastAssistantIndex;
    const route =
      isLastAssistant && persisted?.reply === message.content
        ? String(persisted.route || "ORDINARY")
        : "ORDINARY";
    const needsSafetyAnswer =
      isLastAssistant &&
      persisted?.reply === message.content &&
      persisted.awaitingSafetyAnswer === true;
    showOutput(message.content, "", "response", {
      offerOutcomeCheck:
        isLastAssistant &&
        !needsSafetyAnswer &&
        !ROUTES_WITHOUT_OUTCOME_CHECK.has(route),
      route,
    });

    if (isLastAssistant) {
      awaitingSafetyAnswer = needsSafetyAnswer;
      awaitingSafetyAnswerSince = needsSafetyAnswer
        ? Number(persisted?.savedAt) || Date.now()
        : null;
    }
  });

  const latest = guestThreadMessages.at(-1);
  if (latest?.content) modulateTerrain(latest.content);
  return true;
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
  if (deleteMemoryButton instanceof HTMLButtonElement) {
  deleteMemoryButton.addEventListener("click", () => {
    void deleteRememberedContext();
  });
}

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
  resetGuestThread();
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
  if (deleteMemoryButton instanceof HTMLButtonElement) {
    deleteMemoryButton.disabled = value;
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

function buildChatRequestBody(clean) {
  let messages =
    privateChat || !signedIn
      ? cloneThreadMessages(activeLocalThreadMessages())
      : undefined;
  if (messages?.at(-1)?.role === "user" && messages.at(-1).content === clean) {
    messages.pop();
  }

  const isGuest = !signedIn && !privateChat;
  const payload = {
    message: clean,
    awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),
    privateChat,
    messages,
  };
  if (isGuest && guestLegacySummary) {
    payload.guestSummary = guestLegacySummary;
  }
  if (isGuest && guestLegacyMessages.length > 0) {
    payload.guestSummaryMessages = cloneThreadMessages(guestLegacyMessages);
  }

  const serialized = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_CHAT_REQUEST_BYTES) {
    const error = new Error("Guest conversation exceeds the request limit");
    error.publicMessage =
      "This guest conversation is too large to send as one request. Start a new conversation to continue; Stabilize has not silently discarded the earlier messages.";
    throw error;
  }
  return serialized;
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
  beginLocalThreadSnapshot();
  appendLocalThreadMessage("user", clean);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson, application/json",
      },
      body: buildChatRequestBody(clean),
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
      commitLocalThreadSnapshot();
      lastSubmittedText = "";
      return;
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      rollbackLocalUser(clean);
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
    commitLocalThreadSnapshot();
    lastSubmittedText = "";
  } catch (error) {
    cancelStreamingOutputRender();
    rollbackLocalUser(clean);
    input.value = clean;
    lastSubmittedText = "";
    const message =
      error?.publicMessage ||
      (error?.streamingError ? error.message : copy.unexpectedError);
    const reference = error?.streamingError ? error.reference : "";
    showOutput(requestErrorMessage(message, reference), "error-output");
  } finally {
    setPending(false);
    input.focus({ preventScroll: true });
  }
}

function setMemoryDeleteStatus(message, isError = false) {
  if (!(memoryDeleteStatus instanceof HTMLElement)) return;
  memoryDeleteStatus.textContent = String(message || "");
  memoryDeleteStatus.hidden = !message;
  memoryDeleteStatus.classList.toggle("is-error", isError);
}

async function deleteRememberedContext() {
  if (pending || !(deleteMemoryButton instanceof HTMLButtonElement)) return;
  if (!window.confirm(copy.deleteMemoryConfirm)) return;

  const originalLabel = deleteMemoryButton.textContent;
  setPending(true);
  deleteMemoryButton.textContent = copy.deleteMemoryPending;
  setMemoryDeleteStatus("");

  try {
    const response = await fetch("/api/account/memory", {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Memory deletion request failed");
    const result = await response.json().catch(() => ({}));
    if (result.deleted !== true) throw new Error("Memory was not deleted");

    resetConversationView();
    setMemoryDeleteStatus(copy.deleteMemorySuccess);
  } catch {
    setMemoryDeleteStatus(copy.deleteMemoryFailed, true);
  } finally {
    deleteMemoryButton.textContent = originalLabel || copy.deleteMemoryButton;
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
    resetGuestThread();
    resetPrivateThread();
    clearPrivateChatPreference();
  });
}

initializePrivateChat();
initializeGuestThread();
if (!restoreGuestConversation()) restorePersistedAnswer();

window.addEventListener("pageshow", (event) => {
  const view = conversationSurface.dataset.view || "compose";
  const outputIsMissing = chatLog.hidden || chatLog.childElementCount === 0;
  const interruptedThinkingView = event.persisted && view === "thinking";

  if (interruptedThinkingView) {
    recoverInterruptedThinking();
    return;
  }

  if (view !== "compose" && outputIsMissing) {
    if (!restoreGuestConversation() && !restorePersistedAnswer()) {
      restoreComposeView();
    }
  }
});

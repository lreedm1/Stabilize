import { renderMarkdown } from "./markdown.js";
import { modulateTerrain } from "./terrain.js";
import { createContinuityValidationGate } from "./continuity-guard.js";

const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const conversationSurface = document.querySelector("#conversation-surface");
const chatLog = document.querySelector("#chat-log");
const copyTemplate = document.querySelector("#client-copy");
const productCopyTemplate = document.querySelector("#product-copy");
const continuityTemplate = document.querySelector("#continuity-state");
const clientNotice = document.querySelector("#client-notice");
const memoryDeletionTemplate = document.querySelector(
  "#memory-deletion-state",
);
const exampleStarts = document.querySelectorAll("[data-example-message]");
const signOutForm = document.querySelector('form[action="/auth/logout"]');
const deleteMemoryForm = document.querySelector(
  'form[action$="/memory/delete"]',
);

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
const LEGACY_LAST_ANSWER_STORAGE_KEY = "stabilize:last-answer:v1";
const RETIRED_LAST_ANSWER_STORAGE_PREFIX = "stabilize:last-answer:v2:";
const LAST_ANSWER_STORAGE_PREFIX = "stabilize:last-answer:v3:";
const DELETION_PENDING_STORAGE_PREFIX =
  "stabilize:memory-delete-pending:v1:";
const LAST_ANSWER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SAFETY_ANSWER_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_PERSISTED_REPLY_CHARS = 12_000;
const CONTINUITY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONTINUITY_CHANNEL_NAME = "stabilize:continuity:v1";
const MAX_NOTICE_CHARS = 500;

function validContinuity(value) {
  const token = String(value?.token || "");
  if (
    value?.mode === "guest" &&
    (value.token === null || CONTINUITY_TOKEN_PATTERN.test(token))
  ) {
    return Object.freeze({
      mode: "guest",
      token: value.token === null ? null : token,
    });
  }
  if (value?.mode === "account" && CONTINUITY_TOKEN_PATTERN.test(token)) {
    return Object.freeze({ mode: "account", token });
  }

  return null;
}

function renderedContinuity() {
  if (!(continuityTemplate instanceof HTMLTemplateElement)) {
    return Object.freeze({ mode: "guest", token: null });
  }

  try {
    return (
      validContinuity(JSON.parse(continuityTemplate.content.textContent)) ||
      Object.freeze({ mode: "guest", token: null })
    );
  } catch {
    return Object.freeze({ mode: "guest", token: null });
  }
}

function sameContinuity(left, right) {
  return Boolean(
    left &&
      right &&
      left.mode === right.mode &&
      left.token === right.token,
  );
}

function continuityMessage(value) {
  const typed = value?.type === "state" || value?.type === "memory-deleted";
  const continuity = validContinuity(typed ? value.continuity : value);
  if (!continuity) return null;

  return {
    type: typed ? value.type : "state",
    continuity,
  };
}

const continuityState = renderedContinuity();
const memoryDeletionConfirmation = (() => {
  if (
    !(memoryDeletionTemplate instanceof HTMLTemplateElement)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(memoryDeletionTemplate.content.textContent);
    const deletedContinuity = validContinuity(parsed?.deletedContinuity);
    if (
      parsed?.confirmed !== true ||
      !deletedContinuity ||
      deletedContinuity.token === null
    ) {
      return null;
    }
    return Object.freeze({
      confirmed: true,
      deletedContinuity,
    });
  } catch {
    return null;
  }
})();

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
let reloadRequested = false;
let activeRequestController = null;
let continuityChannel = null;
let continuityCheckPromise = null;
let continuityCheckEpoch = null;
let continuityVerified = continuityState.token === null;
const continuityValidationGate = createContinuityValidationGate();

function buildOutcomeActionPrompt(instruction, previousReply) {
  const request = String(instruction || "").trim();
  const context = String(previousReply || "").trim().slice(0, 3000);
  if (!request) return "";
  if (continuityState.token !== null) return request;
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

function appendOutcomeCheck(article, previousReply, route) {
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
      void sendMessage(buildOutcomeActionPrompt(prompt, previousReply));
    });
    buttons.push(button);
    actions.appendChild(button);
  }

  section.append(question, actions);
  article.appendChild(section);
}

function showOutput(
  content,
  extraClass = "",
  view = "response",
  { offerOutcomeCheck = false, route = "ORDINARY" } = {},
) {
  chatLog.replaceChildren();
  const article = document.createElement("article");
  article.className = `assistant-output ${extraClass}`.trim();
  article.appendChild(renderMarkdown(content));
  if (offerOutcomeCheck) appendOutcomeCheck(article, content, route);
  chatLog.appendChild(article);
  chatLog.hidden = false;
  chatLog.tabIndex = view === "response" ? 0 : -1;
  conversationSurface.dataset.view = view;
  chatLog.scrollTop = 0;
  return article;
}

function continuityStorageKey(state = continuityState) {
  const partition = `${state.mode}:${state.token || "legacy"}`;
  return LAST_ANSWER_STORAGE_PREFIX + partition;
}

function deletionPendingStorageKey(state = continuityState) {
  return (
    DELETION_PENDING_STORAGE_PREFIX +
    `${state.mode}:${state.token || "legacy"}`
  );
}

function markDeletionPending(state = continuityState) {
  if (state.token === null) return;
  try {
    localStorage.setItem(deletionPendingStorageKey(state), String(Date.now()));
  } catch {
    // The form submission remains authoritative when storage is unavailable.
  }
}

function deletionIsPending(state = continuityState) {
  try {
    return localStorage.getItem(deletionPendingStorageKey(state)) !== null;
  } catch {
    return false;
  }
}

function clearDeletionPending(state) {
  if (!state || state.token === null) return;
  try {
    localStorage.removeItem(deletionPendingStorageKey(state));
  } catch {
    // A confirmed receipt remains authoritative when storage is unavailable.
  }
}

function showClientNotice(message, kind) {
  if (!(clientNotice instanceof HTMLElement)) return;
  const clean = String(message || "").trim().slice(0, MAX_NOTICE_CHARS);
  if (!clean) return;
  clientNotice.textContent = clean;
  clientNotice.dataset.kind = String(kind || "status");
  clientNotice.hidden = false;
}

function clearClientNotice(kind) {
  if (!(clientNotice instanceof HTMLElement)) return;
  if (kind && clientNotice.dataset.kind !== kind) return;
  clientNotice.textContent = "";
  clientNotice.dataset.kind = "";
  clientNotice.hidden = true;
}

function clearPersistedAnswer(state = continuityState) {
  try {
    localStorage.removeItem(continuityStorageKey(state));
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
}

function clearAllPersistedAnswers() {
  try {
    localStorage.removeItem(LEGACY_LAST_ANSWER_STORAGE_KEY);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (
        key?.startsWith(LAST_ANSWER_STORAGE_PREFIX) ||
        key?.startsWith(RETIRED_LAST_ANSWER_STORAGE_PREFIX)
      ) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Deletion must continue even when browser storage is unavailable.
  }
  try {
    sessionStorage.removeItem(LEGACY_LAST_ANSWER_STORAGE_KEY);
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(RETIRED_LAST_ANSWER_STORAGE_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Retiring older tab-only records is best effort.
  }
}

function retireStalePersistedAnswers() {
  try {
    sessionStorage.removeItem(LEGACY_LAST_ANSWER_STORAGE_KEY);
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(RETIRED_LAST_ANSWER_STORAGE_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Stale-partition cleanup is best effort in hardened browser contexts.
  }
  try {
    localStorage.removeItem(LEGACY_LAST_ANSWER_STORAGE_KEY);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(RETIRED_LAST_ANSWER_STORAGE_PREFIX)) {
        localStorage.removeItem(key);
        continue;
      }
      if (!key?.startsWith(LAST_ANSWER_STORAGE_PREFIX)) continue;
      try {
        const record = JSON.parse(localStorage.getItem(key) || "null");
        const age = Date.now() - Number(record?.savedAt);
        if (
          record?.v !== 3 ||
          !persistedAnswerIsCurrent(record, age)
        ) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Browser storage may be disabled or unavailable.
  }
}

function persistedAnswerIsCurrent(record, age) {
  return (
    Number.isFinite(age) &&
    age >= 0 &&
    age <= LAST_ANSWER_MAX_AGE_MS &&
    (!record.awaitingSafetyAnswer || age <= SAFETY_ANSWER_MAX_AGE_MS)
  );
}

function persistLatestAnswer(reply, route, needsSafetyAnswer) {
  if (continuityState.mode !== "guest" || continuityState.token === null) {
    return;
  }
  const cleanReply = String(reply || "").trim().slice(0, MAX_PERSISTED_REPLY_CHARS);
  if (!cleanReply) return;

  const cleanRoute = /^[A-Z_]{1,64}$/.test(String(route || ""))
    ? String(route)
    : "ORDINARY";
  const record = {
    v: 3,
    continuity: continuityState,
    reply: cleanReply,
    route: cleanRoute,
    awaitingSafetyAnswer: needsSafetyAnswer === true,
    savedAt: Date.now(),
  };

  try {
    localStorage.setItem(
      continuityStorageKey(),
      JSON.stringify(record),
    );
  } catch {
    // A successful response should remain usable even when storage is blocked.
  }
}

function readPersistedAnswer() {
  if (continuityState.mode !== "guest" || continuityState.token === null) {
    clearPersistedAnswer();
    return null;
  }
  if (deletionIsPending()) return null;
  try {
    const raw = localStorage.getItem(continuityStorageKey());
    if (!raw) return null;

    const record = JSON.parse(raw);
    const recordContinuity = validContinuity(record?.continuity);
    const age = Date.now() - Number(record?.savedAt);
    const valid =
      record?.v === 3 &&
      sameContinuity(recordContinuity, continuityState) &&
      typeof record.reply === "string" &&
      record.reply.trim().length > 0 &&
      record.reply.length <= MAX_PERSISTED_REPLY_CHARS &&
      /^[A-Z_]{1,64}$/.test(String(record.route || "")) &&
      typeof record.awaitingSafetyAnswer === "boolean" &&
      persistedAnswerIsCurrent(record, age);

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

  awaitingSafetyAnswer = record.awaitingSafetyAnswer;
  awaitingSafetyAnswerSince = record.awaitingSafetyAnswer ? record.savedAt : null;
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

function setPending(value) {
  pending = value;
  input.disabled = value;
  sendButton.disabled = value;
  for (const button of exampleStarts) button.disabled = value;
}

function hideForContinuityReload() {
  chatLog.replaceChildren();
  chatLog.hidden = true;
  chatLog.tabIndex = -1;
  conversationSurface.hidden = true;
}

function hideContinuitySurface() {
  if (continuityState.token === null) return;
  continuityValidationGate.invalidate();
  continuityVerified = false;
  conversationSurface.hidden = true;
}

function revealContinuitySurface() {
  if (
    continuityState.token === null ||
    reloadRequested ||
    deletionIsPending()
  ) {
    return;
  }
  conversationSurface.hidden = false;
}

function reloadForContinuityChange({ clearStored = false } = {}) {
  if (reloadRequested) return;
  reloadRequested = true;
  if (clearStored) clearAllPersistedAnswers();
  activeRequestController?.abort();
  hideForContinuityReload();
  window.location.reload();
}

function scrubForMemoryDeletion(deletedContinuity) {
  clearPersistedAnswer(deletedContinuity);
  clearDeletionPending(deletedContinuity);
  activeRequestController?.abort();
  awaitingSafetyAnswer = false;
  awaitingSafetyAnswerSince = null;
  lastSubmittedText = "";
  input.value = "";
  restoreComposeView();
  hideContinuitySurface();
}

async function revalidateContinuity() {
  if (continuityState.token === null || reloadRequested) return true;
  const validationEpoch = continuityValidationGate.snapshot();
  if (
    continuityCheckPromise &&
    continuityCheckEpoch === validationEpoch
  ) {
    return continuityCheckPromise;
  }

  let validationPromise;
  validationPromise = (async () => {
    try {
      const response = await fetch("/api/auth", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Session check failed");
      const result = await response.json();
      if (!continuityValidationGate.isCurrent(validationEpoch)) return false;
      const currentContinuity = validContinuity(result.continuity);
      const authoritativeState = Boolean(
        (result.signedIn === true && currentContinuity?.mode === "account") ||
          (result.signedIn === false && currentContinuity?.mode === "guest"),
      );
      if (!authoritativeState) throw new Error("Invalid session check");
      if (
        !sameContinuity(currentContinuity, continuityState)
      ) {
        clearPersistedAnswer();
        reloadForContinuityChange();
        return false;
      }

      continuityVerified = true;
      clearClientNotice("session-check");
      if (
        continuityState.mode === "guest" &&
        !pending &&
        (conversationSurface.dataset.view || "compose") === "compose"
      ) {
        restorePersistedAnswer();
      }
      revealContinuitySurface();
      continuityChannel?.postMessage({
        type: "state",
        continuity: continuityState,
      });
      return true;
    } catch {
      if (
        reloadRequested ||
        !continuityValidationGate.isCurrent(validationEpoch)
      ) {
        return false;
      }
      hideContinuitySurface();
      showClientNotice(copy.sessionCheckFailed, "session-check");
      return false;
    } finally {
      if (continuityCheckPromise === validationPromise) {
        continuityCheckPromise = null;
        continuityCheckEpoch = null;
      }
    }
  })();

  continuityCheckPromise = validationPromise;
  continuityCheckEpoch = validationEpoch;
  return validationPromise;
}

function startContinuityChannel() {
  if (typeof BroadcastChannel !== "function") return;

  try {
    continuityChannel = new BroadcastChannel(CONTINUITY_CHANNEL_NAME);
    continuityChannel.addEventListener("message", (event) => {
      const message = continuityMessage(event.data);
      if (!message || continuityState.token === null) return;

      if (
        message.type === "memory-deleted" &&
        sameContinuity(message.continuity, continuityState)
      ) {
        scrubForMemoryDeletion(message.continuity);
        void revalidateContinuity();
        return;
      }

      const otherContinuity = message.continuity;
      if (sameContinuity(otherContinuity, continuityState)) return;

      // Cross-tab messages are hints; the cookie-bound endpoint is authoritative.
      hideContinuitySurface();
      void revalidateContinuity();
    });
  } catch {
    continuityChannel = null;
  }
}

function restoreComposeView() {
  chatLog.replaceChildren();
  chatLog.hidden = true;
  chatLog.tabIndex = -1;
  conversationSurface.dataset.view = "compose";
  setPending(false);

  if (!input.value && lastSubmittedText) {
    input.value = lastSubmittedText;
  }
  conversationSurface.dataset.view = "compose";
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

async function resetGuestSession(continuity, grant) {
  if (
    continuity?.mode !== "guest" ||
    !continuity.token ||
    typeof grant !== "string" ||
    !grant ||
    grant.length > 4_096
  ) {
    return;
  }
  try {
    await fetch("/guest/session/reset", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ continuity: continuity.token, grant }),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    // Reload still lets the server re-evaluate any cookie changed elsewhere.
  }
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
  if (!clean || pending) return;

  if (deletionIsPending()) {
    hideForContinuityReload();
    showClientNotice(copy.deletionPending, "deletion-pending");
    return;
  }

  if (continuityState.token !== null && !continuityVerified) {
    hideContinuitySurface();
    const verified = await revalidateContinuity();
    if (!verified) return;
  }

  const requestContinuity = continuityState;
  const requestController = new AbortController();
  activeRequestController = requestController;
  lastSubmittedText = clean;
  modulateTerrain(clean);
  input.value = "";
  setPending(true);
  showOutput(copy.thinking, "thinking-output", "thinking");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: clean,
        awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),
        continuity: requestContinuity,
      }),
      signal: requestController.signal,
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 409 && result.reload === true) {
      clearPersistedAnswer(requestContinuity);
      if (result.resetGuest === true) {
        await resetGuestSession(
          requestContinuity,
          result.guestResetGrant,
        );
      }
      reloadForContinuityChange();
      return;
    }

    if (!response.ok) {
      input.value = clean;
      lastSubmittedText = "";
      showOutput(
        requestErrorMessage(result.error, result.reference),
        "error-output",
      );
      return;
    }

    const responseContinuity = validContinuity(result.continuity);
    if (!sameContinuity(responseContinuity, requestContinuity)) {
      clearPersistedAnswer(requestContinuity);
      reloadForContinuityChange();
      return;
    }

    if (requestController.signal.aborted) {
      hideForContinuityReload();
      return;
    }

    if (deletionIsPending(requestContinuity)) {
      hideForContinuityReload();
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
  } catch {
    if (reloadRequested || requestController.signal.aborted) return;
    input.value = clean;
    lastSubmittedText = "";
    showOutput(requestErrorMessage(copy.unexpectedError), "error-output");
  } finally {
    if (activeRequestController === requestController) {
      activeRequestController = null;
    }
    if (!reloadRequested && !requestController.signal.aborted) {
      setPending(false);
      input.focus({ preventScroll: true });
    }
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

if (signOutForm instanceof HTMLFormElement) {
  signOutForm.addEventListener("submit", () => clearPersistedAnswer());
}
if (deleteMemoryForm instanceof HTMLFormElement) {
  deleteMemoryForm.addEventListener("submit", (event) => {
    if (!window.confirm(copy.deleteMemoryConfirm)) {
      event.preventDefault();
      return;
    }
    markDeletionPending();
    hideForContinuityReload();
  });
}

retireStalePersistedAnswers();
if (memoryDeletionConfirmation) {
  clearPersistedAnswer(memoryDeletionConfirmation.deletedContinuity);
  clearDeletionPending(memoryDeletionConfirmation.deletedContinuity);
}
if (deletionIsPending()) {
  hideForContinuityReload();
  showClientNotice(copy.deletionPending, "deletion-pending");
}
startContinuityChannel();
if (memoryDeletionConfirmation) {
  continuityChannel?.postMessage({
    type: "memory-deleted",
    continuity: memoryDeletionConfirmation.deletedContinuity,
  });
}

window.addEventListener("storage", (event) => {
  if (
    continuityState.token === null ||
    event.storageArea !== localStorage ||
    ![
      continuityStorageKey(),
      deletionPendingStorageKey(),
    ].includes(event.key)
  ) {
    return;
  }
  activeRequestController?.abort();
  restoreComposeView();
  hideContinuitySurface();
  void revalidateContinuity();
});

window.addEventListener("blur", hideContinuitySurface);

document.addEventListener("visibilitychange", () => {
  if (continuityState.token === null) return;
  if (document.hidden) {
    hideContinuitySurface();
    return;
  }
  void revalidateContinuity();
});

window.addEventListener("pagehide", () => {
  hideContinuitySurface();
});

window.addEventListener("pageshow", (event) => {
  if (continuityState.token !== null) {
    hideContinuitySurface();
    void revalidateContinuity();
    return;
  }

  continuityChannel?.postMessage({
    type: "state",
    continuity: continuityState,
  });

  const view = conversationSurface.dataset.view || "compose";
  const outputIsMissing = chatLog.hidden || chatLog.childElementCount === 0;
  const interruptedThinkingView = event.persisted && view === "thinking";

  if (interruptedThinkingView || (view !== "compose" && outputIsMissing)) {
    if (!restorePersistedAnswer()) restoreComposeView();
  }
});

window.addEventListener("focus", () => {
  if (continuityState.token === null) return;
  hideContinuitySurface();
  void revalidateContinuity();
});

window.addEventListener("online", () => {
  if (continuityState.token !== null) {
    void revalidateContinuity();
  }
});

if (continuityState.token !== null) {
  hideContinuitySurface();
  void revalidateContinuity();
}

const IMPACT_ENDPOINT = "/api/impact-event";
const CLIENT_LATENCY_ENDPOINT = "/api/client-latency";
const CLIENT_LATENCY_VERSION = "browser-render-v1";
const NEXT_STEP_PROMPT_VERSION = "next-step-v1";
const CONVERSATION_PROMPT_VERSION = "conversation-help-v1";
const BROWSER_KEY = "stabilize:impact-browser:v1";
const SESSION_KEY = "stabilize:impact-session:v1";
const CONVERSATION_KEY = "stabilize:impact-conversation:v1";
const BROWSER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const URGENT_ROUTES = new Set([
  "IMMEDIATE_DANGER",
  "MEDICAL_EMERGENCY",
  "SAFETY_UNCLEAR",
]);
const FOLLOWUP_ACTION_EVENT = "stabilize:followup-actions";
const FOLLOWUP_REPLY_PATTERNS = [
  /\b(message|text|email|reply|apolog(?:y|ize)|boundary|send it)\b/i,
  /\b(decision|decide|choice|choose|compare|option|trade-?off|pros? and cons?)\b/i,
  /\b(work|school|class|assignment|project|deadline|application|internship|meeting)\b/i,
  /\b(money|budget|rent|housing|apartment|cost|debt|bill|financial|afford)\b/i,
  /\b(friend|social|lonely|alone|isolation|reach out|connection|meet people|community)\b/i,
];
const FOLLOWUP_CUE_PATTERN =
  /\b(want me to|would you like|i can (?:help|draft|compare|make|plan)|next step|choose|which|option|draft|compare|plan)\b/i;

const originalFetch = window.fetch.bind(window);
const enhancedTurns = new Set();
const conversationPromptedTurns = new Set();
let latestTurn = null;
let activeConversationCard = null;
let activeLatencyTurn = null;

function randomId() {
  return crypto.randomUUID();
}

function readJsonStorage(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function browserId() {
  const now = Date.now();
  const existing = readJsonStorage(localStorage, BROWSER_KEY);
  if (
    existing &&
    typeof existing.id === "string" &&
    typeof existing.createdAt === "number" &&
    now - existing.createdAt >= 0 &&
    now - existing.createdAt <= BROWSER_MAX_AGE_MS
  ) {
    return existing.id;
  }

  const record = { id: randomId(), createdAt: now };
  try {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(record));
  } catch {
    // Hardened browsers can block storage; a page-local random ID is sufficient.
  }
  return record.id;
}

function sessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = randomId();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return randomId();
  }
}

function conversationId() {
  try {
    const existing = sessionStorage.getItem(CONVERSATION_KEY);
    if (existing) return existing;
    const created = randomId();
    sessionStorage.setItem(CONVERSATION_KEY, created);
    return created;
  } catch {
    return randomId();
  }
}

const impactBrowserId = browserId();
const impactSessionId = sessionId();
let impactConversationId = conversationId();

function rotateConversationId() {
  impactConversationId = randomId();
  try {
    sessionStorage.setItem(CONVERSATION_KEY, impactConversationId);
  } catch {
    // The page-local value still separates future turns after a reset.
  }
}

function sameOriginPathRequest(input, pathname) {
  try {
    const value = input instanceof Request ? input.url : input;
    const url = new URL(String(value), window.location.href);
    return url.origin === window.location.origin && url.pathname === pathname;
  } catch {
    return false;
  }
}

function chatRequest(input) {
  return sameOriginPathRequest(input, "/api/chat");
}

function newConversationRequest(input) {
  return sameOriginPathRequest(input, "/api/conversation/new");
}

function withImpactHeaders(input, init = {}) {
  const headers = new Headers(
    input instanceof Request ? input.headers : init?.headers || {},
  );
  if (init?.headers) {
    for (const [name, value] of new Headers(init.headers)) {
      headers.set(name, value);
    }
  }
  headers.set("X-Stabilize-Session-Id", impactSessionId);
  headers.set("X-Stabilize-Browser-Id", impactBrowserId);
  headers.set("X-Stabilize-Conversation-Id", impactConversationId);

  if (input instanceof Request) {
    return [new Request(input, { ...init, headers }), undefined];
  }
  return [input, { ...init, headers }];
}

function monotonicNow() {
  return typeof performance?.now === "function" ? performance.now() : Date.now();
}

function currentAssistantArticle() {
  const articles = document.querySelectorAll(
    "#chat-log .assistant-output",
  );
  const article = articles.item(articles.length - 1);
  return article instanceof HTMLElement ? article : null;
}

function afterNextPaint(callback) {
  if (typeof window.requestAnimationFrame !== "function") {
    window.setTimeout(callback, 0);
    return;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

function clientLatencyElapsed(measurement) {
  return Math.max(0, Math.round(monotonicNow() - measurement.startedAt));
}

async function postClientLatency(turn) {
  const measurement = turn?.clientLatency;
  if (
    !turn?.turnId ||
    !measurement ||
    !Number.isFinite(measurement.firstVisibleMs) ||
    !Number.isFinite(measurement.completeMs)
  ) {
    return undefined;
  }

  const payload = {
    sessionId: impactSessionId,
    browserId: impactBrowserId,
    turnId: turn.turnId,
    firstVisibleMs: measurement.firstVisibleMs,
    completeMs: measurement.completeMs,
    metricVersion: CLIENT_LATENCY_VERSION,
  };
  const request = () =>
    originalFetch(CLIENT_LATENCY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });

  try {
    for (const delay of [0, 300, 900]) {
      if (delay) {
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
      const response = await request();
      if (response.status !== 409) return response;
    }
  } catch {
    // Client timing is optional and must never interfere with the chat.
  }
  return undefined;
}

function queueClientLatencyPaint(turn, phase) {
  const measurement = turn?.clientLatency;
  if (!measurement || !measurement.eligible || measurement.reported) return;
  const flag = phase === "first" ? "firstPaintQueued" : "completePaintQueued";
  if (measurement[flag]) return;
  measurement[flag] = true;

  afterNextPaint(() => {
    measurement[flag] = false;
    if (
      !measurement.eligible ||
      measurement.reported ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const article = measurement.article;
    if (
      !(article instanceof HTMLElement) ||
      !article.isConnected ||
      article.classList.contains("error-output")
    ) {
      return;
    }

    const elapsed = clientLatencyElapsed(measurement);
    if (phase === "first") {
      if (measurement.firstVisibleMs === null) {
        measurement.firstVisibleMs = elapsed;
      }
      return;
    }

    if (
      article.classList.contains("thinking-output") ||
      article.classList.contains("streaming-output")
    ) {
      return;
    }
    if (measurement.firstVisibleMs === null) {
      measurement.firstVisibleMs = elapsed;
    }
    measurement.completeMs = Math.max(measurement.firstVisibleMs, elapsed);
    measurement.reported = true;
    if (activeLatencyTurn === turn) activeLatencyTurn = null;
    void postClientLatency(turn);
  });
}

function observeClientLatency() {
  const turn = activeLatencyTurn;
  const measurement = turn?.clientLatency;
  if (!measurement || !measurement.eligible || measurement.reported) return;
  const article = measurement.article;
  if (!(article instanceof HTMLElement) || !article.isConnected) return;
  if (article.classList.contains("error-output")) {
    measurement.eligible = false;
    return;
  }

  const text = String(article.textContent || "").trim();
  if (!text) return;
  if (article.classList.contains("streaming-output")) {
    queueClientLatencyPaint(turn, "first");
    return;
  }
  if (
    article.classList.contains("assistant-output") &&
    !article.classList.contains("thinking-output")
  ) {
    queueClientLatencyPaint(turn, "first");
    queueClientLatencyPaint(turn, "complete");
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") return;
  const measurement = activeLatencyTurn?.clientLatency;
  if (measurement) measurement.eligible = false;
});

async function inspectChatResponse(response, turn) {
  let route = "UNKNOWN";
  let text = "";

  try {
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (text.length < 100_000) {
          text += decoder.decode(value, { stream: true });
        }
      }
      reader.releaseLock();
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/x-ndjson")) {
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event?.route) route = String(event.route);
        } catch {
          // The visible chat already handles malformed stream events.
        }
      }
    } else if (contentType.includes("application/json")) {
      try {
        const result = JSON.parse(text || "{}");
        if (result?.route) route = String(result.route);
      } catch {
        // Keep the route unknown; the ordinary prompt remains conservative.
      }
    }
  } finally {
    turn.route = route;
    turn.completed = true;
    queueOutcomeEnhancement();
  }
}

window.fetch = async (input, init) => {
  if (newConversationRequest(input)) {
    const previousTurn = latestTurn;
    const response = await originalFetch(input, init);
    if (response.ok) {
      rotateConversationId();
      setTimeout(() => renderConversationFeedback(previousTurn), 0);
    }
    return response;
  }
  if (!chatRequest(input)) return originalFetch(input, init);

  const latencyMeasurement = {
    startedAt: monotonicNow(),
    article: currentAssistantArticle(),
    eligible: document.visibilityState === "visible",
    firstVisibleMs: null,
    completeMs: null,
    firstPaintQueued: false,
    completePaintQueued: false,
    reported: false,
  };
  const [nextInput, nextInit] = withImpactHeaders(input, init);
  const response = await originalFetch(nextInput, nextInit);
  const turn = {
    turnId: response.headers.get("X-Stabilize-Turn-Id") || randomId(),
    route: "UNKNOWN",
    completed: false,
    clientLatency: latencyMeasurement,
  };
  latestTurn = turn;
  activeLatencyTurn = turn;
  observeClientLatency();
  void inspectChatResponse(response.clone(), turn);
  return response;
};

function modelReplyNeedsFollowups(text, route) {
  const cleanRoute = String(route || "UNKNOWN").trim().toUpperCase();
  if (URGENT_ROUTES.has(cleanRoute)) return false;
  const content = String(text || "").trim();
  if (content.length < 80) return false;
  const hasRelevantDomain = FOLLOWUP_REPLY_PATTERNS.some((pattern) =>
    pattern.test(content),
  );
  return hasRelevantDomain && FOLLOWUP_CUE_PATTERN.test(content);
}

async function postImpactState(turn, event, value, promptVersion) {
  if (!turn?.turnId) return undefined;
  const payload = {
    eventId: randomId(),
    sessionId: impactSessionId,
    browserId: impactBrowserId,
    turnId: turn.turnId,
    event,
    value,
    promptVersion,
  };

  const request = () =>
    originalFetch(IMPACT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });

  try {
    let response = await request();
    // Chat registration is asynchronous. Retry the same idempotent state once
    // if the client reaches the analytics endpoint first.
    if (response.status === 409) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      response = await request();
    }
    return response;
  } catch {
    return undefined;
  }
}

function postNextStep(turn, value) {
  return postImpactState(
    turn,
    "next_step_reported",
    value,
    NEXT_STEP_PROMPT_VERSION,
  );
}

function postConversationHelp(turn, value) {
  return postImpactState(
    turn,
    "conversation_help_reported",
    value,
    CONVERSATION_PROMPT_VERSION,
  );
}

function button(label, value, className = "impact-choice") {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.dataset.value = value;
  return element;
}

function latestAssistantText(check) {
  const article =
    check.closest(".assistant-output") ||
    document.querySelector("#chat-log .assistant-output:last-of-type");
  if (!(article instanceof HTMLElement)) return "";
  const clone = article.cloneNode(true);
  clone
    .querySelectorAll(".outcome-check, .impact-outcome-card")
    .forEach((node) => node.remove());
  return clone.textContent || "";
}

function hideOutcomeCard(card) {
  const tray = card.closest("#outcome-tray");
  if (tray instanceof HTMLElement) {
    tray.replaceChildren();
    tray.hidden = true;
  } else {
    card.remove();
  }
}

function enhanceOutcomeCheck(check) {
  if (
    !(check instanceof HTMLElement) ||
    check.dataset.impactEnhanced === "true"
  ) {
    return;
  }

  const turn = latestTurn;
  if (!turn?.turnId || !turn.completed) return;

  const responseText = latestAssistantText(check);
  const followupButtons = [...check.querySelectorAll("button")]
    .filter((item) => item instanceof HTMLButtonElement)
    .slice(0, 3);
  const shouldSurface =
    !enhancedTurns.has(turn.turnId) &&
    followupButtons.length > 0 &&
    modelReplyNeedsFollowups(responseText, turn.route);

  check.dataset.impactEnhanced = "true";
  hideOutcomeCard(check);
  if (!shouldSurface) return;

  enhancedTurns.add(turn.turnId);
  for (const followupButton of followupButtons) {
    followupButton.addEventListener(
      "click",
      () => {
        void postNextStep(turn, "yes");
      },
      { once: true },
    );
  }

  window.dispatchEvent(
    new CustomEvent(FOLLOWUP_ACTION_EVENT, {
      detail: {
        turnId: turn.turnId,
        buttons: followupButtons,
      },
    }),
  );
  void postNextStep(turn, "shown");
}

function removeConversationCard(card = activeConversationCard) {
  if (!(card instanceof HTMLElement)) return;
  if (card === activeConversationCard) activeConversationCard = null;
  card.remove();
}

function renderConversationFeedback(turn) {
  if (
    !turn?.turnId ||
    !turn.completed ||
    conversationPromptedTurns.has(turn.turnId) ||
    URGENT_ROUTES.has(turn.route)
  ) {
    return;
  }
  conversationPromptedTurns.add(turn.turnId);
  removeConversationCard();

  const card = document.createElement("section");
  card.className = "impact-conversation-card";
  card.setAttribute("aria-label", "Conversation feedback");
  card.setAttribute("aria-live", "polite");

  const question = document.createElement("p");
  question.className = "impact-conversation-question";
  question.textContent = "Did this conversation help you move forward?";

  const actions = document.createElement("div");
  actions.className = "impact-actions impact-conversation-actions";
  for (const [label, value] of [
    ["Yes", "yes"],
    ["Partly", "partly"],
    ["No", "no"],
  ]) {
    const choice = button(label, value);
    choice.addEventListener("click", () => {
      for (const sibling of actions.querySelectorAll("button")) {
        sibling.disabled = true;
      }
      void postConversationHelp(turn, value);
      card.replaceChildren();
      const thanks = document.createElement("p");
      thanks.className = "impact-thanks";
      thanks.textContent = "Thanks — conversation feedback saved.";
      card.appendChild(thanks);
      setTimeout(() => removeConversationCard(card), 1_200);
    });
    actions.appendChild(choice);
  }

  const note = document.createElement("p");
  note.className = "impact-privacy-note";
  note.textContent = "Optional and separate from your new conversation.";

  const dismiss = button("Skip", "skip", "impact-skip");
  dismiss.setAttribute("aria-label", "Dismiss conversation feedback");
  dismiss.addEventListener("click", () => removeConversationCard(card));

  card.append(question, actions, note, dismiss);
  document.body.appendChild(card);
  activeConversationCard = card;
  void postConversationHelp(turn, "shown");
}

function queueOutcomeEnhancement() {
  queueMicrotask(() => {
    const candidates = document.querySelectorAll(
      "#outcome-tray .outcome-check:not([data-impact-enhanced]), .assistant-output .outcome-check:not([data-impact-enhanced])",
    );
    for (const check of candidates) enhanceOutcomeCheck(check);
  });
}

function observeImpactChanges() {
  observeClientLatency();
  queueOutcomeEnhancement();
}

const observer = new MutationObserver(observeImpactChanges);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["hidden", "class"],
});
observeImpactChanges();

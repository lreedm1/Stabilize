const IMPACT_ENDPOINT = "/api/impact-event";
const PROMPT_VERSION = "outcome-v1";
const BROWSER_KEY = "stabilize:impact-browser:v1";
const SESSION_KEY = "stabilize:impact-session:v1";
const SAMPLE_KEY = "stabilize:impact-proportionality:v1";
const BROWSER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const SAMPLE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000;
const originalFetch = window.fetch.bind(window);
const enhancedTurns = new Set();
let latestTurn = null;

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

const impactBrowserId = browserId();
const impactSessionId = sessionId();

function chatRequest(input) {
  try {
    const value = input instanceof Request ? input.url : input;
    const url = new URL(String(value), window.location.href);
    return url.origin === window.location.origin && url.pathname === "/api/chat";
  } catch {
    return false;
  }
}

function withImpactHeaders(input, init = {}) {
  const headers = new Headers(
    input instanceof Request ? input.headers : init?.headers || {},
  );
  if (init?.headers) {
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  }
  headers.set("X-Stabilize-Session-Id", impactSessionId);
  headers.set("X-Stabilize-Browser-Id", impactBrowserId);

  if (input instanceof Request) {
    return [new Request(input, { ...init, headers }), undefined];
  }
  return [input, { ...init, headers }];
}

async function inspectChatResponse(response, turn) {
  let firstTokenMs = 0;
  let totalResponseMs = 0;
  let value = response.ok ? "completed" : "error";
  let route = "UNKNOWN";
  let text = "";

  try {
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sawChunk = false;
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        if (!sawChunk) {
          firstTokenMs = Math.max(0, Math.round(performance.now() - turn.startedAt));
          sawChunk = true;
        }
        if (text.length < 100_000) text += decoder.decode(chunk, { stream: true });
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
          if (event?.type === "error") value = "error";
        } catch {
          value = "error";
        }
      }
    } else if (contentType.includes("application/json")) {
      try {
        const result = JSON.parse(text || "{}");
        if (result?.route) route = String(result.route);
        if (result?.error) value = "error";
      } catch {
        value = "error";
      }
    }
  } catch {
    value = "error";
  } finally {
    totalResponseMs = Math.max(0, Math.round(performance.now() - turn.startedAt));
    turn.route = route;
    turn.completed = true;
    turn.firstTokenMs = firstTokenMs;
    turn.totalResponseMs = totalResponseMs;
    void postImpactEvent("response_completed", {
      turn,
      value,
      responseType: "unknown",
      firstTokenMs,
      totalResponseMs,
    });
    queueOutcomeEnhancement();
  }
}

window.fetch = async (input, init) => {
  if (!chatRequest(input)) return originalFetch(input, init);

  const startedAt = performance.now();
  const [nextInput, nextInit] = withImpactHeaders(input, init);
  const response = await originalFetch(nextInput, nextInit);
  const turnId = response.headers.get("X-Stabilize-Turn-Id") || randomId();
  const turn = {
    turnId,
    startedAt,
    route: "UNKNOWN",
    completed: false,
    firstTokenMs: 0,
    totalResponseMs: 0,
  };
  latestTurn = turn;
  void inspectChatResponse(response.clone(), turn);
  return response;
};

function responseTypeFor(text) {
  const content = String(text || "");
  if (/\b(draft|rewrite|message|reply|email|letter)\b/i.test(content)) {
    return "writing";
  }
  if (/\b(call|contact|hotline|staff|clinician|pharmacist|office)\b/i.test(content)) {
    return "handoff";
  }
  if (/\b(decide|decision|choice|compare|option|trade-?off)\b/i.test(content)) {
    return "decision";
  }
  if (/\b(plan|step|today|tomorrow|next hour|start|schedule|task)\b/i.test(content)) {
    return "planning";
  }
  if (/\b(feel|overwhelmed|lonely|angry|sad|anxious|stabiliz)\b/i.test(content)) {
    return "support";
  }
  return "information";
}

function potentiallyResolving(text) {
  const content = String(text || "").trim();
  if (content.length < 10) return false;
  if (/^(?:hi|hello|hey)[.!]?\s/i.test(content) && content.length < 140) {
    return false;
  }
  if (content.length < 180 && /[?]\s*$/.test(content)) return false;
  return true;
}

function outcomeQuestion(responseType) {
  if (["planning", "decision", "support"].includes(responseType)) {
    return "Is your next step clearer?";
  }
  if (responseType === "handoff") return "Do you know what you’ll do next?";
  return "Did this answer what you needed?";
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "another_option";
}

async function postImpactEvent(event, options = {}) {
  const turn = options.turn || latestTurn;
  if (!turn?.turnId) return;
  const payload = {
    eventId: randomId(),
    sessionId: impactSessionId,
    browserId: impactBrowserId,
    turnId: turn.turnId,
    event,
    value: String(options.value || ""),
    responseType: String(options.responseType || "unknown"),
    promptVersion: PROMPT_VERSION,
    firstTokenMs: Number(options.firstTokenMs || 0),
    totalResponseMs: Number(options.totalResponseMs || 0),
  };

  const request = () => originalFetch(IMPACT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  });

  try {
    let response = await request();
    // The chat record is written asynchronously so response delivery stays fast.
    // Retry the same idempotent event once if it arrives first.
    if (response.status === 409) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      response = await request();
    }
    return response;
  } catch {
    return undefined;
  }
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
  const article = check.closest(".assistant-output") ||
    document.querySelector("#chat-log .assistant-output:last-of-type");
  if (!(article instanceof HTMLElement)) return "";
  const clone = article.cloneNode(true);
  clone.querySelectorAll(".outcome-check, .impact-outcome-card").forEach((node) => node.remove());
  return clone.textContent || "";
}

function shouldSampleProportionality() {
  const now = Date.now();
  try {
    const last = Number(localStorage.getItem(SAMPLE_KEY) || 0);
    if (Number.isFinite(last) && now - last < SAMPLE_COOLDOWN_MS) return false;
    if (Math.random() >= 0.1) return false;
    localStorage.setItem(SAMPLE_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

function finishCard(card, continuationButtons, responseType, turn) {
  card.replaceChildren();
  const message = document.createElement("p");
  message.className = "impact-thanks";
  message.textContent = "Thanks — that helps improve Stabilize.";
  card.appendChild(message);

  if (continuationButtons.length) {
    const keepGoing = button("Keep going", "keep_going", "impact-secondary");
    keepGoing.addEventListener("click", () => {
      renderRevisionChoices(card, continuationButtons, responseType, turn);
    });
    card.appendChild(keepGoing);
  }
}

function renderProportionality(card, continuationButtons, responseType, turn) {
  card.replaceChildren();
  const question = document.createElement("p");
  question.className = "impact-question";
  question.textContent = "Did Stabilize respond at the right level?";
  const actions = document.createElement("div");
  actions.className = "impact-actions";
  const choices = [
    ["Too intense", "too_intense"],
    ["About right", "about_right"],
    ["Not enough", "not_enough"],
  ];
  for (const [label, value] of choices) {
    const choice = button(label, value);
    choice.addEventListener("click", () => {
      void postImpactEvent("proportionality_answered", {
        turn,
        value,
        responseType,
      });
      finishCard(card, continuationButtons, responseType, turn);
    });
    actions.appendChild(choice);
  }
  card.append(question, actions);
}

function renderRevisionChoices(card, continuationButtons, responseType, turn) {
  card.replaceChildren();
  const question = document.createElement("p");
  question.className = "impact-question";
  question.textContent = "What would help most now?";
  const actions = document.createElement("div");
  actions.className = "impact-actions impact-revision-actions";

  for (const originalButton of continuationButtons) {
    originalButton.classList.add("impact-choice", "impact-revision-choice");
    originalButton.addEventListener(
      "click",
      () => {
        void postImpactEvent("revision_requested", {
          turn,
          value: slug(originalButton.textContent),
          responseType,
        });
      },
      { once: true, capture: true },
    );
    actions.appendChild(originalButton);
  }

  const done = button("I’m done for now", "done", "impact-secondary");
  done.addEventListener("click", () => {
    void postImpactEvent("session_ended", {
      turn,
      value: "done",
      responseType,
    });
    const tray = card.closest("#outcome-tray");
    if (tray instanceof HTMLElement) {
      tray.replaceChildren();
      tray.hidden = true;
    } else {
      card.remove();
    }
  });

  card.append(question, actions, done);
}

function renderOutcomeTypes(card, continuationButtons, responseType, turn) {
  card.replaceChildren();
  const question = document.createElement("p");
  question.className = "impact-question";
  question.textContent = "What are you leaving with?";
  const actions = document.createElement("div");
  actions.className = "impact-actions impact-outcome-types";
  const choices = [
    ["The answer I needed", "answer"],
    ["Something I can do", "action"],
    ["Someone I can contact", "contact"],
    ["A decision to pause", "pause"],
    ["Useful information, but no resolution yet", "information_only"],
  ];

  for (const [label, value] of choices) {
    const choice = button(label, value);
    choice.addEventListener("click", () => {
      void postImpactEvent("outcome_selected", {
        turn,
        value,
        responseType,
      });
      if (value === "information_only") {
        renderRevisionChoices(card, continuationButtons, responseType, turn);
      } else if (shouldSampleProportionality()) {
        renderProportionality(card, continuationButtons, responseType, turn);
      } else {
        finishCard(card, continuationButtons, responseType, turn);
      }
    });
    actions.appendChild(choice);
  }
  card.append(question, actions);
}

function enhanceOutcomeCheck(check) {
  if (!(check instanceof HTMLElement) || check.dataset.impactEnhanced === "true") return;
  const turn = latestTurn;
  if (!turn?.turnId || enhancedTurns.has(turn.turnId)) return;

  const responseText = latestAssistantText(check);
  if (!potentiallyResolving(responseText)) return;
  const responseType = responseTypeFor(responseText);
  const continuationButtons = [...check.querySelectorAll("button")].slice(0, 3);
  if (!continuationButtons.length) return;

  check.dataset.impactEnhanced = "true";
  check.classList.add("impact-outcome-card");
  check.setAttribute("aria-label", outcomeQuestion(responseType));
  enhancedTurns.add(turn.turnId);

  const question = document.createElement("p");
  question.className = "impact-question";
  question.textContent = outcomeQuestion(responseType);
  const actions = document.createElement("div");
  actions.className = "impact-actions impact-clarity-actions";
  const answers = [
    ["Yes", "yes"],
    ["Partly", "partly"],
    ["No", "no"],
  ];

  for (const [label, value] of answers) {
    const choice = button(label, value);
    choice.addEventListener("click", () => {
      void postImpactEvent("clarity_answered", {
        turn,
        value,
        responseType,
      });
      if (value === "no") {
        renderRevisionChoices(check, continuationButtons, responseType, turn);
      } else {
        renderOutcomeTypes(check, continuationButtons, responseType, turn);
      }
    });
    actions.appendChild(choice);
  }

  const privacy = document.createElement("p");
  privacy.className = "impact-privacy-note";
  privacy.append("Structured feedback only — message text isn’t recorded. ");
  const privacyLink = document.createElement("a");
  privacyLink.href = "/privacy.html#outcome-measurement";
  privacyLink.textContent = "Privacy details";
  privacy.appendChild(privacyLink);

  const dismiss = button("Skip", "skip", "impact-skip");
  dismiss.setAttribute("aria-label", "Dismiss outcome question");
  dismiss.addEventListener("click", () => {
    const tray = check.closest("#outcome-tray");
    if (tray instanceof HTMLElement) {
      tray.replaceChildren();
      tray.hidden = true;
    } else {
      check.remove();
    }
  });

  check.replaceChildren(question, actions, privacy, dismiss);
  void postImpactEvent("outcome_prompt_shown", {
    turn,
    value: "",
    responseType,
  });
}

function queueOutcomeEnhancement() {
  queueMicrotask(() => {
    const candidates = document.querySelectorAll(
      "#outcome-tray .outcome-check:not([data-impact-enhanced]), .assistant-output .outcome-check:not([data-impact-enhanced])",
    );
    for (const check of candidates) enhanceOutcomeCheck(check);
  });
}

const observer = new MutationObserver(queueOutcomeEnhancement);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["hidden"],
});
queueOutcomeEnhancement();

const billingForms = document.querySelectorAll("form[data-billing-redirect]");
const composerModelPickers = document.querySelectorAll(
  "details.composer-model-picker",
);

function allowedStripeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      url.protocol === "https:" &&
      ["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function billingStatus(form) {
  const container = form.closest(".billing-menu, .composer-model-panel");
  if (!(container instanceof HTMLElement)) return null;

  let status = container.querySelector(".billing-action-status");
  if (!(status instanceof HTMLElement)) {
    status = document.createElement("p");
    status.className = "billing-action-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    container.appendChild(status);
  }
  return status;
}

function setStatus(form, message) {
  const status = billingStatus(form);
  if (!(status instanceof HTMLElement)) return;
  status.textContent = String(message || "");
  status.hidden = !status.textContent;
}

for (const form of billingForms) {
  if (!(form instanceof HTMLFormElement)) continue;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.billingPending === "true") return;

    const button = form.querySelector('button[type="submit"]');
    const originalLabel = button?.textContent || "";
    form.dataset.billingPending = "true";
    form.setAttribute("aria-busy", "true");
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      button.textContent =
        form.dataset.billingRedirect === "portal"
          ? "Opening billing…"
          : "Opening secure checkout…";
    }
    setStatus(form, "Connecting to Stripe…");

    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams(new FormData(form)),
        credentials: "same-origin",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(result.error || "Billing could not open."));
      }
      if (!allowedStripeUrl(result.url)) {
        throw new Error("Stripe did not return a valid secure link.");
      }

      setStatus(form, "Opening Stripe…");
      window.location.assign(result.url);
    } catch (error) {
      setStatus(
        form,
        error instanceof Error
          ? error.message
          : "Billing could not open. Try again.",
      );
      form.dataset.billingPending = "false";
      form.removeAttribute("aria-busy");
      if (button instanceof HTMLButtonElement) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  });
}

function closePicker(picker, { restoreFocus = false } = {}) {
  if (!(picker instanceof HTMLDetailsElement) || !picker.open) return;
  picker.open = false;
  if (!restoreFocus) return;
  const summary = picker.querySelector("summary");
  if (summary instanceof HTMLElement) summary.focus();
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  for (const picker of composerModelPickers) {
    if (picker instanceof HTMLDetailsElement && !picker.contains(target)) {
      closePicker(picker);
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const picker of composerModelPickers) {
    if (picker instanceof HTMLDetailsElement && picker.open) {
      event.preventDefault();
      closePicker(picker, { restoreFocus: true });
      break;
    }
  }
});


const stabilizeNativeFetch = globalThis.fetch.bind(globalThis);

function chatRequestPath(input) {
  try {
    const value =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input || "");
    return new URL(value, window.location.href).pathname;
  } catch {
    return "";
  }
}

function modelUsageFromResponse(response) {
  const tier = String(
    response.headers.get("X-Stabilize-Model-Usage-Tier") || "",
  ).toLowerCase();
  const used = Number(response.headers.get("X-Stabilize-Model-Usage-Used"));
  const limit = Number(response.headers.get("X-Stabilize-Model-Usage-Limit"));
  const period = String(
    response.headers.get("X-Stabilize-Model-Usage-Period") || "",
  );
  const selectedModel = String(
    response.headers.get("X-Stabilize-Model-Selected") || "",
  );
  const periodIsValid =
    tier === "free"
      ? /^\d{4}-\d{2}-\d{2}$/.test(period)
      : tier === "paid" && /^\d{4}-\d{2}$/.test(period);

  if (
    !periodIsValid ||
    !Number.isSafeInteger(used) ||
    used < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    used > limit
  ) {
    return null;
  }
  return { tier, used, limit, period, selectedModel };
}

function modelUsageCopy(usage) {
  return usage.tier === "paid"
    ? usage.used +
        " of " +
        usage.limit +
        " subscriber model messages used this UTC month. The default model does not count."
    : usage.used +
        " of " +
        usage.limit +
        " free GPT-5.6 Fast messages used today. GPT-5.4 takes over after this allowance. The allowance resets at 00:00 UTC.";
}

function updateSelectedModelDisplay(model) {
  const value = String(model || "");
  if (!value) return;
  const label = value === "gpt-5.6-sol"
    ? "5.6"
    : value === "gpt-5.4"
      ? "5.4"
      : compactModelTileLabel(value);
  for (const current of document.querySelectorAll(".composer-model-current")) {
    if (current instanceof HTMLElement) current.textContent = label;
  }
}

function updateModelUsageDisplay(usage) {
  const message = modelUsageCopy(usage);
  for (const node of document.querySelectorAll(
    '[data-model-usage="true"], .billing-usage',
  )) {
    if (!(node instanceof HTMLElement)) continue;
    node.textContent = message;
    node.dataset.modelUsage = "true";
    node.dataset.modelUsageTier = usage.tier;
    node.dataset.modelUsageUsed = String(usage.used);
    node.dataset.modelUsageLimit = String(usage.limit);
    node.dataset.modelUsagePeriod = usage.period;
  }
  if (usage.tier === "free" && usage.selectedModel) {
    const label = usage.selectedModel === "gpt-5.6-sol"
      ? "5.6"
      : usage.selectedModel === "gpt-5.4"
        ? "5.4"
        : "Model";
    for (const current of document.querySelectorAll(
      ".composer-model-current",
    )) {
      if (current instanceof HTMLElement) current.textContent = label;
    }
  }
}

globalThis.fetch = async (...args) => {
  const response = await stabilizeNativeFetch(...args);
  if (chatRequestPath(args[0]) === "/api/chat") {
    const usage = modelUsageFromResponse(response);
    if (usage) updateModelUsageDisplay(usage);
  }
  return response;
};


function compactModelTileLabel(model) {
  const value = String(model || "").toLowerCase();
  if (value === "gpt-5-mini") return "5 mini";
  const match = value.match(/^gpt-(\d+(?:\.\d+)?)/);
  return match?.[1] || "5.x";
}

function showModelFallbackNotice(defaultModel, limit = 50) {
  let notice = document.querySelector('[data-model-fallback-notice="true"]');
  if (!(notice instanceof HTMLElement)) {
    notice = document.createElement("p");
    notice.className = "model-fallback-notice";
    notice.dataset.modelFallbackNotice = "true";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    const composer = document.querySelector(".composer-dock");
    if (composer?.parentNode) composer.parentNode.insertBefore(notice, composer);
    else document.body.append(notice);
  }
  notice.textContent =
    "You used today’s " +
    limit +
    " GPT-5.6 Fast messages. Stabilize used GPT-5.4 for this message; it was still sent.";
  for (const select of document.querySelectorAll(
    '#model-choice, #composer-model-choice',
  )) {
    if (select instanceof HTMLSelectElement) select.value = defaultModel;
  }
  for (const current of document.querySelectorAll(".composer-model-current")) {
    if (current instanceof HTMLElement) {
      current.textContent = compactModelTileLabel(defaultModel);
    }
  }
}

const stabilizeModelFallbackFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (...args) => {
  const response = await stabilizeModelFallbackFetch(...args);
  if (
    chatRequestPath(args[0]) === "/api/chat" &&
    response.headers.get("X-Stabilize-Model-Fallback") === "daily-limit"
  ) {
    showModelFallbackNotice(
      response.headers.get("X-Stabilize-Model-Selected") || "gpt-5.4",
      Number(response.headers.get("X-Stabilize-Model-Usage-Limit")) ||
        50,
    );
  }
  return response;
};

/* Composer chat sections */
function composerQuickStatus(button, message) {
  const panel = button.closest(".composer-quick-panel");
  const status = panel?.querySelector("[data-composer-quick-status]");
  if (!(status instanceof HTMLElement)) return;
  status.textContent = String(message || "");
  status.hidden = !status.textContent;
}

function composerControl(selector) {
  const control = document.querySelector(selector);
  return control instanceof HTMLButtonElement ? control : null;
}

function closeComposerQuickMenu(button) {
  const picker = button.closest("details.composer-model-picker");
  if (picker instanceof HTMLDetailsElement) closePicker(picker);
}

function controlsAreBusy(button, controls) {
  if (!controls.some((control) => control?.disabled)) return false;
  composerQuickStatus(button, "Wait for the current response to finish.");
  return true;
}

function startComposerNewChat(button) {
  const newConversation = composerControl("#new-conversation-button");
  const privateChat = composerControl("#private-chat-button");
  if (!newConversation) {
    composerQuickStatus(button, "New chat is temporarily unavailable.");
    return;
  }
  if (controlsAreBusy(button, [newConversation, privateChat])) return;

  closeComposerQuickMenu(button);
  if (privateChat?.getAttribute("aria-pressed") === "true") {
    privateChat.click();
  }
  newConversation.click();
}

function startComposerPrivateChat(button) {
  const newConversation = composerControl("#new-conversation-button");
  const privateChat = composerControl("#private-chat-button");
  if (!newConversation) {
    composerQuickStatus(button, "New private chat is temporarily unavailable.");
    return;
  }
  if (controlsAreBusy(button, [newConversation, privateChat])) return;

  closeComposerQuickMenu(button);
  if (
    privateChat &&
    privateChat.getAttribute("aria-pressed") !== "true"
  ) {
    privateChat.click();
    return;
  }
  newConversation.click();
}

for (const button of document.querySelectorAll("[data-composer-new-chat]")) {
  if (!(button instanceof HTMLButtonElement)) continue;
  button.addEventListener("click", () => startComposerNewChat(button));
}

for (const button of document.querySelectorAll(
  "[data-composer-new-private-chat]",
)) {
  if (!(button instanceof HTMLButtonElement)) continue;
  button.addEventListener("click", () => startComposerPrivateChat(button));
}

/* Signed-in account-context prefetch */
const accountContextSignedIn =
  document.documentElement.dataset.signedIn === "true";
const ACCOUNT_CONTEXT_TOKEN_PATTERN =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ACCOUNT_CONTEXT_MAX_TOKEN_CHARS = 16_384;
const ACCOUNT_CONTEXT_MAX_MESSAGES = 8;
const ACCOUNT_CONTEXT_MAX_MESSAGE_CHARS = 1_600;
const accountContextFetch = globalThis.fetch.bind(globalThis);
let accountContextToken = "";
let accountContextExpiresAt = 0;
let accountContextGeneration = 0;
let accountContextTurnCount = 0;
let accountContextPendingTurns = 0;
let accountContextMinimumTurnCount = 0;
let accountContextDeltas = [];
let accountContextRefreshPromise = null;
let accountBillingPreflight = null;
let accountContextRefreshTimer = 0;

function resetAccountContextClient() {
  accountContextToken = "";
  accountContextExpiresAt = 0;
  accountContextGeneration = 0;
  accountContextTurnCount = 0;
  accountContextPendingTurns = 0;
  accountContextMinimumTurnCount = 0;
  accountContextDeltas = [];
  accountBillingPreflight = null;
  if (accountContextRefreshTimer) {
    clearTimeout(accountContextRefreshTimer);
    accountContextRefreshTimer = 0;
  }
  delete document.documentElement.dataset.accountPreflight;
  delete document.documentElement.dataset.subscriptionActive;
}

function normalizeAccountBillingPreflight(value) {
  if (!value || typeof value !== "object") return null;
  const model = String(value.model || "").trim().slice(0, 128);
  const tier = value.tier === null ? null : String(value.tier || "").trim();
  const used = Math.max(0, Number(value.used) || 0);
  const limit = Math.max(0, Number(value.limit) || 0);
  const remaining = value.remaining === null
    ? null
    : Math.max(0, Number(value.remaining) || 0);
  const subscriptionStatus = String(value.subscriptionStatus || "none")
    .trim()
    .slice(0, 32);
  if (!model || ![null, "free", "paid"].includes(tier)) return null;
  return {
    allowed: value.allowed === true,
    reason: value.reason === null ? null : String(value.reason || "").slice(0, 32),
    model,
    tier,
    used,
    limit,
    remaining,
    fallback: value.fallback === true,
    paid: value.paid === true,
    subscriptionStatus,
  };
}

function accountBillingUsageCopy(preflight) {
  if (!preflight) return "";
  if (preflight.paid && preflight.tier === null) {
    return "Subscription active. GPT-5.4 does not use the subscriber message allowance.";
  }
  if (preflight.paid) {
    return (
      preflight.used +
      " of " +
      preflight.limit +
      " subscriber model messages used this UTC month. GPT-5.4 does not count."
    );
  }
  return (
    preflight.used +
    " of " +
    preflight.limit +
    " free GPT-5.6 Fast messages used today. GPT-5.4 takes over after this allowance. The allowance resets at 00:00 UTC."
  );
}

function installAccountBillingPreflight(preflight) {
  if (!preflight) return;
  accountBillingPreflight = preflight;
  document.documentElement.dataset.accountPreflight = "ready";
  document.documentElement.dataset.subscriptionActive = String(
    preflight.paid,
  );
  const copy = accountBillingUsageCopy(preflight);
  if (!copy) return;
  for (const node of document.querySelectorAll('[data-model-usage="true"]')) {
    node.textContent = copy;
  }
}

function scheduleAccountContextRefresh() {
  if (!accountContextSignedIn || !accountContextExpiresAt) return;
  if (accountContextRefreshTimer) clearTimeout(accountContextRefreshTimer);
  const refreshAt = accountContextExpiresAt - 60_000;
  const delay = Math.max(5_000, refreshAt - Date.now());
  accountContextRefreshTimer = setTimeout(() => {
    accountContextRefreshTimer = 0;
    void refreshAccountContext();
  }, delay);
}

function refreshAccountPreflightIfNeeded() {
  if (!accountContextSignedIn) return;
  if (
    !currentAccountContextToken() ||
    Date.now() + 60_000 >= accountContextExpiresAt
  ) {
    void refreshAccountContext();
  }
}

function normalizeAccountContextDeltas(messages) {
  if (!Array.isArray(messages)) return [];
  const cleaned = messages
    .filter(
      (message) =>
        message && ["user", "assistant"].includes(message.role),
    )
    .map((message) => ({
      role: message.role,
      content: String(message.content || "")
        .trim()
        .slice(0, ACCOUNT_CONTEXT_MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.content)
    .slice(-ACCOUNT_CONTEXT_MAX_MESSAGES);

  const alternating = [];
  for (const message of cleaned) {
    const previous = alternating.at(-1);
    if (previous?.role === message.role) {
      previous.content = (previous.content + "\n" + message.content).slice(
        0,
        ACCOUNT_CONTEXT_MAX_MESSAGE_CHARS,
      );
    } else {
      alternating.push({ ...message });
    }
  }
  return alternating.slice(-ACCOUNT_CONTEXT_MAX_MESSAGES);
}

function appendAccountContextDelta(role, content) {
  accountContextDeltas = normalizeAccountContextDeltas([
    ...accountContextDeltas,
    { role, content },
  ]);
}

function currentAccountContextToken() {
  if (
    !accountContextSignedIn ||
    !accountContextToken ||
    Date.now() + 5_000 >= accountContextExpiresAt
  ) {
    return "";
  }
  return accountContextToken;
}

async function refreshAccountContext(minimumTurnCount = 0) {
  if (!accountContextSignedIn) return null;
  const minimum = Number(minimumTurnCount);
  if (Number.isSafeInteger(minimum) && minimum >= 0) {
    accountContextMinimumTurnCount = Math.max(
      accountContextMinimumTurnCount,
      minimum,
    );
  }
  if (accountContextRefreshPromise) return accountContextRefreshPromise;

  accountContextRefreshPromise = (async () => {
    try {
      const response = await accountContextFetch("/api/account/context", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!response.ok) return null;
      const result = await response.json().catch(() => ({}));
      const token = String(result?.token || "");
      const expiresInSeconds = Number(result?.expiresInSeconds);
      const generation = Number(result?.generation);
      const turnCount = Number(result?.turnCount);
      const billingPreflight = normalizeAccountBillingPreflight(
        result?.billing,
      );
      if (
        token.length < 80 ||
        token.length > ACCOUNT_CONTEXT_MAX_TOKEN_CHARS ||
        !ACCOUNT_CONTEXT_TOKEN_PATTERN.test(token) ||
        !Number.isFinite(expiresInSeconds) ||
        expiresInSeconds < 60 ||
        expiresInSeconds > 3_600 ||
        !Number.isSafeInteger(generation) ||
        generation < 0 ||
        !Number.isSafeInteger(turnCount) ||
        turnCount < 0
      ) {
        return null;
      }

      const generationChanged =
        Boolean(accountContextToken) &&
        generation !== accountContextGeneration;
      if (generationChanged) {
        accountContextDeltas = [];
        accountContextPendingTurns = 0;
        accountContextMinimumTurnCount = 0;
      }
      accountContextToken = token;
      accountContextExpiresAt = Date.now() + expiresInSeconds * 1_000;
      accountContextGeneration = generation;
      accountContextTurnCount = turnCount;
      installAccountBillingPreflight(billingPreflight);
      scheduleAccountContextRefresh();
      if (
        turnCount >= accountContextMinimumTurnCount &&
        !generationChanged
      ) {
        accountContextDeltas = [];
        accountContextPendingTurns = 0;
        accountContextMinimumTurnCount = turnCount;
      }
      return result;
    } catch {
      return null;
    } finally {
      accountContextRefreshPromise = null;
    }
  })();
  return accountContextRefreshPromise;
}

function absoluteRequestUrl(input) {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return new URL(String(input || ""), window.location.href).href;
}

async function requestBodyObject(input, init) {
  try {
    if (input instanceof Request) return await input.clone().json();
    if (typeof init?.body === "string") return JSON.parse(init.body);
    const request = new Request(absoluteRequestUrl(input), init);
    return await request.clone().json();
  } catch {
    return null;
  }
}

async function requestWithAccountContext(input, init) {
  const request = input instanceof Request
    ? input.clone()
    : new Request(absoluteRequestUrl(input), init);
  const body = await request.clone().json().catch(() => null);
  if (!body || body.privateChat === true) {
    return { request, message: "", privateChat: body?.privateChat === true };
  }

  const token = currentAccountContextToken();
  if (token) {
    body.accountContextToken = token;
    const existing = Array.isArray(body.messages) ? body.messages : [];
    body.messages = normalizeAccountContextDeltas([
      ...existing,
      ...accountContextDeltas,
    ]);
  } else {
    delete body.accountContextToken;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return {
    request: new Request(request, {
      headers,
      body: JSON.stringify(body),
    }),
    message: String(body.message || "").trim(),
    privateChat: false,
  };
}

async function replyFromAccountContextResponse(response) {
  if (!response.ok) return "";
  const contentType = String(response.headers.get("content-type") || "")
    .toLowerCase();
  if (contentType.includes("application/json")) {
    const result = await response.json().catch(() => ({}));
    return String(result?.reply || "").trim();
  }
  if (!contentType.includes("application/x-ndjson")) return "";

  const text = await response.text().catch(() => "");
  let reply = "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "done" && typeof event.reply === "string") {
        reply = event.reply.trim();
      }
    } catch {
      // A malformed observer line does not affect the visible response.
    }
  }
  return reply;
}

async function observeAccountContextResponse(response, message) {
  const reply = await replyFromAccountContextResponse(response);
  if (!message || !reply) return;
  appendAccountContextDelta("user", message);
  appendAccountContextDelta("assistant", reply);
  accountContextPendingTurns += 1;
  const minimumTurnCount =
    accountContextTurnCount + accountContextPendingTurns;
  await refreshAccountContext(minimumTurnCount);
}

const accountContextWrappedFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const path = chatRequestPath(input);
  if (accountContextSignedIn && path === "/api/chat") {
    const prepared = await requestWithAccountContext(input, init);
    const response = await accountContextWrappedFetch(prepared.request);
    if (!prepared.privateChat) {
      try {
        const observer = response.clone();
        void observeAccountContextResponse(observer, prepared.message);
      } catch {
        // The visible response remains usable if observation is unavailable.
      }
    }
    return response;
  }

  const controlBody =
    accountContextSignedIn && path === "/api/conversation/new"
      ? await requestBodyObject(input, init)
      : null;
  const response = await accountContextWrappedFetch(input, init);
  if (
    accountContextSignedIn &&
    response.ok &&
    (path === "/api/account/memory" ||
      (path === "/api/conversation/new" && controlBody?.privateChat !== true))
  ) {
    resetAccountContextClient();
    void refreshAccountContext();
  }
  return response;
};

if (accountContextSignedIn) {
  void refreshAccountContext();
  window.addEventListener("focus", refreshAccountPreflightIfNeeded);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAccountPreflightIfNeeded();
  });
  const messageInput = document.querySelector("#message-input");
  if (messageInput instanceof HTMLTextAreaElement) {
    messageInput.addEventListener("focus", refreshAccountPreflightIfNeeded);
    messageInput.addEventListener("input", refreshAccountPreflightIfNeeded);
  }
}

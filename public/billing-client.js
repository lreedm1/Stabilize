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
        " free GPT-5.6 Adaptive messages used today. GPT-5.4 takes over after this allowance. The allowance resets at 00:00 UTC.";
}

function updateSelectedModelDisplay(model) {
  const value = String(model || "");
  if (!value) return;
  const label = ["gpt-5.6-luna", "gpt-5.6-sol"].includes(value)
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
    const label = ["gpt-5.6-luna", "gpt-5.6-sol"].includes(usage.selectedModel)
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
    " GPT-5.6 Adaptive messages. Stabilize used GPT-5.4 for this message; it was still sent.";
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

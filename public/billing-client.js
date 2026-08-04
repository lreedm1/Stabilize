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

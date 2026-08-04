const enabledControl = document.querySelector("#memory-enabled");
const statusHeading = document.querySelector("#memory-status-heading");
const statusDetail = document.querySelector("#memory-status-detail");
const notice = document.querySelector("#memory-notice");
const summaryInput = document.querySelector("#memory-summary");
const saveSummaryButton = document.querySelector("#save-memory-summary");
const recentList = document.querySelector("#recent-memory-list");
const clearRecentButton = document.querySelector("#clear-recent-memory");
const deleteAllButton = document.querySelector("#delete-all-memory");
const updatedLabel = document.querySelector("#memory-updated");

let settings = null;
let pending = false;

function setNotice(message, tone = "") {
  if (!(notice instanceof HTMLElement)) return;
  notice.textContent = String(message || "");
  notice.dataset.tone = tone;
}

function setPending(value) {
  pending = value;
  const controls = [
    enabledControl,
    summaryInput,
    saveSummaryButton,
    clearRecentButton,
    deleteAllButton,
  ];
  for (const control of controls) {
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLButtonElement
    ) {
      control.disabled = value || !settings;
    }
  }

  if (clearRecentButton instanceof HTMLButtonElement) {
    clearRecentButton.disabled = value || !settings || settings.recent.length === 0;
  }
  if (deleteAllButton instanceof HTMLButtonElement) {
    const hasMemory = Boolean(settings?.summary) || (settings?.recent?.length || 0) > 0;
    deleteAllButton.disabled = value || !settings || !hasMemory;
  }

  if (recentList instanceof HTMLElement) {
    for (const button of recentList.querySelectorAll("button[data-sequence]")) {
      if (button instanceof HTMLButtonElement) button.disabled = value;
    }
  }
}

function formatTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function createRecentEntry(entry) {
  const article = document.createElement("article");
  article.className = "recent-memory-entry";

  const heading = document.createElement("div");
  heading.className = "recent-memory-heading";

  const role = document.createElement("strong");
  role.textContent = entry.role === "assistant" ? "Stabilize" : "You";

  const time = document.createElement("span");
  time.textContent = formatTimestamp(entry.createdAt);

  const content = document.createElement("p");
  content.textContent = String(entry.content || "");

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "entry-delete";
  remove.dataset.sequence = String(entry.sequence);
  remove.textContent = "Delete entry";
  remove.setAttribute(
    "aria-label",
    `Delete ${entry.role === "assistant" ? "Stabilize" : "user"} memory entry`,
  );

  heading.append(role, time);
  article.append(heading, content, remove);
  return article;
}

function renderRecent() {
  if (!(recentList instanceof HTMLElement)) return;
  recentList.replaceChildren();

  if (!settings?.recent?.length) {
    const empty = document.createElement("p");
    empty.className = "empty-memory";
    empty.textContent = "No recent uncondensed context is stored.";
    recentList.appendChild(empty);
    return;
  }

  for (const entry of settings.recent) {
    recentList.appendChild(createRecentEntry(entry));
  }
}

function renderSettings(nextSettings) {
  settings = {
    enabled: nextSettings?.enabled !== false,
    summary: String(nextSettings?.summary || ""),
    recent: Array.isArray(nextSettings?.recent) ? nextSettings.recent : [],
    turnCount: Number(nextSettings?.turnCount) || 0,
    updatedAt: Number(nextSettings?.updatedAt) || null,
  };

  if (enabledControl instanceof HTMLInputElement) {
    enabledControl.checked = settings.enabled;
  }
  if (summaryInput instanceof HTMLTextAreaElement) {
    summaryInput.value = settings.summary;
  }
  if (statusHeading instanceof HTMLElement) {
    statusHeading.textContent = settings.enabled ? "Memory is on" : "Memory is off";
  }
  if (statusDetail instanceof HTMLElement) {
    statusDetail.textContent = settings.enabled
      ? "The rolling summary and recent buffer may be used and updated for signed-in continuity."
      : "Saved context is retained, but it is not used or updated while memory is off.";
  }
  if (updatedLabel instanceof HTMLElement) {
    const formatted = formatTimestamp(settings.updatedAt);
    updatedLabel.textContent = formatted ? `Last updated ${formatted}` : "No saved context yet";
  }

  renderRecent();
  setPending(false);
}

async function request(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(body.error || "The memory request failed."));
    error.status = response.status;
    throw error;
  }
  return body;
}

async function runChange(action, successMessage) {
  if (pending) return;
  setPending(true);
  setNotice("");
  try {
    const next = await action();
    renderSettings(next);
    setNotice(successMessage, "success");
  } catch (error) {
    setPending(false);
    setNotice(
      error instanceof Error ? error.message : "The memory change failed.",
      "error",
    );
  }
}

async function loadSettings() {
  setPending(true);
  try {
    renderSettings(await request("/api/memory"));
  } catch (error) {
    settings = null;
    setPending(false);
    if (statusHeading instanceof HTMLElement) {
      statusHeading.textContent = "Memory controls are unavailable";
    }
    if (statusDetail instanceof HTMLElement) {
      statusDetail.textContent =
        error instanceof Error
          ? error.message
          : "Try returning to the chat and signing in again.";
    }
  }
}

if (enabledControl instanceof HTMLInputElement) {
  enabledControl.addEventListener("change", () => {
    const enabled = enabledControl.checked;
    void runChange(
      () =>
        request("/api/memory", {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        }),
      enabled
        ? "Memory is on. Saved context can be used and updated again."
        : "Memory is off. Saved context is retained but will not be used or updated.",
    );
  });
}

if (
  saveSummaryButton instanceof HTMLButtonElement &&
  summaryInput instanceof HTMLTextAreaElement
) {
  saveSummaryButton.addEventListener("click", () => {
    void runChange(
      () =>
        request("/api/memory", {
          method: "PATCH",
          body: JSON.stringify({ summary: summaryInput.value }),
        }),
      "Remembered summary updated.",
    );
  });
}

if (recentList instanceof HTMLElement) {
  recentList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const sequence = Number(target.dataset.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) return;
    if (!window.confirm("Delete this recent memory entry?")) return;
    void runChange(
      () => request(`/api/memory/recent/${sequence}`, { method: "DELETE" }),
      "Recent memory entry deleted.",
    );
  });
}

if (clearRecentButton instanceof HTMLButtonElement) {
  clearRecentButton.addEventListener("click", () => {
    if (!window.confirm("Clear all recent uncondensed context?")) return;
    void runChange(
      () => request("/api/memory/recent", { method: "DELETE" }),
      "Recent context cleared.",
    );
  });
}

if (deleteAllButton instanceof HTMLButtonElement) {
  deleteAllButton.addEventListener("click", () => {
    if (
      !window.confirm(
        "Delete the rolling summary and all recent Stabilize memory? This cannot be undone.",
      )
    ) {
      return;
    }
    void runChange(
      () => request("/api/memory", { method: "DELETE" }),
      "All Stabilize account memory deleted.",
    );
  });
}

void loadSettings();

const FEEDBACK_ENDPOINT = "/api/message-feedback";
const BROWSER_KEY = "stabilize:impact-browser:v1";
const SESSION_KEY = "stabilize:impact-session:v1";
const MAX_COMMENT_CHARS = 500;
const previousFetch = window.fetch.bind(window);
const completedTurns = [];
const FOLLOWUP_ACTION_EVENT = "stabilize:followup-actions";
const pendingFollowupActions = new Map();
const followupActionHosts = new Map();
const SHARE_STEP_MAX_CHARS = 280;
const shareEditors = new Map();

function readShareCopy() {
  const fallback = {
    promise: "Stabilize adapts to your capacity, keeps memory bounded and deletable, and helps you move from conversation to real-world action.",
    url: "https://stabilize.info/",
    title: "Stabilize",
    editorLabel: "Keep or share one next step",
    editorPlaceholder: "Write the one next step you want to keep or share.",
    stepPrefix: "My next step:",
    copyButton: "Copy next step",
    shareButton: "Share Stabilize",
    privacyNote:
      "Only this field and the Stabilize link will be copied or shared. Your conversation stays here.",
    stepRequired: "Add a next step before copying.",
    copied: "Copied — paste it wherever you want.",
    shared: "Share sheet opened.",
    shareFallback:
      "Sharing is not available here, so the text was copied instead.",
    shareError: "Could not open sharing. You can still copy the next step.",
  };
  const template = document.querySelector("#client-copy");
  if (!(template instanceof HTMLTemplateElement)) return fallback;
  try {
    const parsed = JSON.parse(template.content.textContent || "{}");
    return { ...fallback, ...(parsed?.share || {}) };
  } catch {
    return fallback;
  }
}

const shareCopy = readShareCopy();

const POSITIVE_REASONS = [
  ["clear_answer", "Clear answer"],
  ["useful_next_step", "Useful next step"],
  ["felt_relevant", "Felt relevant"],
  ["helped_me_decide", "Helped me decide"],
  ["helped_me_feel_steadier", "Helped me feel steadier"],
];

const NEGATIVE_REASONS = [
  ["did_not_answer", "Didn’t answer"],
  ["misunderstood_me", "Misunderstood me"],
  ["too_generic", "Too generic"],
  ["too_long", "Too long"],
  ["inaccurate", "Inaccurate"],
  ["repetitive", "Repetitive"],
  ["unsafe_or_concerning", "Unsafe or concerning"],
  ["technical_problem", "Technical problem"],
  ["other", "Other"],
];

function randomId() {
  return crypto.randomUUID();
}

function readBrowserId() {
  try {
    const record = JSON.parse(localStorage.getItem(BROWSER_KEY) || "null");
    return typeof record?.id === "string" ? record.id : "";
  } catch {
    return "";
  }
}

function readSessionId() {
  try {
    return sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

function isChatRequest(input) {
  try {
    const value = input instanceof Request ? input.url : input;
    const url = new URL(String(value), window.location.href);
    return url.origin === window.location.origin && url.pathname === "/api/chat";
  } catch {
    return false;
  }
}

async function drainResponse(response, turn) {
  try {
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      reader.releaseLock();
    }
  } catch {
    // The visible chat owns error handling. Feedback still attaches to the result.
  } finally {
    completedTurns.push(turn);
    queueFeedbackBinding();
  }
}

window.fetch = async (input, init) => {
  if (!isChatRequest(input)) return previousFetch(input, init);

  const response = await previousFetch(input, init);
  const turnId = response.headers.get("X-Stabilize-Turn-Id") || "";
  if (turnId) {
    void drainResponse(response.clone(), {
      turnId,
      ok: response.ok,
      status: response.status,
    });
  }
  return response;
};

async function postFeedback(turn, rating, reason = "", comment = "") {
  const browserId = readBrowserId();
  const sessionId = readSessionId();
  if (!turn?.turnId || !browserId || !sessionId) return undefined;

  const payload = {
    eventId: randomId(),
    sessionId,
    browserId,
    turnId: turn.turnId,
    rating,
    reason,
    comment: String(comment || "").trim().slice(0, MAX_COMMENT_CHARS),
  };

  const request = () =>
    previousFetch(FEEDBACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });

  try {
    let response = await request();
    if (response.status === 409) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      response = await request();
    }
    return response;
  } catch {
    return undefined;
  }
}

function feedbackButton(label, value, ariaLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-feedback-choice";
  button.textContent = label;
  button.dataset.value = value;
  button.setAttribute("aria-label", ariaLabel);
  button.setAttribute("aria-pressed", "false");
  return button;
}

function reasonButtons(rating, onSelect) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-feedback-reasons";
  wrapper.setAttribute("aria-label", "Why did you choose this rating?");

  const options = rating === "up" ? POSITIVE_REASONS : NEGATIVE_REASONS;
  for (const [value, label] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-feedback-reason";
    button.textContent = label;
    button.dataset.reason = value;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      for (const sibling of wrapper.querySelectorAll("button")) {
        sibling.setAttribute("aria-pressed", String(sibling === button));
      }
      onSelect(value);
    });
    wrapper.appendChild(button);
  }
  return wrapper;
}

function detailsForm(turn, getState, setStatus) {
  const form = document.createElement("form");
  form.className = "message-feedback-details";

  const label = document.createElement("label");
  label.textContent = "Optional details";

  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.maxLength = MAX_COMMENT_CHARS;
  textarea.placeholder = "What would have made this better? Avoid private details.";
  label.appendChild(textarea);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "message-feedback-submit";
  submit.textContent = "Send details";

  form.append(label, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = getState();
    if (!state.rating) return;
    submit.disabled = true;
    void postFeedback(turn, state.rating, state.reason, textarea.value).then((response) => {
      submit.disabled = false;
      if (response?.ok) {
        textarea.value = "";
        setStatus("Thanks — details saved privately.");
      } else {
        setStatus("Details could not be saved. Your rating is still recorded.");
      }
    });
  });
  return form;
}

function cleanShareStep(value) {
  return String(value || "").trim().slice(0, SHARE_STEP_MAX_CHARS);
}

function buildShareText(nextStep, includeUrl = true) {
  const step = cleanShareStep(nextStep);
  const lines = [];
  if (step) lines.push(`${shareCopy.stepPrefix} ${step}`, "");
  lines.push(shareCopy.promise);
  if (includeUrl) lines.push(shareCopy.url);
  return lines.join("\n");
}

async function copyPlainText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to a temporary textarea for browsers that block Clipboard API.
    }
  }

  const temporary = document.createElement("textarea");
  temporary.value = text;
  temporary.setAttribute("readonly", "");
  temporary.style.position = "fixed";
  temporary.style.inset = "-9999px auto auto -9999px";
  document.body.appendChild(temporary);
  temporary.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  temporary.remove();
  return copied;
}

function createShareEditor(turnId) {
  const section = document.createElement("section");
  section.className = "message-feedback-share";
  section.setAttribute("aria-label", shareCopy.editorLabel);
  section.hidden = true;

  const label = document.createElement("label");
  label.textContent = shareCopy.editorLabel;

  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.maxLength = SHARE_STEP_MAX_CHARS;
  textarea.placeholder = shareCopy.editorPlaceholder;
  label.appendChild(textarea);

  const actions = document.createElement("div");
  actions.className = "message-feedback-share-actions";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "message-feedback-share-button";
  copyButton.textContent = shareCopy.copyButton;

  const shareButton = document.createElement("button");
  shareButton.type = "button";
  shareButton.className = "message-feedback-share-button";
  shareButton.textContent = shareCopy.shareButton;

  const note = document.createElement("p");
  note.className = "message-feedback-share-note";
  note.textContent = shareCopy.privacyNote;

  const status = document.createElement("p");
  status.className = "message-feedback-share-status";
  status.setAttribute("aria-live", "polite");

  copyButton.addEventListener("click", async () => {
    const step = cleanShareStep(textarea.value);
    if (!step) {
      status.textContent = shareCopy.stepRequired;
      textarea.focus();
      return;
    }
    const copied = await copyPlainText(buildShareText(step));
    status.textContent = copied ? shareCopy.copied : shareCopy.shareError;
  });

  shareButton.addEventListener("click", async () => {
    const step = cleanShareStep(textarea.value);
    const payload = {
      title: shareCopy.title,
      text: buildShareText(step, false),
      url: shareCopy.url,
    };

    if (typeof navigator.share === "function") {
      try {
        await navigator.share(payload);
        status.textContent = shareCopy.shared;
      } catch (error) {
        if (error?.name !== "AbortError") status.textContent = shareCopy.shareError;
      }
      return;
    }

    const copied = await copyPlainText(buildShareText(step));
    status.textContent = copied ? shareCopy.shareFallback : shareCopy.shareError;
  });

  actions.append(copyButton, shareButton);
  section.append(label, actions, note, status);
  shareEditors.set(turnId, { section, textarea, status });
  return section;
}

function revealShareEditor(turnId, suggestedStep = "") {
  const editor = shareEditors.get(turnId);
  if (!editor) return;
  const suggestion = cleanShareStep(suggestedStep);
  if (suggestion && !cleanShareStep(editor.textarea.value)) {
    editor.textarea.value = suggestion;
  }
  editor.section.hidden = false;
}

function hideShareEditor(turnId) {
  const editor = shareEditors.get(turnId);
  if (editor) editor.section.hidden = true;
}

function prepareFollowupButton(button, turnId) {
  if (!(button instanceof HTMLButtonElement)) return null;
  button.className = "message-feedback-action";
  button.removeAttribute("style");
  button.disabled = false;
  if (!button.dataset.shareEditorBound) {
    button.dataset.shareEditorBound = "true";
    button.addEventListener(
      "click",
      () => revealShareEditor(turnId, button.textContent),
      { once: true },
    );
  }
  return button;
}

function flushFollowupActions(turnId) {
  const host = followupActionHosts.get(turnId);
  const pendingButtons = pendingFollowupActions.get(turnId);
  if (!(host instanceof HTMLElement) || !pendingButtons?.length) return;

  const buttons = pendingButtons
    .map((button) => prepareFollowupButton(button, turnId))
    .filter(Boolean)
    .slice(0, 3);
  host.replaceChildren(...buttons);
  host.hidden = buttons.length === 0;
  pendingFollowupActions.delete(turnId);
}

window.addEventListener(FOLLOWUP_ACTION_EVENT, (event) => {
  const detail = event instanceof CustomEvent ? event.detail : null;
  const turnId = String(detail?.turnId || "");
  const buttons = Array.from(detail?.buttons || []).filter(
    (item) => item instanceof HTMLButtonElement,
  );
  if (!turnId || !buttons.length) return;
  pendingFollowupActions.set(turnId, buttons.slice(0, 3));
  flushFollowupActions(turnId);
});

function renderMessageFeedback(article, turn) {
  if (!(article instanceof HTMLElement) || article.dataset.messageFeedbackBound) {
    return;
  }
  article.dataset.messageFeedbackBound = turn.turnId;

  const section = document.createElement("section");
  section.className = "message-feedback";
  section.setAttribute("aria-label", "Response feedback");

  const row = document.createElement("div");
  row.className = "message-feedback-row";

  const up = feedbackButton("👍", "up", "Mark this response helpful");
  const down = feedbackButton("👎", "down", "Mark this response not helpful");
  const actions = document.createElement("div");
  actions.className = "message-feedback-actions";
  actions.setAttribute("aria-label", "Suggested follow-up actions");
  actions.hidden = true;
  row.append(up, down, actions);
  followupActionHosts.set(turn.turnId, actions);
  flushFollowupActions(turn.turnId);
  const shareEditor = createShareEditor(turn.turnId);

  const followup = document.createElement("div");
  followup.className = "message-feedback-followup";
  followup.hidden = true;

  const status = document.createElement("p");
  status.className = "message-feedback-status";
  status.setAttribute("aria-live", "polite");

  const privacy = document.createElement("p");
  privacy.className = "message-feedback-privacy";
  privacy.append("Chat text is not stored with analytics. ");
  const privacyLink = document.createElement("a");
  privacyLink.href = "/privacy#outcome-measurement";
  privacyLink.textContent = "Privacy details";
  privacy.appendChild(privacyLink);

  const state = { rating: "", reason: "" };
  const setStatus = (message) => {
    status.textContent = message;
  };

  function chooseRating(rating) {
    state.rating = rating;
    state.reason = "";
    if (rating === "up") revealShareEditor(turn.turnId);
    else hideShareEditor(turn.turnId);
    up.setAttribute("aria-pressed", String(rating === "up"));
    down.setAttribute("aria-pressed", String(rating === "down"));
    followup.replaceChildren();
    followup.hidden = false;

    const reasons = reasonButtons(rating, (reason) => {
      state.reason = reason;
      void postFeedback(turn, state.rating, reason).then((response) => {
        setStatus(response?.ok ? "Thanks — feedback saved." : "Feedback could not be saved.");
      });
    });
    followup.append(
      reasons,
      detailsForm(turn, () => ({ ...state }), setStatus),
      privacy,
    );

    void postFeedback(turn, rating).then((response) => {
      setStatus(response?.ok ? "Thanks — feedback saved." : "Feedback could not be saved.");
    });
  }

  up.addEventListener("click", () => chooseRating("up"));
  down.addEventListener("click", () => chooseRating("down"));

  section.append(row, shareEditor, followup, status);
  article.appendChild(section);
  void postFeedback(turn, "shown");
}

function unboundAssistantOutputs() {
  return [...document.querySelectorAll("#chat-log .assistant-output")].filter(
    (article) =>
      article instanceof HTMLElement &&
      !article.dataset.messageFeedbackBound &&
      !article.matches("[data-message-feedback-ignore]"),
  );
}

function bindCompletedTurns() {
  while (completedTurns.length) {
    const candidates = unboundAssistantOutputs();
    if (!candidates.length) return;
    const turn = completedTurns.shift();
    const article = candidates.at(-1);
    renderMessageFeedback(article, turn);
  }
}

function queueFeedbackBinding() {
  queueMicrotask(bindCompletedTurns);
}

for (const article of document.querySelectorAll("#chat-log .assistant-output")) {
  article.setAttribute("data-message-feedback-ignore", "true");
}

const observer = new MutationObserver(queueFeedbackBinding);
observer.observe(document.documentElement, { childList: true, subtree: true });
queueFeedbackBinding();

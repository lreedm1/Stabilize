const FEEDBACK_ENDPOINT = "/api/message-feedback";
const BROWSER_KEY = "stabilize:impact-browser:v1";
const SESSION_KEY = "stabilize:impact-session:v1";
const MAX_COMMENT_CHARS = 500;
const previousFetch = window.fetch.bind(window);
const completedTurns = [];
const submittedState = new Map();

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

function postFeedback(turn, rating, reason = "", comment = "") {
  const browserId = readBrowserId();
  const sessionId = readSessionId();
  if (!turn?.turnId || !browserId || !sessionId) return Promise.resolve(undefined);

  const payload = {
    eventId: randomId(),
    sessionId,
    browserId,
    turnId: turn.turnId,
    rating,
    reason,
    comment: String(comment || "").trim().slice(0, MAX_COMMENT_CHARS),
  };

  return previousFetch(FEEDBACK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
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

  const prompt = document.createElement("span");
  prompt.className = "message-feedback-prompt";
  prompt.textContent = "Was this helpful?";

  const up = feedbackButton("👍", "up", "Mark this response helpful");
  const down = feedbackButton("👎", "down", "Mark this response not helpful");
  row.append(prompt, up, down);

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

    submittedState.set(turn.turnId, rating);
    void postFeedback(turn, rating).then((response) => {
      setStatus(response?.ok ? "Thanks — feedback saved." : "Feedback could not be saved.");
    });
  }

  up.addEventListener("click", () => chooseRating("up"));
  down.addEventListener("click", () => chooseRating("down"));

  section.append(row, followup, status);
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

import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Inline follow-up update could not find ${label}`);
  }
}

function replaceFunctionBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) return source;
  const end = source.indexOf(endMarker, start);
  if (end < 0) {
    throw new Error(`Inline follow-up update could not find ${label} end`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

await update("public/impact.js", (source) => {
  let text = source;

  if (!text.includes('const FOLLOWUP_ACTION_EVENT = "stabilize:followup-actions"')) {
    const marker = "const originalFetch = window.fetch.bind(window);";
    requireText(text, marker, "the impact client constant insertion point");
    const constants = `const FOLLOWUP_ACTION_EVENT = "stabilize:followup-actions";
const FOLLOWUP_ROUTES = new Set([
  "FLOOR_FOOD",
  "FLOOR_REST",
  "LOW_SLEEP_URGENCY",
  "SAFETY_CONFIRMED",
]);
const FOLLOWUP_REPLY_PATTERNS = [
  /\\b(message|text|email|reply|apolog(?:y|ize)|boundary|send it)\\b/i,
  /\\b(decision|decide|choice|choose|compare|option|trade-?off|pros? and cons?)\\b/i,
  /\\b(work|school|class|assignment|project|deadline|application|internship|meeting)\\b/i,
  /\\b(money|budget|rent|housing|apartment|cost|debt|bill|financial|afford)\\b/i,
  /\\b(friend|social|lonely|alone|isolation|reach out|connection|meet people|community)\\b/i,
];
const FOLLOWUP_CUE_PATTERN =
  /\\b(want me to|would you like|i can (?:help|draft|compare|make|plan)|next step|choose|which|option|draft|compare|plan)\\b/i;
`;
    text = text.replace(marker, `${constants}\n${marker}`);
  }

  if (text.includes("function potentiallyResolving(text)")) {
    text = replaceFunctionBlock(
      text,
      "function potentiallyResolving(text)",
      "async function postImpactState(",
      `function modelReplyNeedsFollowups(text, route) {
  const cleanRoute = String(route || "UNKNOWN").trim().toUpperCase();
  if (URGENT_ROUTES.has(cleanRoute)) return false;
  if (FOLLOWUP_ROUTES.has(cleanRoute)) return true;

  const content = String(text || "").trim();
  if (content.length < 80) return false;
  const hasRelevantDomain = FOLLOWUP_REPLY_PATTERNS.some((pattern) =>
    pattern.test(content),
  );
  return hasRelevantDomain && FOLLOWUP_CUE_PATTERN.test(content);
}

`,
      "the old outcome eligibility function",
    );
  }

  if (text.includes("function renderAnsweredState(")) {
    text = replaceFunctionBlock(
      text,
      "function renderAnsweredState(",
      "function removeConversationCard(",
      `function enhanceOutcomeCheck(check) {
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

`,
      "the old outcome card renderer",
    );
  }

  requireText(text, "function modelReplyNeedsFollowups(text, route)", "model-reply follow-up gating");
  requireText(text, "new CustomEvent(FOLLOWUP_ACTION_EVENT", "the inline follow-up event");
  requireText(text, 'void postNextStep(turn, "shown")', "follow-up visibility measurement");
  requireText(text, 'void postNextStep(turn, "yes")', "follow-up selection measurement");
  if (text.includes("Did you choose a next step?")) {
    throw new Error("The separate next-step survey is still visible in the impact client");
  }
  return text;
});

await update("public/message-feedback.js", (source) => {
  let text = source;

  if (!text.includes('const FOLLOWUP_ACTION_EVENT = "stabilize:followup-actions"')) {
    const marker = "const completedTurns = [];";
    requireText(text, marker, "the response-feedback state insertion point");
    text = text.replace(
      marker,
      `${marker}\nconst FOLLOWUP_ACTION_EVENT = "stabilize:followup-actions";\nconst pendingFollowupActions = new Map();\nconst followupActionHosts = new Map();`,
    );
  }

  if (!text.includes("function flushFollowupActions(turnId)")) {
    const marker = "function renderMessageFeedback(article, turn) {";
    requireText(text, marker, "the response-feedback renderer");
    const helpers = `function prepareFollowupButton(button) {
  if (!(button instanceof HTMLButtonElement)) return null;
  button.className = "message-feedback-action";
  button.removeAttribute("style");
  button.disabled = false;
  return button;
}

function flushFollowupActions(turnId) {
  const host = followupActionHosts.get(turnId);
  const pendingButtons = pendingFollowupActions.get(turnId);
  if (!(host instanceof HTMLElement) || !pendingButtons?.length) return;

  const buttons = pendingButtons
    .map(prepareFollowupButton)
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

`;
    text = text.replace(marker, helpers + marker);
  }

  const oldPrompt = `  const prompt = document.createElement("span");
  prompt.className = "message-feedback-prompt";
  prompt.textContent = "Was this helpful?";

  const up = feedbackButton("👍", "up", "Mark this response helpful");
  const down = feedbackButton("👎", "down", "Mark this response not helpful");
  row.append(prompt, up, down);`;
  const inlineControls = `  const up = feedbackButton("👍", "up", "Mark this response helpful");
  const down = feedbackButton("👎", "down", "Mark this response not helpful");
  const actions = document.createElement("div");
  actions.className = "message-feedback-actions";
  actions.setAttribute("aria-label", "Suggested follow-up actions");
  actions.hidden = true;
  row.append(up, down, actions);
  followupActionHosts.set(turn.turnId, actions);
  flushFollowupActions(turn.turnId);`;
  if (text.includes(oldPrompt)) text = text.replace(oldPrompt, inlineControls);

  requireText(text, "function flushFollowupActions(turnId)", "the follow-up action bridge");
  requireText(text, 'className = "message-feedback-actions"', "the inline action host");
  if (text.includes("Was this helpful?")) {
    throw new Error("The visible response-feedback prompt text is still present");
  }
  return text;
});

await update("public/message-feedback.css", (source) => {
  let text = source;
  const marker = "/* Inline model-relevant follow-up actions */";
  if (!text.includes(marker)) {
    const styles = `

${marker}
.outcome-tray {
  display: none !important;
}

.message-feedback-actions {
  display: flex;
  min-width: 0;
  flex: 1 1 12rem;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.34rem;
  margin-left: 0.18rem;
}

.message-feedback-actions[hidden] {
  display: none;
}

.message-feedback-action {
  -webkit-appearance: none;
  appearance: none;
  width: auto !important;
  min-height: 1.9rem;
  flex: 0 1 auto;
  border: 1px solid currentColor;
  border-radius: 999px !important;
  background: transparent;
  box-shadow: none;
  color: inherit;
  cursor: pointer;
  padding: 0.3rem 0.58rem;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 620;
  line-height: 1.25;
  opacity: 0.72;
  text-align: left;
}

.message-feedback-action:hover,
.message-feedback-action:focus-visible,
.message-feedback-action[aria-pressed="true"] {
  background: transparent;
  opacity: 1;
}

.message-feedback-action:focus-visible {
  outline: 3px solid rgba(255, 255, 255, 0.42);
  outline-offset: 2px;
}

.message-feedback-action:disabled {
  cursor: default;
  opacity: 0.42;
}

@media (max-width: 560px) {
  .message-feedback-actions {
    flex-basis: 100%;
    margin: 0.18rem 0 0;
  }

  .message-feedback-action {
    max-width: 100%;
  }
}
`;
    text += styles;
  }

  requireText(text, ".outcome-tray {\n  display: none !important;", "the hidden composer tray");
  requireText(text, ".message-feedback-action {", "inline action styling");
  return text;
});

await update("src/impact-events.js", (source) => {
  let text = source.replace(
    /const IMPACT_ASSET_VERSION = "[^"]+";/,
    'const IMPACT_ASSET_VERSION = "20260806-inline-followups-1";',
  );

  const paragraphStart = `      <p>\n        On the web, Stabilize may ask optional structured questions after a response.`;
  const nextParagraph = `      <p>\n        The impact store also keeps broad route, completion, configured cost, and timing`;
  const start = text.indexOf(paragraphStart);
  if (start >= 0) {
    const end = text.indexOf(nextParagraph, start);
    if (end < 0) {
      throw new Error("Inline follow-up update could not find the privacy paragraph end");
    }
    const disclosure = `      <p>
        When the model's reply indicates that a few follow-up actions would materially
        reduce effort, Stabilize may show up to three optional action buttons beside the
        response-feedback controls. Impact analytics record only whether those actions
        were shown and whether one was selected. After New conversation succeeds, a
        separate non-blocking check may ask whether the prior conversation helped the
        user move forward and records only shown, yes, partly, or no. The response-quality
        control records whether a response was shown, marked helpful, or marked not
        helpful, plus an optional reason code. A user may also submit up to 500 characters
        of optional details; those details are stored privately and may be reviewed to
        improve Stabilize. Do not include private or identifying information.
      </p>
`;
    text = text.slice(0, start) + disclosure + text.slice(end);
  }

  requireText(text, "up to three optional action buttons beside", "the updated privacy disclosure");
  requireText(text, "20260806-inline-followups-1", "the inline follow-up asset version");
  return text;
});

await update("test/outcome-followup.test.mjs", (source) => {
  let text = source;
  const sentinel = "  // follow-up buttons render above the composer\n";
  const startMarker =
    '  assert.match(pageSource, /id=\\"outcome-tray\\"[\\s\\S]*?<form id=\\"chat-form\\"/);';
  const endMarker =
    "  assert.doesNotMatch(clientScript, /appendOutcomeCheck\\(article/);\n";

  text = text.replace(sentinel, "");
  let start = text.indexOf(startMarker);
  while (start >= 0) {
    const endStart = text.indexOf(endMarker, start);
    if (endStart < 0) {
      throw new Error("Inline follow-up update found an incomplete old tray assertion block");
    }
    const end = endStart + endMarker.length;
    text = text.slice(0, start) + text.slice(end);
    start = text.indexOf(startMarker);
  }
  return text;
});

console.log("Moved model-relevant follow-up actions beside response feedback.");

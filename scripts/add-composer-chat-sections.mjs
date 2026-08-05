import { readFile, writeFile } from "node:fs/promises";

const ASSET_VERSION = "20260805-composer-chat-sections-1";

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Composer chat sections could not find ${label}`);
  }
}

function replaceBlock(value, startMarker, endMarker, replacement, label) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Composer chat sections could not replace ${label}`);
  }
  return value.slice(0, start) + replacement + value.slice(end);
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/paid-worker.js", (source) => {
  let text = source
    .replace(
      /\/billing\.css\?v=[A-Za-z0-9._-]+/g,
      `/billing.css?v=${ASSET_VERSION}`,
    )
    .replace(
      /\/billing-client\.js\?v=[A-Za-z0-9._-]+/g,
      `/billing-client.js?v=${ASSET_VERSION}`,
    );

  const composerFunction = `function composerModelPickerMarkup({
  signedIn,
  configured,
  state,
  choices,
  defaultModel,
  freeLimit,
  paidLimit,
}) {
  const choice = modelChoiceState(state, choices, defaultModel);
  const buttonLabel = compactModelTileLabel(choice.selected);
  let modelPanel = "";

  if (!signedIn) {
    modelPanel =
      "<p>Sign in to choose a model and receive 20 free model-select messages each day.</p>" +
      '<a class="billing-primary billing-link" href="/auth/google">Sign in</a>';
  } else {
    const options = modelOptionsMarkup(choices, choice.selected);
    const usage = modelUsageCopy({
      paid: choice.paid,
      used: choice.used,
      freeLimit,
      paidLimit,
    });
    const upgrade = !choice.paid && configured
      ? '<form action="/billing/checkout" method="post" data-billing-redirect="checkout">' +
          '<button class="billing-secondary" type="submit">Upgrade allowance</button>' +
          "</form>"
      : "";

    modelPanel =
      '<form action="/account/model" method="post" class="model-choice-form composer-model-form">' +
      '<label for="composer-model-choice">Choose model</label>' +
      '<select id="composer-model-choice" name="model">' +
      options +
      "</select>" +
      '<button class="billing-primary" type="submit">Use model</button>' +
      "</form>" +
      '<p class="billing-usage">' +
      escapeHtml(usage) +
      "</p>" +
      upgrade;
  }

  const newChatNote = signedIn
    ? "Starts a fresh conversation with your optional Stabilize memory available."
    : "Starts a fresh guest conversation.";
  const privateChatNote = signedIn
    ? "Starts fresh without reading or updating your Stabilize memory."
    : "Guest chats already do not use Stabilize account memory.";

  return (
    '<details class="composer-model-picker composer-quick-menu">' +
    '<summary class="composer-model-button" aria-label="Open model and chat controls. Current model: ' +
    escapeHtml(choice.currentLabel) +
    '">' +
    '<span class="composer-model-kicker">Model</span>' +
    '<span class="composer-model-current">' +
    escapeHtml(buttonLabel) +
    "</span>" +
    "</summary>" +
    '<div class="composer-model-panel composer-quick-panel" role="group" aria-label="Model and chat controls">' +
    "<h2>Chat controls</h2>" +
    '<section class="composer-quick-section composer-quick-model" aria-labelledby="composer-quick-model-heading">' +
    '<h3 id="composer-quick-model-heading">Model</h3>' +
    modelPanel +
    "</section>" +
    '<section class="composer-quick-section" aria-labelledby="composer-quick-new-heading">' +
    '<h3 id="composer-quick-new-heading">New chat</h3>' +
    "<p>" +
    escapeHtml(newChatNote) +
    "</p>" +
    '<button class="composer-quick-action" type="button" data-composer-new-chat>New chat</button>' +
    "</section>" +
    '<section class="composer-quick-section" aria-labelledby="composer-quick-private-heading">' +
    '<h3 id="composer-quick-private-heading">New private chat</h3>' +
    "<p>" +
    escapeHtml(privateChatNote) +
    "</p>" +
    '<button class="composer-quick-action composer-quick-private-action" type="button" data-composer-new-private-chat>New private chat</button>' +
    "</section>" +
    '<p class="composer-quick-status" data-composer-quick-status role="status" aria-live="polite" hidden></p>' +
    "</div>" +
    "</details>"
  );
}`;

  text = replaceBlock(
    text,
    "function composerModelPickerMarkup({",
    "\n\nasync function injectBillingPage(",
    composerFunction,
    "the lower-left composer menu",
  );

  for (const expected of [
    `/billing.css?v=${ASSET_VERSION}`,
    `/billing-client.js?v=${ASSET_VERSION}`,
    'class="composer-quick-section composer-quick-model"',
    'data-composer-new-chat',
    'data-composer-new-private-chat',
    "Open model and chat controls",
  ]) {
    requireText(text, expected, expected);
  }

  return text;
});

await update("public/billing-client.js", (source) => {
  if (source.includes("/* Composer chat sections */")) return source;

  const client = `

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
`;

  return source.trimEnd() + client;
});

await update("public/billing.css", (source) => {
  if (source.includes("/* Composer chat sections */")) return source;

  return `${source.trimEnd()}

/* Composer chat sections */
.composer-quick-panel {
  width: min(350px, calc(100vw - 24px));
  padding: 12px 14px;
}

.composer-quick-panel > h2 {
  margin-bottom: 2px;
}

.composer-quick-section {
  border-top: 1px solid var(--line);
  padding: 11px 0;
}

.composer-quick-section:first-of-type {
  border-top: 0;
  padding-top: 8px;
}

.composer-quick-section:last-of-type {
  padding-bottom: 2px;
}

.composer-quick-section h3 {
  margin: 0 0 6px;
  color: var(--text);
  font-size: 0.8rem;
  font-weight: 790;
  letter-spacing: -0.01em;
}

.composer-quick-section p {
  margin-bottom: 8px;
  font-size: 0.7rem;
  line-height: 1.4;
}

.composer-quick-model .billing-usage {
  margin-top: 8px;
}

.composer-quick-action {
  border: 1px solid var(--line);
  background: var(--surface-strong);
  color: var(--accent-dark);
}

.composer-quick-action:hover,
.composer-quick-action:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.composer-quick-private-action {
  border-color: var(--accent);
}

.composer-quick-status {
  margin: 9px 0 0;
  color: var(--accent-dark);
  font-size: 0.7rem;
  font-weight: 680;
  text-align: center;
}

.composer-quick-status[hidden] {
  display: none;
}

@media (max-width: 600px) {
  .composer-quick-panel {
    width: min(330px, calc(100vw - 18px));
    max-height: min(68dvh, 470px);
  }
}
`;
});

await update("test/paid-worker.test.mjs", (source) => {
  if (source.includes("composer-quick-private-heading")) return source;

  const anchor = "  assert.ok(chatFormIndex > pickerIndex);";
  requireText(source, anchor, "the composer placement assertion");
  const assertions = `${anchor}
  assert.match(
    html,
    /<h3 id="composer-quick-model-heading">Model<\\/h3>/,
  );
  assert.match(
    html,
    /<h3 id="composer-quick-new-heading">New chat<\\/h3>[\\s\\S]*data-composer-new-chat[\\s\\S]*>New chat<\\/button>/,
  );
  assert.match(
    html,
    /<h3 id="composer-quick-private-heading">New private chat<\\/h3>[\\s\\S]*data-composer-new-private-chat[\\s\\S]*>New private chat<\\/button>/,
  );`;
  return source.replace(anchor, assertions);
});

console.log(
  "Added Model, New chat, and New private chat sections to the lower-left composer button.",
);

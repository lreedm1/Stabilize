import { readFile, writeFile } from "node:fs/promises";

const PRODUCT_PROMISE =
  "Stabilize helps you turn an overloaded moment into one safe, practical next step.";
const SHARE_URL = "https://stabilize.info/";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Shareable next-step update could not find ${label}`);
  }
}

await update("src/copy.js", (source) => {
  let text = source;

  if (!text.includes("const PRODUCT_PROMISE =")) {
    const marker = "export const COPY = {";
    requireText(text, marker, "the copy export");
    text = text.replace(
      marker,
      `const PRODUCT_PROMISE =\n  ${JSON.stringify(PRODUCT_PROMISE)};\n\n${marker}`,
    );
  }

  text = text.replace(
    /    description: "Stabilize is a free, floor-first AI check-in for overloaded moments\.",/,
    "    description: PRODUCT_PROMISE,",
  );

  if (!text.includes("    promise: PRODUCT_PROMISE,")) {
    const marker = "    description: PRODUCT_PROMISE,\n";
    requireText(text, marker, "the product description");
    text = text.replace(marker, `${marker}    promise: PRODUCT_PROMISE,\n`);
  }

  if (!text.includes("    share: {")) {
    const marker = '    errorReferenceLabel: "Error reference",\n';
    requireText(text, marker, "the client copy insertion point");
    const shareCopy = `    share: {
      promise: PRODUCT_PROMISE,
      url: ${JSON.stringify(SHARE_URL)},
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
    },
`;
    text = text.replace(marker, marker + shareCopy);
  }

  requireText(text, PRODUCT_PROMISE, "the canonical product promise");
  requireText(text, "description: PRODUCT_PROMISE", "the shared description");
  requireText(text, "promise: PRODUCT_PROMISE", "the landing promise");
  requireText(text, "share: {", "the share copy");
  return text;
});

await update("src/page.js", (source) => {
  let text = source;

  text = text.replace(
    '  const seoTitle = "Stabilize — Get One Clear Next Step";',
    '  const seoTitle = "Stabilize — One Safe, Practical Next Step";',
  );
  text = text.replace(
    `  const seoDescription =\n    "Free, floor-first AI support for overloaded moments. Describe what is happening and get one clear next step.";`,
    "  const seoDescription = page.promise;",
  );
  text = text.replace(
    '<p class="product-promise">Tell Stabilize what is happening. Get one clear next step.</p>',
    '<p class="product-promise">${escapeHtml(page.promise)}</p>',
  );

  requireText(text, "const seoDescription = page.promise;", "the SEO promise");
  requireText(
    text,
    '<p class="product-promise">${escapeHtml(page.promise)}</p>',
    "the visible promise",
  );
  return text;
});

await update("public/message-feedback.js", (source) => {
  let text = source;

  if (!text.includes("const SHARE_STEP_MAX_CHARS = 280;")) {
    const marker = "const followupActionHosts = new Map();";
    requireText(text, marker, "the inline follow-up maps");
    const shareState = `const SHARE_STEP_MAX_CHARS = 280;
const shareEditors = new Map();

function readShareCopy() {
  const fallback = {
    promise: ${JSON.stringify(PRODUCT_PROMISE)},
    url: ${JSON.stringify(SHARE_URL)},
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

const shareCopy = readShareCopy();`;
    text = text.replace(marker, `${marker}\n${shareState}`);
  }

  if (!text.includes("function createShareEditor(turnId)")) {
    const marker = "function prepareFollowupButton(button) {";
    requireText(text, marker, "the follow-up button helper");
    const helpers = `function cleanShareStep(value) {
  return String(value || "").trim().slice(0, SHARE_STEP_MAX_CHARS);
}

function buildShareText(nextStep, includeUrl = true) {
  const step = cleanShareStep(nextStep);
  const lines = [];
  if (step) lines.push(\`${"${shareCopy.stepPrefix} ${step}"}\`, "");
  lines.push(shareCopy.promise);
  if (includeUrl) lines.push(shareCopy.url);
  return lines.join("\\n");
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

`;
    text = text.replace(marker, helpers + marker);
  }

  text = text.replace(
    "function prepareFollowupButton(button) {",
    "function prepareFollowupButton(button, turnId) {",
  );

  if (!text.includes("button.dataset.shareEditorBound")) {
    const marker = `  button.disabled = false;
  return button;
}`;
    requireText(text, marker, "the follow-up button return");
    text = text.replace(
      marker,
      `  button.disabled = false;
  if (!button.dataset.shareEditorBound) {
    button.dataset.shareEditorBound = "true";
    button.addEventListener(
      "click",
      () => revealShareEditor(turnId, button.textContent),
      { once: true },
    );
  }
  return button;
}`,
    );
  }

  text = text.replace(
    ".map(prepareFollowupButton)",
    ".map((button) => prepareFollowupButton(button, turnId))",
  );

  if (!text.includes("const shareEditor = createShareEditor(turn.turnId);")) {
    const marker = `  followupActionHosts.set(turn.turnId, actions);
  flushFollowupActions(turn.turnId);`;
    requireText(text, marker, "the inline action host registration");
    text = text.replace(
      marker,
      `${marker}\n  const shareEditor = createShareEditor(turn.turnId);`,
    );
  }

  if (!text.includes('revealShareEditor(turn.turnId)')) {
    const marker = `    state.rating = rating;
    state.reason = "";`;
    requireText(text, marker, "the rating state update");
    text = text.replace(
      marker,
      `${marker}
    if (rating === "up") revealShareEditor(turn.turnId);
    else hideShareEditor(turn.turnId);`,
    );
  }

  text = text.replace(
    "  section.append(row, followup, status);",
    "  section.append(row, shareEditor, followup, status);",
  );

  requireText(text, "function createShareEditor(turnId)", "the share editor");
  requireText(text, "navigator.share(payload)", "the Web Share API path");
  requireText(text, "navigator.clipboard?.writeText", "the clipboard path");
  requireText(
    text,
    'if (rating === "up") revealShareEditor(turn.turnId);',
    "positive-feedback reveal",
  );
  requireText(
    text,
    "() => revealShareEditor(turnId, button.textContent)",
    "selected-action reveal",
  );
  if (text.includes("article.textContent") && text.includes("buildShareText(article")) {
    throw new Error("Conversation text is being inserted into the share draft");
  }
  return text;
});

await update("public/message-feedback.css", (source) => {
  let text = source;
  const marker = "/* Shareable next-step loop */";
  if (!text.includes(marker)) {
    text += `

${marker}
.message-feedback-share {
  margin-top: 0.58rem;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  padding-top: 0.58rem;
}

.message-feedback-share[hidden] {
  display: none;
}

.message-feedback-share label {
  display: grid;
  gap: 0.32rem;
  color: inherit;
  font-size: 0.76rem;
  font-weight: 620;
  line-height: 1.35;
}

.message-feedback-share textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 3.3rem;
  resize: vertical;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 10px;
  background: rgba(255, 253, 247, 0.9);
  color: #173f31;
  padding: 0.56rem 0.64rem;
  font: inherit;
  line-height: 1.4;
  text-shadow: none;
}

.message-feedback-share textarea::placeholder {
  color: rgba(23, 63, 49, 0.66);
}

.message-feedback-share-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.42rem;
  margin-top: 0.48rem;
}

.message-feedback-share-button {
  -webkit-appearance: none;
  appearance: none;
  min-height: 2rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0.34rem 0.66rem;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 650;
  line-height: 1.2;
  opacity: 0.78;
}

.message-feedback-share-button:hover,
.message-feedback-share-button:focus-visible {
  background: transparent;
  opacity: 1;
}

.message-feedback-share-button:focus-visible,
.message-feedback-share textarea:focus-visible {
  outline: 3px solid rgba(255, 255, 255, 0.42);
  outline-offset: 2px;
}

.message-feedback-share-note,
.message-feedback-share-status {
  margin: 0.42rem 0 0;
  color: inherit;
  font-size: 0.68rem;
  line-height: 1.4;
  opacity: 0.72;
}

.message-feedback-share-status:empty {
  display: none;
}

@media (max-width: 560px) {
  .message-feedback-share-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .message-feedback-share-button {
    width: 100%;
  }
}
`;
  }

  requireText(text, ".message-feedback-share {", "the share editor styles");
  requireText(text, ".message-feedback-share-button {", "the share buttons");
  return text;
});

await update("src/impact-events.js", (source) => {
  let text = source.replace(
    /const IMPACT_ASSET_VERSION = "[^"]+";/,
    'const IMPACT_ASSET_VERSION = "20260806-shareable-next-step-1";',
  );

  if (!text.includes("The optional copy/share editor stays in the browser")) {
    const marker =
      "        improve Stabilize. Do not include private or identifying information.";
    requireText(text, marker, "the response-quality privacy disclosure");
    text = text.replace(
      marker,
      `        improve Stabilize. The optional copy/share editor stays in the browser;
        only text the user enters into that field is passed to the clipboard or the
        operating-system share sheet, and it is not sent to impact analytics. Do not
        include private or identifying information.`,
    );
  }

  requireText(text, "20260806-shareable-next-step-1", "the share asset version");
  requireText(
    text,
    "The optional copy/share editor stays in the browser",
    "the share privacy disclosure",
  );
  return text;
});

await update("public/privacy.html", (source) => {
  let text = source;
  if (!text.includes('id="sharing-a-next-step"')) {
    const marker = "      <h2>Paid model choice on the web</h2>";
    requireText(text, marker, "the privacy-page insertion point");
    const section = `      <h2 id="sharing-a-next-step">Copying or sharing a next step</h2>
      <p>
        After positive response feedback or selection of a suggested next step, the web
        interface may offer an optional editor for copying or sharing one user-written
        next step. Stabilize does not automatically place the conversation or assistant
        response into that editor. Only the text the user enters there and the Stabilize
        link are passed to the browser clipboard or operating-system share sheet. That
        editor text is not submitted to Stabilize impact analytics.
      </p>

`;
    text = text.replace(marker, section + marker);
  }

  requireText(text, 'id="sharing-a-next-step"', "the share privacy section");
  return text;
});

await update("test/product.test.mjs", (source) => {
  let text = source;
  text = text.replace(
    "  assert.match(pageSource, /Get one clear next step/);",
    "  assert.match(pageSource, /page\\.promise/);",
  );
  requireText(text, "assert.match(pageSource, /page\\.promise/);", "the product-promise test");
  return text;
});

console.log("Added a canonical promise and a privacy-bounded shareable next-step loop.");

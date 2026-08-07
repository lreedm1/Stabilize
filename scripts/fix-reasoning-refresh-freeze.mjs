import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Reasoning refresh fix could not find ${label}`);
  }
}

await update("public/reasoning-choice.js", (source) => {
  let text = source;

  const oldSummary = `    const modelLabel = modelLabelForPicker(picker);
    current.dataset.baseModelLabel = modelLabel;
    current.textContent = \`${"${modelLabel} · ${effort.shortLabel}"}\`;
    if (summary instanceof HTMLElement) {
      summary.setAttribute(
        "aria-label",
        \`Choose AI model and thinking level. Current: ${"${modelLabel}"}, ${"${effort.label}"}.\`,
      );
    }`;
  const stableSummary = `    const modelLabel = modelLabelForPicker(picker);
    const nextText = \`${"${modelLabel} · ${effort.shortLabel}"}\`;
    const nextAriaLabel =
      \`Choose AI model and thinking level. Current: ${"${modelLabel}"}, ${"${effort.label}"}.\`;
    current.dataset.baseModelLabel = modelLabel;
    if (current.textContent !== nextText) current.textContent = nextText;
    if (
      summary instanceof HTMLElement &&
      summary.getAttribute("aria-label") !== nextAriaLabel
    ) {
      summary.setAttribute("aria-label", nextAriaLabel);
    }`;
  if (text.includes(oldSummary)) text = text.replace(oldSummary, stableSummary);

  text = text.replace(
    `    if (maximum instanceof HTMLOptionElement) maximum.disabled = !enabled;`,
    `    if (
      maximum instanceof HTMLOptionElement &&
      maximum.disabled !== !enabled
    ) {
      maximum.disabled = !enabled;
    }`,
  );

  text = text.replace(
    `    if (select instanceof HTMLSelectElement) select.value = selected;`,
    `    if (
      select instanceof HTMLSelectElement &&
      select.value !== selected
    ) {
      select.value = selected;
    }`,
  );

  const broadObserver = `const observer = new MutationObserver(mountThinkingControls);
observer.observe(document.documentElement, { childList: true, subtree: true });
mountThinkingControls();`;
  const oneShotMount = `function initializeThinkingControls() {
  mountThinkingControls();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeThinkingControls,
    { once: true },
  );
} else {
  initializeThinkingControls();
}`;
  if (text.includes(broadObserver)) text = text.replace(broadObserver, oneShotMount);

  requireText(text, "const nextText =", "idempotent summary rendering");
  requireText(text, "current.textContent !== nextText", "the guarded text update");
  requireText(text, 'document.readyState === "loading"', "the one-shot startup");
  requireText(text, '"DOMContentLoaded"', "the DOM-ready mount");
  if (text.includes("new MutationObserver(mountThinkingControls)")) {
    throw new Error("The page-wide reasoning MutationObserver is still present");
  }
  return text;
});

await update("src/page.js", (source) => {
  const text = source.replaceAll(
    "20260807-instant-thinking-1",
    "20260807-instant-thinking-2",
  );
  requireText(
    text,
    "reasoning-choice.js?v=20260807-instant-thinking-2",
    "the refreshed reasoning asset URL",
  );
  return text;
});

await update("test/model-catalog-usage.test.mjs", (source) => {
  let text = source.replaceAll(
    "reasoning-choice\\.js\\?v=20260807-instant-thinking-1",
    "reasoning-choice\\.js\\?v=20260807-instant-thinking-2",
  );

  if (!text.includes("assert.doesNotMatch(reasoningClient, /new MutationObserver/);")) {
    const marker =
      "  assert.match(reasoningClient, /body\\.reasoningEffort = reasoningEffort/);";
    requireText(text, marker, "the reasoning client assertion anchor");
    text = text.replace(
      marker,
      `${marker}
  assert.doesNotMatch(reasoningClient, /new MutationObserver/);
  assert.match(reasoningClient, /DOMContentLoaded/);
  assert.match(reasoningClient, /current\\.textContent !== nextText/);`,
    );
  }
  return text;
});

await update("test/prompt-policy-idempotency.test.mjs", (source) => {
  let text = source;
  if (!text.includes('"scripts/fix-reasoning-refresh-freeze.mjs"')) {
    const marker = '  "scripts/add-instant-thinking-menu.mjs",\n';
    requireText(text, marker, "the instant-thinking fixture");
    text = text.replace(
      marker,
      `${marker}  "scripts/fix-reasoning-refresh-freeze.mjs",\n`,
    );
  }
  return text;
});

console.log("Removed the refresh loop from the reasoning selector.");

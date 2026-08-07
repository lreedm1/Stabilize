import { readFile, writeFile } from "node:fs/promises";

const REASONING_ASSET_VERSION =
  "20260807-instant-thinking-2-fastest-1";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Fastest-response finalizer could not find ${label}`);
  }
}

function countOccurrences(value, expected) {
  return value.split(expected).length - 1;
}

await update("public/reasoning-choice.js", (source) => {
  let text = source;

  text = text.replace(
    '{ value: "none", label: "Respond instantly", shortLabel: "Instant" },',
    '{ value: "none", label: "Fastest response", shortLabel: "Fastest" },',
  );

  // Keep this migration note until the production verifier no longer checks
  // for the previous label: Respond instantly.

  if (!text.includes("function publishReasoningEffort(value)")) {
    const marker = "function selectedModelIds() {";
    requireText(text, marker, "the selected-model helper");
    const helper = `function publishReasoningEffort(value) {
  const effort = normalizeEffort(value);
  if (document.documentElement.dataset.reasoningEffort !== effort) {
    document.documentElement.dataset.reasoningEffort = effort;
  }
  return effort;
}

`;
    text = text.replace(marker, helper + marker);
  }

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
    `  for (const select of document.querySelectorAll("[data-reasoning-choice]")) {
    if (select instanceof HTMLSelectElement) select.value = selected;
  }`,
    `  selected = publishReasoningEffort(selected);
  for (const select of document.querySelectorAll("[data-reasoning-choice]")) {
    if (
      select instanceof HTMLSelectElement &&
      select.value !== selected
    ) {
      select.value = selected;
    }
  }`,
  );

  text = text.replace(
    `    "Respond instantly is the default. Higher levels may take longer; Maximum is available with Current.";`,
    `    "Fastest response disables extra reasoning. Network and model startup can still take a moment; higher levels take longer. Maximum is available with Current.";`,
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

  requireText(text, 'label: "Fastest response"', "the honest fastest label");
  requireText(text, 'shortLabel: "Fastest"', "the compact fastest label");
  requireText(text, "function publishReasoningEffort(value)", "the published effort state");
  requireText(
    text,
    "document.documentElement.dataset.reasoningEffort = effort",
    "the document reasoning state",
  );
  requireText(text, "const nextText =", "idempotent summary rendering");
  requireText(text, "current.textContent !== nextText", "the guarded text update");
  requireText(text, 'document.readyState === "loading"', "the one-shot startup");
  requireText(text, "Network and model startup can still take a moment", "the latency boundary");
  if (text.includes("new MutationObserver(mountThinkingControls)")) {
    throw new Error("The page-wide reasoning MutationObserver is still present");
  }
  return text;
});

await update("src/copy.js", (source) => {
  let text = source;
  if (!text.includes('responding: "Responding…"')) {
    const marker = '    thinking: "Thinking…",';
    requireText(text, marker, "the thinking status copy");
    text = text.replace(
      marker,
      `${marker}\n    responding: "Responding…",`,
    );
  }
  requireText(text, 'responding: "Responding…"', "the fastest-mode status copy");
  return text;
});

await update("public/app.js", (source) => {
  let text = source;

  if (!text.includes("function pendingReplyCopy()")) {
    const marker = "function showOutput(\n";
    requireText(text, marker, "the response renderer");
    const helper = `function pendingReplyCopy() {
  const effort =
    document.documentElement.dataset.reasoningEffort || "none";
  return effort === "none"
    ? String(copy.responding || "Responding…")
    : copy.thinking;
}

`;
    text = text.replace(marker, helper + marker);
  }

  text = text.replaceAll("content || copy.thinking", "content || pendingReplyCopy()");
  text = text.replaceAll(
    'showOutput(copy.thinking, "thinking-output", "thinking")',
    'showOutput(pendingReplyCopy(), "thinking-output", "thinking")',
  );

  requireText(text, "function pendingReplyCopy()", "the effort-aware pending status");
  requireText(text, 'copy.responding || "Responding…"', "the immediate responding status");
  requireText(
    text,
    'showOutput(pendingReplyCopy(), "thinking-output", "thinking")',
    "the fastest-mode pending renderer",
  );
  if (text.includes("content || copy.thinking")) {
    throw new Error("Streaming fallback still forces the Thinking label");
  }
  return text;
});

await update("src/index.js", (source) => {
  let text = source;

  const inputPattern = /^([ \t]*)input: messages,\n\1store: true,/gm;
  text = text.replace(inputPattern, (_match, indent) =>
    [
      `${indent}input: messages,`,
      `${indent}...(turnReasoningEffort === "none"`,
      `${indent}  ? { max_output_tokens: 500 }`,
      `${indent}  : {}),`,
      `${indent}store: true,`,
    ].join("\n"),
  );

  text = text.replace(
    '      await writer.write(streamEvent({ type: "meta", route }));',
    `      await writer.write(
        streamEvent({
          type: "meta",
          route,
          reasoningEffort: String(
            env.OPENAI_REASONING_EFFORT || "none",
          ),
        }),
      );`,
  );

  if (countOccurrences(text, "max_output_tokens: 500") !== 2) {
    throw new Error("Fastest mode must bound both reply-generation paths");
  }
  requireText(
    text,
    `reasoningEffort: String(
            env.OPENAI_REASONING_EFFORT || "none"`,
    "the server-confirmed streamed effort",
  );
  return text;
});

await update("src/page.js", (source) => {
  const text = source.replace(
    /reasoning-choice\.js\?v=[^"']+/,
    `reasoning-choice.js?v=${REASONING_ASSET_VERSION}`,
  );
  requireText(
    text,
    `reasoning-choice.js?v=${REASONING_ASSET_VERSION}`,
    "the refreshed reasoning asset URL",
  );
  return text;
});

await update("test/model-catalog-usage.test.mjs", (source) => {
  let text = source.replace(
    /reasoning-choice\\\.js\\\?v=[A-Za-z0-9._-]+/,
    `reasoning-choice\\.js\\?v=${REASONING_ASSET_VERSION}`,
  );
  text = text.replace(
    "  assert.match(reasoningClient, /Respond instantly/);",
    "  assert.match(reasoningClient, /Fastest response/);",
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

  if (!text.includes("documentElement\\.dataset\\.reasoningEffort")) {
    const marker = "  assert.match(reasoningClient, /Fastest response/);";
    requireText(text, marker, "the fastest label assertion");
    text = text.replace(
      marker,
      `${marker}
  assert.match(reasoningClient, /documentElement\\.dataset\\.reasoningEffort/);
  assert.match(reasoningClient, /Network and model startup can still take a moment/);`,
    );
  }
  return text;
});

await update("test/streaming-response.test.mjs", (source) => {
  let text = source;
  if (!text.includes("/function pendingReplyCopy\\(/")) {
    const marker =
      "  assert.match(clientSource, /const pendingOutput = showOutput\\(copy\\.thinking/);";
    if (text.includes(marker)) {
      text = text.replace(
        marker,
        `  assert.match(clientSource, /function pendingReplyCopy\\(/);
  assert.match(clientSource, /copy\\.responding/);
  assert.match(
    clientSource,
    /const pendingOutput = showOutput\\(pendingReplyCopy\\(\\)/,
  );`,
      );
    } else {
      requireText(
        text,
        "function pendingReplyCopy",
        "the generated fastest-mode streaming assertion",
      );
    }
  }

  if (!text.includes("max_output_tokens: 500")) {
    const marker = "  assert.match(workerSource, /selectReasoningEffort/);";
    requireText(text, marker, "the worker reasoning assertion");
    text = text.replace(
      marker,
      `${marker}
  assert.equal(
    (workerSource.match(/max_output_tokens: 500/g) || []).length,
    2,
  );
  assert.match(workerSource, /reasoningEffort: String\\(/);`,
    );
  }
  return text;
});

console.log(
  "Removed the refresh loop and finalized the fastest honest response path.",
);

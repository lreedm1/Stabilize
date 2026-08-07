import { readFile, writeFile } from "node:fs/promises";

const FREE_PRIMARY_MODEL = "gpt-5.6-sol";
const FREE_FALLBACK_MODEL = "gpt-5.4";
const FREE_DAILY_LIMIT = 50;

async function update(path, transform, { optional = false } = {}) {
  let before;
  try {
    before = await readFile(path, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return;
    throw error;
  }
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Free GPT-5.6 client policy could not find ${label}`);
  }
}

function replaceBlock(value, startMarker, endMarker, replacement, label) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Free GPT-5.6 client policy could not replace ${label}`);
  }
  return value.slice(0, start) + replacement + value.slice(end);
}

await update("public/billing-client.js", (source) => {
  let text = source;
  text = text.replaceAll(
    " free model-select messages used today. The allowance resets at 00:00 UTC, and the default model does not count.",
    " free GPT-5.6 Instant messages used today. Stabilize switches to GPT-5.4 after this allowance; it resets at 00:00 UTC.",
  );

  const usageDisplay = `function updateModelUsageDisplay(usage) {
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
    const label = usage.selectedModel === "${FREE_PRIMARY_MODEL}"
      ? "5.6"
      : usage.selectedModel === "${FREE_FALLBACK_MODEL}"
        ? "5.4"
        : "Model";
    for (const current of document.querySelectorAll(
      ".composer-model-current",
    )) {
      if (current instanceof HTMLElement) current.textContent = label;
    }
  }
}

`;
  text = replaceBlock(
    text,
    "function updateModelUsageDisplay(",
    "globalThis.fetch = async",
    usageDisplay,
    "the live model and usage display",
  );

  const fallbackNotice = `function showModelFallbackNotice(defaultModel, limit = ${FREE_DAILY_LIMIT}) {
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
    " GPT-5.6 Instant messages. Stabilize switched to GPT-5.4 automatically; your message was still sent.";
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

`;
  text = replaceBlock(
    text,
    "function showModelFallbackNotice(",
    "const stabilizeModelFallbackFetch =",
    fallbackNotice,
    "the free-plan fallback notice",
  );
  text = text.replace(
    `    showModelFallbackNotice(
      response.headers.get("X-Stabilize-Model-Selected") || "gpt-5.4",
    );`,
    `    showModelFallbackNotice(
      response.headers.get("X-Stabilize-Model-Selected") || "gpt-5.4",
      Number(response.headers.get("X-Stabilize-Model-Usage-Limit")) ||
        ${FREE_DAILY_LIMIT},
    );`,
  );

  for (const expected of [
    "free GPT-5.6 Instant messages used today",
    "Stabilize switched to GPT-5.4 automatically",
    'usage.selectedModel === "gpt-5.6-sol"',
    "X-Stabilize-Model-Usage-Limit",
    "current.textContent = compactModelTileLabel(defaultModel);",
  ]) {
    requireText(text, expected, expected);
  }
  return text;
});

await update(
  "docs/STRIPE_MODEL_CHOICE_SETUP.md",
  (source) =>
    source
      .replaceAll(
        "20 free model-select messages per UTC day",
        "50 automatic GPT-5.6 Instant messages per UTC day, followed by GPT-5.4",
      )
      .replaceAll(
        "20 free model-select messages",
        "50 automatic GPT-5.6 Instant messages",
      ),
  { optional: true },
);

console.log(
  "Aligned the free-plan usage display and GPT-5.4 fallback notice.",
);

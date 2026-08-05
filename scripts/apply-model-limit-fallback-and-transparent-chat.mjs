import { readFile, writeFile } from "node:fs/promises";

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Model fallback update could not find ${label}`);
  }
}

async function replaceLegacyExpectation(path, legacy, replacement, label) {
  const before = await readFile(path, "utf8");
  let after = before;
  if (after.includes(legacy)) after = after.replace(legacy, replacement);
  else requireText(after, replacement, label);
  if (after !== before) await writeFile(path, after);
}

const workerPath = "src/paid-worker.js";
const workerBefore = await readFile(workerPath, "utf8");
let workerAfter = workerBefore;

if (!workerAfter.includes('X-Stabilize-Model-Fallback')) {
  const deniedPattern = /  if \(!reservation\.allowed\) \{[\s\S]*?\n  \}\n\n  const response = await originalWorker\.fetch\(/;
  const deniedMatch = workerAfter.match(deniedPattern);
  if (!deniedMatch) {
    throw new Error("Model fallback update could not find the quota denial block");
  }

  const replacement = `  if (!reservation.allowed) {
    if (tier === "free") {
      await stub.setSelectedModel(defaultModel);
      const fallbackResponse = await originalWorker.fetch(
        request,
        modelEnvironment(env, defaultModel),
        ctx,
      );
      const headers = new Headers(fallbackResponse.headers);
      headers.set("X-Stabilize-Model-Fallback", "daily-limit");
      headers.set("X-Stabilize-Model-Selected", defaultModel);
      headers.set("X-Stabilize-Model-Usage-Tier", tier);
      headers.set("X-Stabilize-Model-Usage-Used", String(limit));
      headers.set("X-Stabilize-Model-Usage-Limit", String(limit));
      headers.set("X-Stabilize-Model-Usage-Period", period);
      return new Response(fallbackResponse.body, {
        status: fallbackResponse.status,
        statusText: fallbackResponse.statusText,
        headers,
      });
    }

    return jsonResponse(
      {
        error:
          "The monthly subscriber model-message limit has been reached. Stabilize default remains available.",
      },
      429,
    );
  }

  const response = await originalWorker.fetch(`;
  workerAfter = workerAfter.replace(deniedPattern, replacement);
}

for (const expected of [
  'await stub.setSelectedModel(defaultModel)',
  'X-Stabilize-Model-Fallback',
  '"daily-limit"',
  'modelEnvironment(env, defaultModel)',
]) {
  requireText(workerAfter, expected, expected);
}
if (workerAfter !== workerBefore) await writeFile(workerPath, workerAfter);

const clientPath = "public/billing-client.js";
const clientBefore = await readFile(clientPath, "utf8");
let clientAfter = clientBefore;

if (!clientAfter.includes("function showModelFallbackNotice(")) {
  clientAfter += `

function showModelFallbackNotice(defaultModel) {
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
    "You used today’s 20 selected-model messages. Stabilize switched to GPT-5.4 automatically; your message was still sent.";

  for (const select of document.querySelectorAll(
    '#model-choice, #composer-model-choice',
  )) {
    if (select instanceof HTMLSelectElement) select.value = defaultModel;
  }
  for (const current of document.querySelectorAll(".composer-model-current")) {
    if (current instanceof HTMLElement) current.textContent = "Default";
  }
}

const stabilizeModelFallbackFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (...args) => {
  const response = await stabilizeModelFallbackFetch(...args);
  if (
    chatRequestPath(args[0]) === "/api/chat" &&
    response.headers.get("X-Stabilize-Model-Fallback") === "daily-limit"
  ) {
    showModelFallbackNotice(
      response.headers.get("X-Stabilize-Model-Selected") || "gpt-5.4",
    );
  }
  return response;
};
`;
}

for (const expected of [
  "function showModelFallbackNotice(",
  'X-Stabilize-Model-Fallback',
  "switched to GPT-5.4 automatically",
]) {
  requireText(clientAfter, expected, expected);
}
if (clientAfter !== clientBefore) await writeFile(clientPath, clientAfter);

const stylesPath = "public/styles.css";
const stylesBefore = await readFile(stylesPath, "utf8");
let stylesAfter = stylesBefore;
const transparentStyles = `

/* Keep the landscape visible behind the current conversation. */
.chat-log,
.assistant-output {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

.model-fallback-notice {
  width: min(760px, 100%);
  margin: 0 auto 8px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 12px;
  background: rgba(255, 252, 242, 0.9);
  box-shadow: 0 5px 18px rgba(5, 25, 18, 0.16);
  color: var(--text);
  padding: 9px 12px;
  font-size: 0.78rem;
  font-weight: 620;
  line-height: 1.4;
  text-align: center;
}
`;
if (!stylesAfter.includes(".model-fallback-notice")) {
  stylesAfter += transparentStyles;
}
for (const expected of [
  ".chat-log,\n.assistant-output",
  "background: transparent",
  ".model-fallback-notice",
]) {
  requireText(stylesAfter, expected, expected);
}
if (stylesAfter !== stylesBefore) await writeFile(stylesPath, stylesAfter);

const paidWorkerLegacy = `    assert.equal(blocked.status, 429);
    assert.match(
      (await blocked.json()).error,
      /daily free model-select limit of 2 messages has been reached/i,
    );
    assert.equal(providerBody.model, "gpt-5.1");`;
const paidWorkerFallback = `    assert.equal(blocked.status, 200);
    assert.equal(blocked.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(blocked.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal((await blocked.json()).reply, "Use the smallest reversible step.");
    assert.equal(providerBody.model, "gpt-5.4");`;
await replaceLegacyExpectation(
  "test/paid-worker.test.mjs",
  paidWorkerLegacy,
  paidWorkerFallback,
  "the free-user fallback test",
);

const usageLegacy = `    assert.equal(blocked.status, 429);
    assert.match(
      (await blocked.json()).error,
      /daily free model-select limit of 2 messages has been reached/i,
    );
    assert.ok(
      providerModels.filter((model) => model === "gpt-5.6-terra").length >= 2,
    );`;
const usageFallback = `    assert.equal(blocked.status, 200);
    assert.equal(blocked.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(blocked.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal((await blocked.json()).reply, "Use the smallest reversible step.");
    assert.ok(
      providerModels.filter((model) => model === "gpt-5.6-terra").length >= 2,
    );
    assert.equal(providerModels.at(-1), "gpt-5.4");
    const fallbackState = await user.billing.readState();
    assert.equal(fallbackState.selectedModel, "gpt-5.4");`;
await replaceLegacyExpectation(
  "test/model-usage-worker.test.mjs",
  usageLegacy,
  usageFallback,
  "the persistent fallback usage test",
);

console.log(
  "Applied 20-message automatic GPT-5.4 fallback and transparent chat surfaces.",
);

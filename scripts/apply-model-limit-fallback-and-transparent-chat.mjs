import { readFile, writeFile } from "node:fs/promises";

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Model fallback update could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/paid-worker.js", (source) => {
  let text = source;
  if (!text.includes('X-Stabilize-Model-Fallback')) {
    const deniedPattern = /  if \(!reservation\.allowed\) \{[\s\S]*?\n  \}\n\n  const response = await originalWorker\.fetch\(/;
    if (!deniedPattern.test(text)) {
      throw new Error("Model fallback update could not find the quota denial block");
    }
    text = text.replace(
      deniedPattern,
      `  if (!reservation.allowed) {
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

  const response = await originalWorker.fetch(`,
    );
  }
  for (const expected of [
    "await stub.setSelectedModel(defaultModel)",
    "X-Stabilize-Model-Fallback",
    '"daily-limit"',
    "modelEnvironment(env, defaultModel)",
  ]) requireText(text, expected, expected);
  return text;
});

await update("public/billing-client.js", (source) => {
  let text = source;
  if (!text.includes("function showModelFallbackNotice(")) {
    text += `

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
    "X-Stabilize-Model-Fallback",
    "switched to GPT-5.4 automatically",
  ]) requireText(text, expected, expected);
  return text;
});

await update("public/styles.css", (source) => {
  let text = source;
  if (!text.includes(".model-fallback-notice")) {
    text += `

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
  }
  requireText(text, ".chat-log,\n.assistant-output", "transparent chat surfaces");
  requireText(text, ".model-fallback-notice", "fallback notice styling");
  return text;
});

await update("test/paid-worker.test.mjs", (source) => {
  let text = source;
  text = text.replace(
    /    assert\.equal\(blocked\.status, 429\);\n    assert\.match\(\n      \(await blocked\.json\(\)\)\.error,\n      \/daily free model-select limit of 2 messages has been reached\/i,\n    \);\n    assert\.equal\(providerBody\.model, "gpt-5\.1"\);/,
    `    assert.equal(blocked.status, 200);
    assert.equal(blocked.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(
      blocked.headers.get("X-Stabilize-Model-Selected"),
      limitedEnv.OPENAI_MODEL,
    );
    assert.equal((await blocked.json()).reply, "Use the smallest reversible step.");
    assert.equal(providerBody.model, limitedEnv.OPENAI_MODEL);`,
  );
  text = text.replaceAll(
    'assert.equal(blocked.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");',
    `assert.equal(
      blocked.headers.get("X-Stabilize-Model-Selected"),
      limitedEnv.OPENAI_MODEL,
    );`,
  );
  text = text.replaceAll(
    'assert.equal(providerBody.model, "gpt-5.4");',
    "assert.equal(providerBody.model, limitedEnv.OPENAI_MODEL);",
  );
  requireText(text, "limitedEnv.OPENAI_MODEL", "configured-default paid-worker assertion");
  return text;
});

await update("test/model-usage-worker.test.mjs", (source) => {
  let text = source;
  text = text.replace(
    /    assert\.equal\(blocked\.status, 429\);\n    assert\.match\(\n      \(await blocked\.json\(\)\)\.error,\n      \/daily free model-select limit of 2 messages has been reached\/i,\n    \);\n    assert\.ok\(\n      providerModels\.filter\(\(model\) => model === "gpt-5\.6-terra"\)\.length >= 2,\n    \);/,
    `    assert.equal(blocked.status, 200);
    assert.equal(blocked.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(
      blocked.headers.get("X-Stabilize-Model-Selected"),
      BASE_ENV.OPENAI_MODEL,
    );
    assert.equal((await blocked.json()).reply, "Use the smallest reversible step.");
    assert.ok(
      providerModels.filter((model) => model === "gpt-5.6-terra").length >= 2,
    );
    assert.equal(providerModels.at(-1), BASE_ENV.OPENAI_MODEL);
    const fallbackState = await user.billing.readState();
    assert.equal(fallbackState.selectedModel, BASE_ENV.OPENAI_MODEL);`,
  );
  text = text.replaceAll(
    'assert.equal(blocked.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");',
    `assert.equal(
      blocked.headers.get("X-Stabilize-Model-Selected"),
      BASE_ENV.OPENAI_MODEL,
    );`,
  );
  text = text.replaceAll(
    'assert.equal(providerModels.at(-1), "gpt-5.4");',
    "assert.equal(providerModels.at(-1), BASE_ENV.OPENAI_MODEL);",
  );
  text = text.replaceAll(
    'assert.equal(fallbackState.selectedModel, "gpt-5.4");',
    "assert.equal(fallbackState.selectedModel, BASE_ENV.OPENAI_MODEL);",
  );
  requireText(text, "fallbackState.selectedModel, BASE_ENV.OPENAI_MODEL", "configured-default usage assertion");
  return text;
});

console.log(
  "Applied 20-message automatic GPT-5.4 fallback and transparent chat surfaces.",
);

import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`New-conversation policy could not find ${label}`);
  }
}

await update("src/copy.js", (source) => {
  let text = source;

  if (!text.includes('newConversationButton: "New conversation"')) {
    const anchor = '      sendButton: "Send",';
    requireText(text, anchor, "the chat button copy anchor");
    text = text.replace(
      anchor,
      `${anchor}\n      newConversationButton: "New conversation",`,
    );
  }

  if (!text.includes("newConversationFailed:")) {
    const anchor = '    errorReferenceLabel: "Error reference",';
    requireText(text, anchor, "the client error copy anchor");
    text = text.replace(
      anchor,
      `${anchor}\n    newConversationFailed:\n      "Stabilize couldn't start a new conversation. Try again.",`,
    );
  }

  requireText(
    text,
    'newConversationButton: "New conversation"',
    "the new-conversation label",
  );
  requireText(text, "newConversationFailed:", "the reset error copy");
  return text;
});

await update("src/page.js", (source) => {
  let text = source;

  if (!text.includes('id="new-conversation-button"')) {
    const anchor = `            <div class="menu-panel">
              <nav class="menu-links" aria-label="Site pages">`;
    requireText(text, anchor, "the menu panel anchor");
    text = text.replace(
      anchor,
      `            <div class="menu-panel">
              <button
                id="new-conversation-button"
                class="new-conversation-button"
                type="button"
              >${"${escapeHtml(page.chat.newConversationButton)}"}</button>
              <nav class="menu-links" aria-label="Site pages">`,
    );
  }

  text = text.replace(
    '<link rel="stylesheet" href="/seo.css" />',
    '<link rel="stylesheet" href="/seo.css?v=20260804-new-conversation-1" />',
  );
  text = text.replace(
    /<script type="module" src="\/app\.js\?v=[^"]+"><\/script>/,
    '<script type="module" src="/app.js?v=20260804-new-conversation-1"></script>',
  );

  requireText(text, 'id="new-conversation-button"', "the menu button");
  requireText(
    text,
    '/app.js?v=20260804-new-conversation-1',
    "the client cache key",
  );
  return text;
});

await update("public/seo.css", (source) => {
  if (source.includes(".new-conversation-button")) return source;

  const anchor = ".menu-links {";
  requireText(source, anchor, "the menu link styles");
  const styles = `.new-conversation-button {
  display: flex;
  width: 100%;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--accent-dark);
  border-radius: 10px;
  background: var(--accent);
  color: white;
  cursor: pointer;
  padding: 10px 12px;
  font-size: 0.88rem;
  font-weight: 780;
  line-height: 1.25;
}

.new-conversation-button:hover,
.new-conversation-button:focus-visible {
  background: var(--accent-dark);
}

.new-conversation-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.new-conversation-button + .menu-links {
  margin-top: 8px;
  border-top: 1px solid var(--line);
  padding-top: 8px;
}

`;
  return source.replace(anchor, styles + anchor);
});

await update("src/session-memory.js", (source) => {
  if (source.includes("async startNewConversation()")) return source;

  const anchor = "  async getCompactionSnapshot() {";
  requireText(source, anchor, "the memory compaction method");
  const method = `  async startNewConversation() {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM recent_messages");
      this.ctx.storage.sql.exec(
        \`UPDATE memory_state
         SET awaiting_safety_answer = 0
         WHERE id = 1\`,
      );
    });

    return { started: true };
  }

`;
  return source.replace(anchor, method + anchor);
});

await update("src/index.js", (source) => {
  let text = source;

  if (!text.includes("async function handleNewConversation(")) {
    const anchor = "async function handleChat(request, env, ctx, accountKey) {";
    requireText(text, anchor, "the chat handler");
    const helper = `async function handleNewConversation(env, accountKey) {
  const stub = accountMemoryStub(env, accountKey);
  if (stub && typeof stub.startNewConversation === "function") {
    await stub.startNewConversation();
  }
  return jsonResponse({ ok: true });
}

`;
    text = text.replace(anchor, helper + anchor);
  }

  if (!text.includes('url.pathname === "/api/conversation/new"')) {
    const anchor = `      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") {`;
    requireText(text, anchor, "the chat API route");
    const route = `      if (url.pathname === "/api/conversation/new") {
        if (request.method !== "POST") {
          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
        }
        if (!sameOriginOrNonBrowser(request)) {
          return jsonResponse({ error: COPY.api.crossOriginRequest }, 403);
        }
        const authSession = await readAuthSession(request, env);
        return await handleNewConversation(env, authSession?.accountKey);
      }

`;
    text = text.replace(anchor, route + anchor);
  }

  requireText(
    text,
    'url.pathname === "/api/conversation/new"',
    "the new-conversation API route",
  );
  requireText(text, "stub.startNewConversation()", "the memory boundary call");
  return text;
});

await update("public/app.js", (source) => {
  let text = source;

  if (!text.includes("const newConversationButton = document.querySelector(")) {
    const anchor =
      'const signOutForm = document.querySelector(\'form[action="/auth/logout"]\');';
    requireText(text, anchor, "the sign-out selector");
    text = text.replace(
      anchor,
      `${anchor}\nconst newConversationButton = document.querySelector(\n  "#new-conversation-button",\n);\nconst siteMenu = document.querySelector(".site-menu");`,
    );
  }

  if (!text.includes("async function startNewConversation()")) {
    const anchor = "function setPending(value) {";
    requireText(text, anchor, "the pending-state helper");
    const functions = `function resetConversationView() {
  clearPersistedAnswer();
  awaitingSafetyAnswer = false;
  awaitingSafetyAnswerSince = null;
  lastSubmittedText = "";
  nextVisibleUserText = "";
  activeAssistantOutput = null;
  input.value = "";
  chatLog.replaceChildren();
  chatLog.hidden = true;
  chatLog.tabIndex = -1;
  conversationSurface.dataset.view = "compose";
}

async function startNewConversation() {
  if (pending || !(newConversationButton instanceof HTMLButtonElement)) return;
  if (siteMenu instanceof HTMLDetailsElement) siteMenu.open = false;

  setPending(true);
  try {
    const response = await fetch("/api/conversation/new", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("New conversation request failed");
    resetConversationView();
  } catch {
    showOutput(copy.newConversationFailed, "error-output");
  } finally {
    setPending(false);
    input.focus({ preventScroll: true });
  }
}

`;
    text = text.replace(anchor, functions + anchor);
  }

  if (!text.includes("newConversationButton.disabled = value")) {
    const anchor = "  sendButton.disabled = value;";
    requireText(text, anchor, "the send-button pending state");
    text = text.replace(
      anchor,
      `${anchor}\n  if (newConversationButton instanceof HTMLButtonElement) {\n    newConversationButton.disabled = value;\n  }`,
    );
  }

  if (!text.includes('newConversationButton.addEventListener("click"')) {
    const anchor = "if (signOutForm instanceof HTMLFormElement) {";
    requireText(text, anchor, "the sign-out listener");
    const listener = `if (newConversationButton instanceof HTMLButtonElement) {
  newConversationButton.addEventListener("click", () => {
    void startNewConversation();
  });
}

`;
    text = text.replace(anchor, listener + anchor);
  }

  requireText(
    text,
    'fetch("/api/conversation/new"',
    "the new-conversation request",
  );
  requireText(
    text,
    'conversationSurface.dataset.view = "compose"',
    "the clean compose view",
  );
  requireText(
    text,
    "awaitingSafetyAnswerSince = null",
    "the safety-question reset",
  );
  return text;
});

await update("test/worker.test.mjs", (source) => {
  let text = source;

  if (!text.includes("async startNewConversation()")) {
    const anchor = "        async getCompactionSnapshot() {";
    requireText(text, anchor, "the fake memory compaction method");
    const method = `        async startNewConversation() {
          const state = states.get(name) || freshState();
          state.recent = [];
          state.awaitingSafetyAnswer = false;
          states.set(name, state);
          return { started: true };
        },
`;
    text = text.replace(anchor, method + anchor);
  }

  const marker = 'test("chat endpoint applies deterministic emergency routing"';
  if (
    !text.includes(
      'test("new conversation clears the active thread without deleting account memory"',
    )
  ) {
    requireText(text, marker, "the worker-test insertion point");
    const tests = `test("new conversation clears the active thread without deleting account memory", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "new-conversation-user");
  const stub = memory.getByName(identity.objectName);

  await stub.recordExchange({
    user: "I prefer concise plans.",
    assistant: "I will keep the next step short.",
    awaitingSafetyAnswer: false,
  });
  const snapshot = await stub.getCompactionSnapshot();
  await stub.applySummary(
    "The user prefers concise plans.",
    snapshot.summaryVersion,
    snapshot.throughSequence,
  );
  await stub.recordExchange({
    user: "This belongs to the current thread.",
    assistant: "Current-thread response.",
    awaitingSafetyAnswer: true,
  });

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/conversation/new", {
      method: "POST",
      headers: {
        Origin: "https://stabilize.test",
        Cookie: identity.cookie,
      },
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const context = await stub.readContext();
  assert.equal(context.summary, "The user prefers concise plans.");
  assert.deepEqual(context.recent, []);
  assert.equal(context.awaitingSafetyAnswer, false);
  assert.equal(context.turnCount, 2);
});

test("guest new conversation creates no server-side memory", async () => {
  const memory = createSessionNamespace();
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/conversation/new", {
      method: "POST",
      headers: { Origin: "https://stabilize.test" },
    }),
    createEnv({ SESSIONS: memory }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(memory.states.size, 0);
});

test("cross-origin new conversation requests are rejected", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/conversation/new", {
      method: "POST",
      headers: { Origin: "https://untrusted.example" },
    }),
    createEnv(),
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, COPY.api.crossOriginRequest);
});

`;
    text = text.replace(marker, tests + marker);
  }

  return text;
});

await update("test/session-memory.test.mjs", (source) => {
  if (
    source.includes(
      'test("starting a new conversation preserves condensed memory and clears thread state"',
    )
  ) {
    return source;
  }

  const marker = 'test("the retention alarm still erases an expired session"';
  requireText(source, marker, "the session-memory test insertion point");
  const testCase = `test("starting a new conversation preserves condensed memory and clears thread state", async () => {
  const stub = env.SESSIONS.getByName("session-memory-new-conversation");

  await stub.recordExchange({
    user: "I prefer short plans.",
    assistant: "I will keep plans short.",
    awaitingSafetyAnswer: false,
  });
  const snapshot = await stub.getCompactionSnapshot();
  assert.equal(
    await stub.applySummary(
      "The user prefers short plans.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
    ),
    true,
  );
  await stub.recordExchange({
    user: "Current thread context.",
    assistant: "Current thread reply.",
    awaitingSafetyAnswer: true,
  });

  assert.deepEqual(await stub.startNewConversation(), { started: true });
  const context = await stub.readContext();
  assert.match(context.summary, /The user prefers short plans\.$/);
  assert.deepEqual(context.recent, []);
  assert.equal(context.awaitingSafetyAnswer, false);
  assert.equal(context.turnCount, 2);
});

`;
  return source.replace(marker, testCase + marker);
});

console.log("Applied the menu-based new conversation control.");

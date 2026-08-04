import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`Private-chat policy could not find ${label}`);
  }
}

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}

await update("src/copy.js", (source) => {
  let text = source;

  if (!text.includes('privateChatButton: "Private chat"')) {
    const anchor = `    newConversationFailed:
      "Stabilize couldn't start a new conversation. Try again.",`;
    requireText(text, anchor, "the new-conversation client copy");
    const copy = `${anchor}
    privateChatButton: "Private chat",
    endPrivateChatButton: "End private chat",
    privateChatStatus: "Private chat — Stabilize memory is off.",
    privateChatMenuNote:
      "Does not use or update your Stabilize memory. Provider processing is unchanged.",`;
    text = text.replace(anchor, copy);
  }

  const oldInfo =
    "If you sign in, condensed context is remembered for 30 days and follows the same Google account.";
  const newInfo =
    "If you sign in, condensed context is remembered for 30 days and follows the same Google account. Private chat does not use or update that Stabilize memory.";
  if (text.includes(oldInfo)) text = text.replace(oldInfo, newInfo);

  requireText(text, 'privateChatButton: "Private chat"', "the private-chat label");
  requireText(text, "Provider processing is unchanged", "the provider boundary copy");
  return text;
});

await update("src/page.js", (source) => {
  let text = source;

  if (!text.includes("const privateChatControl = signedIn")) {
    const anchor = `  const headerAuthControl = signedIn
    ? \`<span class="header-auth-state">\${escapeHtml(page.auth.signedIn)}</span>\`
    : googleSignInAvailable
      ? \`<a class="google-sign-in header-google-sign-in" href="/auth/google">\${escapeHtml(page.auth.signIn)}</a>\`
      : "";`;
    requireText(text, anchor, "the header authentication control");

    const definitions = [
      anchor,
      "  const privateChatControl = signedIn",
      '    ? `<div class="private-chat-control">',
      "          <button",
      '            id="private-chat-button"',
      '            class="private-chat-button"',
      '            type="button"',
      '            aria-pressed="false"',
      "          >${escapeHtml(client.privateChatButton)}</button>",
      '          <p class="private-chat-menu-note">${escapeHtml(client.privateChatMenuNote)}</p>',
      "        </div>`",
      '    : "";',
      "  const privateChatStatus = signedIn",
      '    ? `<p id="private-chat-status" class="private-chat-status" role="status" hidden>',
      "          ${escapeHtml(client.privateChatStatus)}",
      "        </p>`",
      '    : "";',
    ].join("\n");
    text = text.replace(anchor, definitions);
  }

  if (!text.includes("${privateChatControl}")) {
    const anchor = `              >\${escapeHtml(page.chat.newConversationButton)}</button>
              <nav class="menu-links" aria-label="Site pages">`;
    requireText(text, anchor, "the generated new-conversation menu button");
    text = text.replace(
      anchor,
      `              >\${escapeHtml(page.chat.newConversationButton)}</button>
              \${privateChatControl}
              <nav class="menu-links" aria-label="Site pages">`,
    );
  }

  if (!text.includes("${privateChatStatus}")) {
    const anchor = `          <div class="composer-dock">
            <form id="chat-form" class="chat-form">`;
    requireText(text, anchor, "the composer dock");
    text = text.replace(
      anchor,
      `          <div class="composer-dock">
            \${privateChatStatus}
            <form id="chat-form" class="chat-form">`,
    );
  }

  text = text.replace(
    /<link rel="stylesheet" href="\/seo\.css(?:\?v=[^"]+)?" \/>/,
    '<link rel="stylesheet" href="/seo.css?v=20260804-private-chat-1" />',
  );
  text = text.replace(
    /<script type="module" src="\/app\.js\?v=[^"]+"><\/script>/,
    '<script type="module" src="/app.js?v=20260804-private-chat-1"></script>',
  );

  requireText(text, 'id="private-chat-button"', "the private-chat menu button");
  requireText(text, 'id="private-chat-status"', "the private-chat status indicator");
  requireText(text, "/app.js?v=20260804-private-chat-1", "the private-chat client cache key");
  return text;
});

await update("public/seo.css", (source) => {
  if (source.includes("/* Private chat control */")) return source;

  const anchor = ".menu-links {";
  requireText(source, anchor, "the menu links style anchor");
  const styles = `/* Private chat control */
.private-chat-control {
  margin-top: 8px;
}

.private-chat-button {
  display: flex;
  width: 100%;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--accent-dark);
  border-radius: 10px;
  background: rgba(255, 255, 252, 0.9);
  color: var(--accent-dark);
  cursor: pointer;
  padding: 9px 12px;
  font-size: 0.86rem;
  font-weight: 780;
  line-height: 1.25;
}

.private-chat-button:hover,
.private-chat-button:focus-visible {
  background: var(--accent-soft);
}

.private-chat-button[aria-pressed="true"] {
  background: var(--accent-dark);
  color: white;
}

.private-chat-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.private-chat-menu-note {
  margin: 6px 7px 0;
  color: var(--muted);
  font-size: 0.68rem;
  line-height: 1.4;
  text-align: center;
}

.private-chat-control + .menu-links {
  margin-top: 8px;
  border-top: 1px solid var(--line);
  padding-top: 8px;
}

.private-chat-status {
  width: fit-content;
  max-width: calc(100% - 16px);
  margin: 0 auto 7px;
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: 999px;
  background: rgba(22, 75, 57, 0.92);
  box-shadow: 0 4px 14px rgba(5, 25, 18, 0.2);
  color: white;
  padding: 6px 10px;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
}

.private-chat-status[hidden] {
  display: none;
}

`;
  return source.replace(anchor, styles + anchor);
});

await update("src/index.js", (source) => {
  let text = source;

  const bodyAnchor = `async function handleChat(request, env, ctx, accountKey) {
  const body = await readBoundedJson(request);`;
  requireText(text, bodyAnchor, "the generated chat handler body");
  if (!text.includes("const privateChat = body?.privateChat === true;")) {
    text = text.replace(
      bodyAnchor,
      `${bodyAnchor}
  const privateChat = body?.privateChat === true;`,
    );
  }

  const chatStubAnchor = `  const stub = accountMemoryStub(env, accountKey);
  const clientAwaiting = body?.awaitingSafetyAnswer === true;`;
  const privateChatStub = `  const stub = privateChat ? null : accountMemoryStub(env, accountKey);
  const clientAwaiting = body?.awaitingSafetyAnswer === true;`;
  if (text.includes(chatStubAnchor)) {
    text = text.replace(chatStubAnchor, privateChatStub);
  } else {
    requireText(text, privateChatStub, "the no-memory chat boundary");
  }

  const oldNewConversation = `async function handleNewConversation(env, accountKey) {
  const stub = accountMemoryStub(env, accountKey);
  if (stub && typeof stub.startNewConversation === "function") {
    await stub.startNewConversation();
  }
  return jsonResponse({ ok: true });
}`;
  const privateNewConversation = `async function handleNewConversation(request, env, accountKey) {
  const body = await readBoundedJson(request);
  if (body?.privateChat !== true) {
    const stub = accountMemoryStub(env, accountKey);
    if (stub && typeof stub.startNewConversation === "function") {
      await stub.startNewConversation();
    }
  }
  return jsonResponse({ ok: true });
}`;
  if (text.includes(oldNewConversation)) {
    text = text.replace(oldNewConversation, privateNewConversation);
  }

  text = text.replace(
    "return await handleNewConversation(env, authSession?.accountKey);",
    "return await handleNewConversation(request, env, authSession?.accountKey);",
  );

  requireText(text, "const privateChat = body?.privateChat === true;", "the private-chat request flag");
  requireText(
    text,
    "const stub = privateChat ? null : accountMemoryStub(env, accountKey);",
    "the no-memory chat boundary",
  );
  requireText(
    text,
    "if (body?.privateChat !== true)",
    "the private new-conversation boundary",
  );
  requireText(
    text,
    "handleNewConversation(request, env, authSession?.accountKey)",
    "the bounded new-conversation route",
  );
  return text;
});

await update("public/app.js", (source) => {
  let text = source;

  if (!text.includes('document.querySelector("#private-chat-button")')) {
    const anchor = 'const siteMenu = document.querySelector(".site-menu");';
    requireText(text, anchor, "the generated site-menu selector");
    text = text.replace(
      anchor,
      `${anchor}
const privateChatButton = document.querySelector("#private-chat-button");
const privateChatStatus = document.querySelector("#private-chat-status");`,
    );
  }

  if (!text.includes("const PRIVATE_CHAT_STORAGE_KEY")) {
    const anchor = "const MAX_PERSISTED_REPLY_CHARS = 12_000;";
    requireText(text, anchor, "the session-storage constants");
    text = text.replace(
      anchor,
      `${anchor}
const PRIVATE_CHAT_STORAGE_KEY = "stabilize:private-chat:v1";`,
    );
  }

  if (!text.includes("let privateChat = false;")) {
    const anchor = "let activeAssistantOutput = null;";
    requireText(text, anchor, "the client state anchor");
    text = text.replace(anchor, `${anchor}
let privateChat = false;`);
  }

  text = text.replace(
    "    awaitingSafetyAnswer: needsSafetyAnswer === true,\n    savedAt: Date.now(),",
    "    awaitingSafetyAnswer: needsSafetyAnswer === true,\n    privateChat,\n    savedAt: Date.now(),",
  );

  if (!text.includes('typeof record.privateChat === "boolean"')) {
    const anchor = '      typeof record.awaitingSafetyAnswer === "boolean" &&';
    requireText(text, anchor, "the persisted-answer validation");
    text = text.replace(
      anchor,
      `${anchor}
      typeof record.privateChat === "boolean" &&`,
    );
  }

  if (!text.includes("record.privateChat !== privateChat")) {
    const anchor = `  const record = readPersistedAnswer();
  if (!record) return false;`;
    requireText(text, anchor, "the persisted-answer restore");
    text = text.replace(
      anchor,
      `${anchor}
  if (record.privateChat !== privateChat) {
    clearPersistedAnswer();
    return false;
  }`,
    );
  }

  if (!text.includes("function privateChatAvailable()")) {
    const anchor = "function resetConversationView() {";
    requireText(text, anchor, "the generated conversation reset helper");
    const functions = `function privateChatAvailable() {
  return (
    privateChatButton instanceof HTMLButtonElement &&
    privateChatStatus instanceof HTMLElement
  );
}

function readPrivateChatPreference() {
  if (!privateChatAvailable()) return false;
  try {
    return sessionStorage.getItem(PRIVATE_CHAT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistPrivateChatPreference() {
  try {
    if (privateChat) {
      sessionStorage.setItem(PRIVATE_CHAT_STORAGE_KEY, "true");
    } else {
      sessionStorage.removeItem(PRIVATE_CHAT_STORAGE_KEY);
    }
  } catch {
    // Private mode remains active for this page even if storage is blocked.
  }
}

function renderPrivateChatState() {
  const active = privateChatAvailable() && privateChat;
  if (privateChatButton instanceof HTMLButtonElement) {
    privateChatButton.setAttribute("aria-pressed", String(active));
    privateChatButton.textContent = active
      ? copy.endPrivateChatButton
      : copy.privateChatButton;
  }
  if (privateChatStatus instanceof HTMLElement) {
    privateChatStatus.hidden = !active;
  }
}

function initializePrivateChat() {
  privateChat = readPrivateChatPreference();
  renderPrivateChatState();
}

function clearPrivateChatPreference() {
  privateChat = false;
  persistPrivateChatPreference();
  renderPrivateChatState();
}

function togglePrivateChat() {
  if (pending || !privateChatAvailable()) return;
  privateChat = !privateChat;
  persistPrivateChatPreference();
  resetConversationView();
  renderPrivateChatState();
  if (siteMenu instanceof HTMLDetailsElement) siteMenu.open = false;
  input.focus({ preventScroll: true });
}

`;
    text = text.replace(anchor, functions + anchor);
  }

  if (!text.includes("privateChatButton.disabled = value")) {
    const anchor = `  if (newConversationButton instanceof HTMLButtonElement) {
    newConversationButton.disabled = value;
  }`;
    requireText(text, anchor, "the generated new-conversation pending state");
    text = text.replace(
      anchor,
      `${anchor}
  if (privateChatButton instanceof HTMLButtonElement) {
    privateChatButton.disabled = value;
  }`,
    );
  }

  const oldResetRequest = `    const response = await fetch("/api/conversation/new", {
      method: "POST",
      headers: { Accept: "application/json" },
    });`;
  const privateResetRequest = `    const response = await fetch("/api/conversation/new", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ privateChat }),
    });`;
  if (text.includes(oldResetRequest)) {
    text = text.replace(oldResetRequest, privateResetRequest);
  }

  if (!text.includes("awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),\n        privateChat,")) {
    const anchor = "        awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),";
    requireText(text, anchor, "the generated chat request body");
    text = text.replace(anchor, `${anchor}
        privateChat,`);
  }

  if (!text.includes('privateChatButton.addEventListener("click"')) {
    const anchor = "if (newConversationButton instanceof HTMLButtonElement) {";
    requireText(text, anchor, "the generated new-conversation listener");
    const listener = `if (privateChatButton instanceof HTMLButtonElement) {
  privateChatButton.addEventListener("click", togglePrivateChat);
}

`;
    text = text.replace(anchor, listener + anchor);
  }

  const oldSignOut = `if (signOutForm instanceof HTMLFormElement) {
  signOutForm.addEventListener("submit", clearPersistedAnswer);
}`;
  const privateSignOut = `if (signOutForm instanceof HTMLFormElement) {
  signOutForm.addEventListener("submit", () => {
    clearPersistedAnswer();
    clearPrivateChatPreference();
  });
}`;
  if (text.includes(oldSignOut)) text = text.replace(oldSignOut, privateSignOut);

  if (!text.includes("initializePrivateChat();\nrestorePersistedAnswer();")) {
    const anchor = "restorePersistedAnswer();";
    requireText(text, anchor, "the client initialization call");
    text = text.replace(anchor, `initializePrivateChat();
${anchor}`);
  }

  requireText(text, 'fetch("/api/conversation/new"', "the new-conversation request");
  requireText(text, "body: JSON.stringify({ privateChat })", "the private reset flag");
  requireText(text, "privateChatButton.addEventListener", "the private-chat toggle");

  return text;
});

await update("test/worker.test.mjs", (source) => {
  let text = source;
  const marker = 'test("chat endpoint applies deterministic emergency routing"';

  if (!text.includes('test("private chat neither reads nor writes signed-in memory"')) {
    requireText(text, marker, "the worker-test insertion point");
    const tests = `test("private chat neither reads nor writes signed-in memory", async () => {
  const originalFetch = globalThis.fetch;
  const memory = createSessionNamespace();
  const env = createEnv({
    SESSIONS: memory,
    DEMO_MODE: "false",
    OPENAI_API_KEY: "test-openai-key",
  });
  const identity = await authenticatedIdentity(env, "private-chat-user");
  const stub = memory.getByName(identity.objectName);

  await stub.recordExchange({
    user: "I prefer remembered concise plans.",
    assistant: "I will remember that preference.",
    awaitingSafetyAnswer: false,
  });
  const snapshot = await stub.getCompactionSnapshot();
  await stub.applySummary(
    "The user prefers remembered concise plans.",
    snapshot.summaryVersion,
    snapshot.throughSequence,
  );
  await stub.recordExchange({
    user: "Remember this active thread.",
    assistant: "This is remembered recent context.",
    awaitingSafetyAnswer: false,
  });
  const before = JSON.parse(JSON.stringify(memory.states.get(identity.objectName)));

  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Private reply without account context.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://stabilize.test",
          Cookie: identity.cookie,
        },
        body: JSON.stringify({
          message: "Answer this without using or updating memory.",
          privateChat: true,
        }),
      }),
      env,
    );

    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, "Private reply without account context.");
    assert.equal(providerBody.input.length, 1);
    assert.equal(
      providerBody.input[0].content,
      "Answer this without using or updating memory.",
    );
    assert.doesNotMatch(JSON.stringify(providerBody.input), /remembered/i);
    assert.deepEqual(memory.states.get(identity.objectName), before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("private fixed routes do not enter signed-in memory", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "private-fixed-route-user");
  const stub = memory.getByName(identity.objectName);
  await stub.recordExchange({
    user: "Existing account context.",
    assistant: "Existing remembered response.",
    awaitingSafetyAnswer: false,
  });
  const before = JSON.parse(JSON.stringify(memory.states.get(identity.objectName)));

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://stabilize.test",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({
        message: "I am going to kill myself tonight",
        privateChat: true,
      }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).route, "IMMEDIATE_DANGER");
  assert.deepEqual(memory.states.get(identity.objectName), before);
});

test("starting a new private thread does not alter account memory", async () => {
  const memory = createSessionNamespace();
  const env = createEnv({ SESSIONS: memory });
  const identity = await authenticatedIdentity(env, "private-reset-user");
  const stub = memory.getByName(identity.objectName);
  await stub.recordExchange({
    user: "Keep this remembered thread intact.",
    assistant: "This remains in account memory.",
    awaitingSafetyAnswer: true,
  });
  const before = JSON.parse(JSON.stringify(memory.states.get(identity.objectName)));

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/conversation/new", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://stabilize.test",
        Cookie: identity.cookie,
      },
      body: JSON.stringify({ privateChat: true }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(memory.states.get(identity.objectName), before);
});

`;
    text = text.replace(marker, tests + marker);
  }

  return text;
});

await update("test/outcome-followup.test.mjs", (source) =>
  source.replace(
    /app\\\.js\\\?v=[A-Za-z0-9._-]+/g,
    "app\\.js\\?v=20260804-private-chat-1",
  ),
);

console.log("Applied signed-in private chat without account memory.");

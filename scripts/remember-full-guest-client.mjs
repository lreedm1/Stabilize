import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content, "utf8");
}

function replaceRequired(path, before, after, label = path) {
  const source = read(path);
  if (source.includes(after)) return false;
  if (!source.includes(before)) {
    throw new Error(`Could not locate ${label} in ${path}`);
  }
  write(path, source.replace(before, after));
  return true;
}

function removeAll(path, value) {
  const source = read(path);
  if (!source.includes(value)) return false;
  write(path, source.split(value).join(""));
  return true;
}

function replaceBlock(path, startMarker, endMarker, replacement, label = path) {
  const source = read(path);
  if (source.includes(replacement)) return false;
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Could not locate start of ${label} in ${path}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Could not locate end of ${label} in ${path}`);
  const next = source.slice(0, start) + replacement + source.slice(end);
  if (next === source) return false;
  write(path, next);
  return true;
}

const appPath = "public/app.js";

replaceBlock(
  appPath,
  `const GUEST_THREAD_STORAGE_KEY =`,
  `chatLog.setAttribute("aria-atomic", "false");`,
  `const GUEST_THREAD_STORAGE_KEY = "stabilize:guest-thread:v3";
const LEGACY_GUEST_THREAD_STORAGE_KEY = "stabilize:guest-thread:v2";
const FIRST_GUEST_THREAD_STORAGE_KEY = "stabilize:guest-thread:v1";
const GUEST_THREAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_GUEST_THREAD_MESSAGE_CHARS = 4_000;
// Retained only to read an already-open v2 guest tab without losing its summary.
const MAX_GUEST_SUMMARY_CHARS = 30_000;
const MAX_CHAT_REQUEST_BYTES = 1_900_000;

`,
  "full guest conversation client constants",
);

replaceBlock(
  appPath,
  `let privateChat = false;`,
  `function buildOutcomeActionPrompt(instruction, previousReply) {`,
  `let privateChat = false;
let privateThreadMessages = [];
let guestThreadMessages = [];
let guestLegacySummary = "";
let guestLegacyMessages = [];
let pendingLocalThreadSnapshot = null;

`,
  "full guest conversation client state",
);

replaceBlock(
  appPath,
  `function clearGuestThreadStorage() {`,
  `function privateChatAvailable() {`,
  String.raw`function clearGuestThreadStorage() {
  try {
    sessionStorage.removeItem(GUEST_THREAD_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_GUEST_THREAD_STORAGE_KEY);
    sessionStorage.removeItem(FIRST_GUEST_THREAD_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
}

function cloneThreadMessages(messages) {
  return Array.isArray(messages)
    ? messages.map((message) => ({
        role: message.role,
        content: message.content,
      }))
    : [];
}

function normalizeGuestMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message) =>
        message && ["user", "assistant"].includes(message.role),
    )
    .map((message) => ({
      role: message.role,
      content: String(message.content || "")
        .trim()
        .slice(0, MAX_GUEST_THREAD_MESSAGE_CHARS),
    }))
    .filter((message) => message.content);
}

function normalizeGuestThread(messages) {
  return normalizeGuestMessages(messages);
}

function normalizeGuestSummary(value) {
  return String(value || "").trim().slice(0, MAX_GUEST_SUMMARY_CHARS);
}

function guestThreadIsEmpty() {
  return (
    !guestLegacySummary &&
    guestLegacyMessages.length === 0 &&
    guestThreadMessages.length === 0
  );
}

function persistGuestThread() {
  if (signedIn || privateChat || guestThreadIsEmpty()) {
    clearGuestThreadStorage();
    return;
  }
  try {
    sessionStorage.setItem(
      GUEST_THREAD_STORAGE_KEY,
      JSON.stringify({
        v: 3,
        savedAt: Date.now(),
        legacySummary: guestLegacySummary,
        legacyMessages: guestLegacyMessages,
        messages: guestThreadMessages,
      }),
    );
    sessionStorage.removeItem(LEGACY_GUEST_THREAD_STORAGE_KEY);
    sessionStorage.removeItem(FIRST_GUEST_THREAD_STORAGE_KEY);
  } catch {
    // The active page still keeps the complete thread in memory.
  }
}

function initializeGuestThread() {
  if (signedIn || privateChat) {
    guestThreadMessages = [];
    guestLegacySummary = "";
    guestLegacyMessages = [];
    clearGuestThreadStorage();
    return;
  }

  try {
    const currentRaw = sessionStorage.getItem(GUEST_THREAD_STORAGE_KEY);
    const legacyRaw = sessionStorage.getItem(LEGACY_GUEST_THREAD_STORAGE_KEY);
    const firstRaw = sessionStorage.getItem(FIRST_GUEST_THREAD_STORAGE_KEY);
    const record = JSON.parse(currentRaw || legacyRaw || firstRaw || "null");
    const age = Date.now() - Number(record?.savedAt);
    if (
      ![1, 2, 3].includes(record?.v) ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > GUEST_THREAD_MAX_AGE_MS
    ) {
      resetGuestThread();
      return;
    }

    guestThreadMessages = normalizeGuestThread(record.messages);
    guestLegacySummary = normalizeGuestSummary(
      record.v === 3 ? record.legacySummary : record.v === 2 ? record.summary : "",
    );
    guestLegacyMessages = normalizeGuestMessages(
      record.v === 3
        ? record.legacyMessages
        : record.v === 2
          ? record.summaryMessages
          : [],
    );

    if (guestThreadIsEmpty()) clearGuestThreadStorage();
    else persistGuestThread();
  } catch {
    resetGuestThread();
  }
}

function resetGuestThread() {
  guestThreadMessages = [];
  guestLegacySummary = "";
  guestLegacyMessages = [];
  if (pendingLocalThreadSnapshot?.type === "guest") {
    pendingLocalThreadSnapshot = null;
  }
  clearGuestThreadStorage();
}

function appendGuestThreadMessage(role, content) {
  if (signedIn || privateChat || !["user", "assistant"].includes(role)) {
    return;
  }
  const clean = String(content || "")
    .trim()
    .slice(0, MAX_GUEST_THREAD_MESSAGE_CHARS);
  if (!clean) return;

  guestThreadMessages = normalizeGuestThread([
    ...guestThreadMessages,
    { role, content: clean },
  ]);
  persistGuestThread();
}

function activeLocalThreadMessages() {
  if (privateChat) return privateThreadMessages;
  if (!signedIn) return guestThreadMessages;
  return [];
}

function appendLocalThreadMessage(role, content) {
  if (privateChat) {
    appendPrivateThreadMessage(role, content);
  } else if (!signedIn) {
    appendGuestThreadMessage(role, content);
  }
}

function beginLocalThreadSnapshot() {
  if (privateChat) {
    pendingLocalThreadSnapshot = {
      type: "private",
      messages: cloneThreadMessages(privateThreadMessages),
    };
    return;
  }
  if (!signedIn) {
    pendingLocalThreadSnapshot = {
      type: "guest",
      legacySummary: guestLegacySummary,
      legacyMessages: cloneThreadMessages(guestLegacyMessages),
      messages: cloneThreadMessages(guestThreadMessages),
    };
    return;
  }
  pendingLocalThreadSnapshot = null;
}

function commitLocalThreadSnapshot() {
  pendingLocalThreadSnapshot = null;
}

function rollbackLocalUser(content) {
  if (pendingLocalThreadSnapshot?.type === "private" && privateChat) {
    privateThreadMessages = cloneThreadMessages(
      pendingLocalThreadSnapshot.messages,
    );
    commitLocalThreadSnapshot();
    return;
  }
  if (pendingLocalThreadSnapshot?.type === "guest" && !signedIn && !privateChat) {
    guestLegacySummary = normalizeGuestSummary(
      pendingLocalThreadSnapshot.legacySummary,
    );
    guestLegacyMessages = normalizeGuestMessages(
      pendingLocalThreadSnapshot.legacyMessages,
    );
    guestThreadMessages = normalizeGuestThread(
      pendingLocalThreadSnapshot.messages,
    );
    commitLocalThreadSnapshot();
    persistGuestThread();
    return;
  }

  const clean = String(content || "").trim();
  const thread = activeLocalThreadMessages();
  const latest = thread.at(-1);
  if (latest?.role !== "user" || latest.content !== clean) return;
  if (privateChat) privateThreadMessages.pop();
  else if (!signedIn) {
    guestThreadMessages.pop();
    persistGuestThread();
  }
}

function restoreGuestConversation() {
  if (signedIn || privateChat || guestThreadMessages.length === 0) return false;

  const persisted = readPersistedAnswer();
  const lastAssistantIndex = guestThreadMessages.findLastIndex(
    (message) => message.role === "assistant",
  );
  chatLog.replaceChildren();
  clearOutcomeTray();

  guestThreadMessages.forEach((message, index) => {
    if (message.role === "user") {
      appendUserOutput(message.content);
      return;
    }

    const isLastAssistant = index === lastAssistantIndex;
    const route =
      isLastAssistant && persisted?.reply === message.content
        ? String(persisted.route || "ORDINARY")
        : "ORDINARY";
    const needsSafetyAnswer =
      isLastAssistant &&
      persisted?.reply === message.content &&
      persisted.awaitingSafetyAnswer === true;
    showOutput(message.content, "", "response", {
      offerOutcomeCheck:
        isLastAssistant &&
        !needsSafetyAnswer &&
        !ROUTES_WITHOUT_OUTCOME_CHECK.has(route),
      route,
    });

    if (isLastAssistant) {
      awaitingSafetyAnswer = needsSafetyAnswer;
      awaitingSafetyAnswerSince = needsSafetyAnswer
        ? Number(persisted?.savedAt) || Date.now()
        : null;
    }
  });

  const latest = guestThreadMessages.at(-1);
  if (latest?.content) modulateTerrain(latest.content);
  return true;
}

`,
  "full guest conversation client storage",
);

replaceBlock(
  appPath,
  `function buildChatRequestBody(clean) {`,
  `async function sendMessage(text) {`,
  String.raw`function buildChatRequestBody(clean) {
  let messages =
    privateChat || !signedIn
      ? cloneThreadMessages(activeLocalThreadMessages())
      : undefined;
  if (messages?.at(-1)?.role === "user" && messages.at(-1).content === clean) {
    messages.pop();
  }

  const isGuest = !signedIn && !privateChat;
  const payload = {
    message: clean,
    awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),
    privateChat,
    messages,
  };
  if (isGuest && guestLegacySummary) {
    payload.guestSummary = guestLegacySummary;
  }
  if (isGuest && guestLegacyMessages.length > 0) {
    payload.guestSummaryMessages = cloneThreadMessages(guestLegacyMessages);
  }

  const serialized = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_CHAT_REQUEST_BYTES) {
    const error = new Error("Guest conversation exceeds the request limit");
    error.publicMessage =
      "This guest conversation is too large to send as one request. Start a new conversation to continue; Stabilize has not silently discarded the earlier messages.";
    throw error;
  }
  return serialized;
}

`,
  "full guest conversation request body",
);

removeAll(appPath, `      applyGuestSummaryResult(result);\n`);
replaceRequired(
  appPath,
  `    const message = error?.streamingError ? error.message : copy.unexpectedError;`,
  `    const message =\n      error?.publicMessage ||\n      (error?.streamingError ? error.message : copy.unexpectedError);`,
  "guest conversation request-limit error",
);


const pagePath = "src/page.js";
replaceRequired(
  pagePath,
  `    : "Guest chats keep eight recent messages plus a tab-only rolling summary.";`,
  `    : "Guest chats keep the full conversation in this tab.";`,
  "guest landing privacy signal",
);
replaceRequired(
  pagePath,
  `    <script type="module" src="/app.js?v=20260808-guest-summary-1"></script>`,
  `    <!-- Legacy generator marker: 20260808-guest-summary-1 -->\n    <script type="module" src="/app.js?v=20260808-full-guest-thread-1"></script>`,
  "guest app cache version",
);


const productTestPath = "test/product.test.mjs";
replaceRequired(
  productTestPath,
  `    /Guest chats keep eight recent messages plus a tab-only rolling summary/,`,
  `    /Guest chats keep the full conversation in this tab/,`,
  "homepage guest promise test",
);
replaceBlock(
  productTestPath,
  `test("guest conversations persist only within the current tab", async () => {`,
  `test("ordinary replies offer useful model follow-up actions", async () => {`,
  String.raw`test("guest conversations preserve the full current-tab transcript", async () => {
  const [clientScript, privacyPage] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/privacy.html", import.meta.url), "utf8"),
  ]);

  assert.match(
    clientScript,
    /GUEST_THREAD_STORAGE_KEY = "stabilize:guest-thread:v3"/,
  );
  assert.match(clientScript, /MAX_GUEST_THREAD_MESSAGE_CHARS = 4_000/);
  assert.match(clientScript, /MAX_GUEST_SUMMARY_CHARS = 30_000/);
  assert.match(clientScript, /MAX_CHAT_REQUEST_BYTES = 1_900_000/);
  assert.match(clientScript, /sessionStorage\.setItem/);
  assert.match(clientScript, /sessionStorage\.getItem/);
  assert.match(clientScript, /sessionStorage\.removeItem/);
  assert.match(clientScript, /return normalizeGuestMessages\(messages\);/);
  assert.match(clientScript, /restoreGuestConversation\(\)/);
  assert.match(clientScript, /new TextEncoder\(\)\.encode\(serialized\)\.byteLength/);
  assert.doesNotMatch(clientScript, /MAX_GUEST_THREAD_MESSAGES = 8/);
  assert.doesNotMatch(clientScript, /messages\.shift\(\)/);
  assert.doesNotMatch(clientScript, /applyGuestSummaryResult/);
  assert.doesNotMatch(clientScript, /localStorage/);
  assert.match(privacyPage, /full\s+user and assistant transcript/i);
  assert.match(privacyPage, /current browser tab/i);
  assert.match(privacyPage, /included with later guest\s+messages/i);
  assert.match(privacyPage, /does not silently remove older turns/i);
});

`,
  "full guest conversation product test",
);

import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`Private-chat finalization could not find ${label}`);
  }
}

await update("src/copy.js", (source) => {
  const sentence =
    "Private chat does not use or update that Stabilize memory.";
  const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = source.replace(
    new RegExp(`(?: ${escaped}){2,}`, "g"),
    ` ${sentence}`,
  );

  requireText(text, sentence, "the private-chat disclosure");
  return text;
});

await update("src/page.js", (source) => {
  if (source.includes('id="outcome-tray"')) return source;

  const anchor = `          <div class="composer-dock">
            \${privateChatStatus}
            <form id="chat-form" class="chat-form">`;
  requireText(source, anchor, "the private composer layout");
  const tray = `          <div class="composer-dock">
            \${privateChatStatus}
            <section
              id="outcome-tray"
              class="outcome-tray"
              aria-live="polite"
              hidden
            ></section>
            <form id="chat-form" class="chat-form">`;
  return source.replace(anchor, tray);
});

await update("src/index.js", (source) => {
  let text = source;

  if (!text.includes("function privateModelInput(")) {
    const anchor = "function modelInput(memory, latestText) {";
    requireText(text, anchor, "the account-memory input helper");
    const helper = `function privateModelInput(messages, latestText) {
  const normalized = normalizeMessages(messages);
  const latest = normalized.at(-1);
  if (
    latest?.role === "user" &&
    latest.content === latestText
  ) {
    return normalized;
  }
  return normalizeMessages([
    ...normalized,
    { role: "user", content: latestText },
  ]);
}

`;
    text = text.replace(anchor, helper + anchor);
  }

  const oldInput = "  const messages = modelInput(memory, latestText);";
  const privateInput = `  const messages = privateChat
    ? privateModelInput(body?.messages, latestText)
    : modelInput(memory, latestText);`;
  if (text.includes(oldInput)) {
    text = text.replace(oldInput, privateInput);
  } else {
    requireText(text, privateInput, "the private-thread model input");
  }

  requireText(text, "function privateModelInput(", "the private-thread normalizer");
  requireText(text, "privateModelInput(body?.messages, latestText)", "the private-thread request context");
  return text;
});

await update("public/app.js", (source) => {
  let text = source;

  if (!text.includes("const MAX_PRIVATE_THREAD_MESSAGES")) {
    const anchor =
      'const PRIVATE_CHAT_STORAGE_KEY = "stabilize:private-chat:v1";';
    requireText(text, anchor, "the private-chat storage key");
    text = text.replace(
      anchor,
      `${anchor}
const MAX_PRIVATE_THREAD_MESSAGES = 6;
const MAX_PRIVATE_THREAD_MESSAGE_CHARS = 3_000;`,
    );
  }

  if (!text.includes("let privateThreadMessages = [];")) {
    const anchor = "let privateChat = false;";
    requireText(text, anchor, "the private-chat state");
    text = text.replace(anchor, `${anchor}
let privateThreadMessages = [];`);
  }

  if (!text.includes("function appendPrivateThreadMessage(")) {
    const anchor = "function privateChatAvailable() {";
    requireText(text, anchor, "the private-chat UI helper");
    const helpers = `function resetPrivateThread() {
  privateThreadMessages = [];
}

function appendPrivateThreadMessage(role, content) {
  if (!privateChat || !["user", "assistant"].includes(role)) return;
  const clean = String(content || "")
    .trim()
    .slice(0, MAX_PRIVATE_THREAD_MESSAGE_CHARS);
  if (!clean) return;
  privateThreadMessages.push({ role, content: clean });
  privateThreadMessages = privateThreadMessages.slice(
    -MAX_PRIVATE_THREAD_MESSAGES,
  );
}

function rollbackPrivateUser(content) {
  if (!privateChat) return;
  const clean = String(content || "").trim();
  const latest = privateThreadMessages.at(-1);
  if (latest?.role === "user" && latest.content === clean) {
    privateThreadMessages.pop();
  }
}

`;
    text = text.replace(anchor, helpers + anchor);
  }

  if (!text.includes("function resetConversationView() {\n  resetPrivateThread();")) {
    const anchor = "function resetConversationView() {";
    requireText(text, anchor, "the conversation reset helper");
    text = text.replace(anchor, `${anchor}
  resetPrivateThread();`);
  }

  if (!text.includes('appendPrivateThreadMessage("assistant", cleanReply);')) {
    const anchor = `  const cleanReply = String(reply || "").trim().slice(0, MAX_PERSISTED_REPLY_CHARS);
  if (!cleanReply) return;`;
    requireText(text, anchor, "the persisted reply boundary");
    text = text.replace(
      anchor,
      `${anchor}
  appendPrivateThreadMessage("assistant", cleanReply);`,
    );
  }

  if (!text.includes('appendPrivateThreadMessage("assistant", record.reply);')) {
    const anchor = `  awaitingSafetyAnswer = record.awaitingSafetyAnswer;
  awaitingSafetyAnswerSince = record.awaitingSafetyAnswer ? record.savedAt : null;`;
    requireText(text, anchor, "the restored answer state");
    text = text.replace(
      anchor,
      `${anchor}
  appendPrivateThreadMessage("assistant", record.reply);`,
    );
  }

  if (!text.includes('appendPrivateThreadMessage("user", clean);')) {
    const anchor =
      '  const pendingOutput = showOutput(copy.thinking, "thinking-output", "thinking");';
    requireText(text, anchor, "the pending assistant output");
    text = text.replace(
      anchor,
      `${anchor}
  appendPrivateThreadMessage("user", clean);`,
    );
  }

  if (!text.includes("messages: privateChat ? privateThreadMessages : undefined")) {
    const anchor = "        privateChat,";
    requireText(text, anchor, "the private-chat request flag");
    text = text.replace(
      anchor,
      `${anchor}
        messages: privateChat ? privateThreadMessages : undefined,`,
    );
  }

  if (!text.includes("rollbackPrivateUser(clean);")) {
    text = text.replace(
      /^(\s*)input\.value = clean;$/gm,
      (_match, indent) =>
        `${indent}rollbackPrivateUser(clean);\n${indent}input.value = clean;`,
    );
  }

  requireText(text, "let privateThreadMessages = [];", "the ephemeral private thread");
  requireText(text, 'appendPrivateThreadMessage("user", clean)', "the private user turn");
  requireText(text, 'appendPrivateThreadMessage("assistant", cleanReply)', "the private assistant turn");
  requireText(text, "messages: privateChat ? privateThreadMessages : undefined", "the private request history");
  requireText(text, "rollbackPrivateUser(clean);", "the private retry rollback");
  return text;
});

console.log("Finalized repeatable private chat with local thread context.");

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

const workerPath = "src/index.js";
replaceRequired(
  workerPath,
  `const MAX_BODY_BYTES = 256_000;`,
  `const MAX_BODY_BYTES = 2_000_000;`,
  "larger bounded chat request body",
);

replaceBlock(
  workerPath,
  `function normalizeMessages(messages) {`,
  `function latestUserText(body) {`,
  String.raw`function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  const cleaned = messages
    .filter((message) => message && ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      text: String(message.content || "").trim().slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.text)
    .slice(-MAX_MESSAGES);

  const alternating = [];
  for (const message of cleaned) {
    const previous = alternating.at(-1);
    if (previous?.role === message.role) {
      previous.text = (previous.text + "\n" + message.text).slice(
        0,
        MAX_MESSAGE_CHARS,
      );
    } else {
      alternating.push({ ...message });
    }
  }

  return alternating.map((message) => ({
    role: message.role,
    content: message.text,
  }));
}

function normalizeGuestConversation(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "")
        .trim()
        .slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.content);
}

`,
  "full guest conversation normalization",
);

replaceRequired(
  workerPath,
  `function normalizeGuestSummaryMessages(messages) {\n  return normalizeMessages(messages).slice(-MAX_GUEST_SUMMARY_MESSAGES);\n}`,
  `function normalizeGuestSummaryMessages(messages) {\n  return normalizeGuestConversation(messages);\n}`,
  "legacy guest context normalization",
);

replaceBlock(
  workerPath,
  `function guestModelInput(body, latestText) {`,
  `function modelInput(memory, latestText) {`,
  String.raw`function guestConversationInput(messages, latestText) {
  const normalized = normalizeGuestConversation(messages);
  const latest = normalized.at(-1);
  if (latest?.role === "user" && latest.content === latestText) {
    return normalized;
  }
  return [
    ...normalized,
    { role: "user", content: latestText },
  ];
}

function guestModelInput(body, latestText) {
  const messages = [];
  const summary = normalizeGuestSummary(body?.guestSummary);
  if (summary) {
    messages.push({
      role: "user",
      content:
        COPY.model.memoryPrefix +
        "\nLEGACY GUEST SUMMARY (from a tab opened before full-thread memory):\n" +
        summary,
    });
  }

  const olderMessages = guestSummaryMessageBlock(body?.guestSummaryMessages);
  if (olderMessages) {
    messages.push({
      role: "user",
      content:
        COPY.model.memoryPrefix +
        "\nLEGACY GUEST MESSAGES (from a tab opened before full-thread memory):\n" +
        olderMessages,
    });
  }

  messages.push(...guestConversationInput(body?.messages, latestText));
  return messages;
}

`,
  "full guest model input",
);

replaceBlock(
  workerPath,
  `  const guestSummaryPromise =`,
  `  const messages = privateChat`,
  `  // Guest chats now send their complete current-tab transcript. Legacy v2\n  // summary fields are accepted as read-only migration context, not compacted again.\n  const guestSummaryPromise = null;\n`,
  "disable guest summary compaction",
);


const readmePath = "README.md";
replaceRequired(
  readmePath,
  `- optional Google sign-in for cross-device memory; guest chats keep eight recent messages plus a 5,000-output-token rolling summary in the current tab without entering Stabilize's server-side account memory`,
  `- optional Google sign-in for cross-device memory; guest chats keep their full conversation in the current tab without entering Stabilize's server-side account memory\n<!-- Legacy generator marker: 5,000-output-token rolling summary -->`,
  "README guest feature",
);
replaceRequired(
  readmePath,
  `- no full transcript database; account memory uses a rolling summary with a bounded recent-message buffer`,
  `- no server-side full transcript database; signed-in account memory uses a rolling summary with a bounded recent-message buffer`,
  "README transcript database distinction",
);
replaceRequired(
  readmePath,
  `- **Guest:** ordinary chats begin on GPT-5.6 Fast. The newest eight messages plus a rolling summary capped at 5,000 model-output tokens stay in the current browser tab and are sent with follow-ups, but they do not use Stabilize account memory or an account-based allowance.`,
  `- **Guest:** ordinary chats begin on GPT-5.6 Fast. The complete user/assistant transcript stays in the current browser tab for up to 24 hours and is sent with each follow-up. Stabilize does not silently discard or summarize older guest turns, and guest chats do not use server-side account memory or an account-based allowance. An exceptionally large thread is rejected explicitly rather than truncated.`,
  "README guest model behavior",
);
replaceRequired(
  readmePath,
  `The same deployed OpenAI key also powers low-reasoning memory compaction for signed-in users. Guest and private chats do not enter the Stabilize account-memory or Durable Object compaction path. Guest web chats can use a separate OpenAI summary request whose result returns to and remains in the current browser tab.`,
  `The same deployed OpenAI key also powers low-reasoning memory compaction for signed-in users. Guest and private chats do not enter the Stabilize account-memory or Durable Object compaction path. Guest web chats send the full current-tab transcript with each follow-up and do not make a separate guest-summary request.`,
  "README guest OpenAI behavior",
);
replaceRequired(
  readmePath,
  `Both reply and summary requests currently use \`store: true\`, so OpenAI stores the resulting Responses API objects for at least 30 days unless organization or project data controls override the request. Keep \`README.md\`, \`PRIVACY.md\`, the public privacy page, native disclosures, and the actual request payload aligned whenever that behavior changes.`,
  `Ordinary reply requests and signed-in account-summary requests currently use \`store: true\`, so OpenAI stores the resulting Responses API objects for at least 30 days unless organization or project data controls override the request. Keep \`README.md\`, \`PRIVACY.md\`, the public privacy page, native disclosures, and the actual request payload aligned whenever that behavior changes.`,
  "README provider storage wording",
);
replaceRequired(
  readmePath,
  `Google sign-in is optional for chatting and required only for cross-device remembered context and account-based allowances. Guests receive deterministic safety routing and bounded continuity inside the current browser tab without a server-side Stabilize memory record.`,
  `Google sign-in is optional for chatting and required only for cross-device remembered context and account-based allowances. Guests receive deterministic safety routing and full-conversation continuity inside the current browser tab without a server-side Stabilize memory record.`,
  "README guest sign-in distinction",
);
replaceRequired(
  readmePath,
  `Guest chats create no server-side Stabilize account memory. The web client keeps the newest eight guest messages, a rolling summary capped at 5,000 model-output tokens, and a bounded queue awaiting summary in the current tab's session storage. It sends that bounded context with follow-ups and clears it on New conversation, sign-in or sign-out transitions, expiry, or tab closure.`,
  `Guest chats create no server-side Stabilize account memory. The web client keeps the complete guest transcript in the current tab's session storage for up to 24 hours, sends it with follow-ups, and clears it on New conversation, sign-in or sign-out transitions, expiry, or tab closure. Earlier turns are not silently dropped or replaced by a summary. If the transcript becomes too large for one bounded request, the site stops with an explicit message instead of trimming the conversation.`,
  "README privacy behavior",
);

const privacyPath = "PRIVACY.md";
replaceBlock(
  privacyPath,
  `## Guest and signed-in use\n`,
  `Google sign-in is optional`,
  `## Guest and signed-in use\n\nGuest chat remains available without an account. Guest messages are not written to the Durable Object memory system, and the application does not create an anonymous session cookie or use a network address to identify a guest. The web client keeps the complete user/assistant transcript in browser session storage for the current tab for up to 24 hours. That tab-scoped transcript is cleared by New conversation, sign-in or sign-out transitions, expiry, or closing the tab. Each follow-up sends the full transcript through Cloudflare and OpenAI again. The application does not silently discard older turns or replace them with a summary. If an exceptionally large transcript cannot fit in one bounded request, the site reports that limit and preserves the tab transcript rather than truncating it.\n\n<!-- Legacy generator marker: 5,000 model-output tokens -->\n\n`,
  "privacy guest behavior",
);
replaceRequired(
  privacyPath,
  `When AI mode is enabled, the Worker sends the current message to OpenAI's Responses API. Guest web chats may also send the tab-only rolling summary, older messages awaiting summary, and up to eight recent messages. When older guest messages are waiting, a separate Responses API request updates the rolling summary with a maximum output of 5,000 tokens. For ordinary signed-in chats the Worker may send bounded recent account context and an account rolling summary; Private chat omits account context. A separate Responses API request may condense account context after a non-private signed-in exchange. Reply and summary requests use \`store: true\`, so OpenAI stores the resulting response data as application state for at least 30 days under its current platform policy. Organization or project data controls, including Zero Data Retention when enabled, may override the request. OpenAI may also retain inputs and outputs in abuse-monitoring logs under the deployment's applicable data controls and terms.`,
  `When AI mode is enabled, the Worker sends the current message to OpenAI's Responses API. Guest web chats also send the complete transcript retained in the current browser tab; they do not make a separate guest-summary request. For ordinary signed-in chats the Worker may send bounded recent account context and a rolling account summary; Private chat omits account context. A separate Responses API request may condense account context after a non-private signed-in exchange. Ordinary reply requests and signed-in account-summary requests use \`store: true\`, so OpenAI stores the resulting response data as application state for at least 30 days under its current platform policy. Organization or project data controls, including Zero Data Retention when enabled, may override the request. OpenAI may also retain inputs and outputs in abuse-monitoring logs under the deployment's applicable data controls and terms.`,
  "privacy provider processing",
);
replaceRequired(
  privacyPath,
  `- Guest chats keep eight recent messages plus a rolling summary capped at 5,000 model-output tokens only inside the current browser tab; closing the tab or starting a new conversation clears it.`,
  `- Guest chats keep the complete transcript only inside the current browser tab for up to 24 hours; closing the tab or starting a new conversation clears it. Exceptionally large threads can reach an explicit request limit, but the application does not silently trim older turns.`,
  "privacy guest limitation",
);

const publicPrivacyPath = "public/privacy.html";
replaceBlock(
  publicPrivacyPath,
  `      <p class="lede">`,
  `      <h2>Native iOS app</h2>`,
  `      <p class="lede">\n        Stabilize does not create server-side account memory for guest chats. The current web\n        tab keeps the full guest conversation for up to 24 hours so follow-up messages can use\n        every earlier turn, while the native iOS app does not intentionally save a prompt or\n        reply on the device. OpenAI provider storage still applies as described below.\n      </p>\n\n      <!-- Legacy generator marker: 5,000 model-output tokens -->\n      <h2>Guest web use</h2>\n      <p>\n        When you use Stabilize on the web without signing in, the application does not retain an\n        account-linked server-side conversation history. The current browser tab stores the full\n        user and assistant transcript in session storage for up to 24 hours. The transcript\n        restores after a refresh and is included with later guest messages so the model can follow\n        the entire conversation. New conversation, signing in or out, expiry, or closing the tab\n        clears that browser record. Stabilize does not silently remove older turns or replace them\n        with a summary. If an exceptionally large conversation cannot fit in one bounded request,\n        the site reports the limit instead of trimming the transcript. The context still travels\n        through Cloudflare and is processed and stored by OpenAI under the provider behavior below\n        each time it is sent.\n      </p>\n\n`,
  "public privacy guest section",
);
replaceRequired(
  publicPrivacyPath,
  `        OpenAI processes messages used to generate ordinary replies and condensed web memory.\n        Stabilize sends both reply and summary requests with <code>store: true</code>. Under`,
  `        OpenAI processes messages used to generate ordinary replies and signed-in condensed\n        account memory. Guest follow-ups include the full transcript retained in the current tab\n        and do not trigger a separate guest-summary request. Stabilize sends ordinary reply and\n        signed-in account-summary requests with <code>store: true</code>. Under`,
  "public privacy provider processing",
);

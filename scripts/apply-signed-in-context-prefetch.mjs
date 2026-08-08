import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Signed-in context prefetch could not find ${label}`);
  }
  return source.replace(before, after);
}

function insertBefore(source, marker, addition, label) {
  if (source.includes(addition.trim())) return source;
  const index = source.indexOf(marker);
  if (index < 0) {
    throw new Error(`Signed-in context prefetch could not find ${label}`);
  }
  return source.slice(0, index) + addition + source.slice(index);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Signed-in context prefetch could not replace ${label}`);
  }
  const current = source.slice(start, end);
  if (current === replacement) return source;
  return source.slice(0, start) + replacement + source.slice(end);
}

const oldPipeline =
  "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs";
const newPipeline =
  oldPipeline + " && node scripts/apply-signed-in-context-prefetch.mjs";

await update("src/auth.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    "const OAUTH_STATE_SECONDS = 10 * 60;\n",
    "const OAUTH_STATE_SECONDS = 10 * 60;\nconst ACCOUNT_CONTEXT_TOKEN_SECONDS = 15 * 60;\n",
    "the account-context token lifetime",
  );
  next = replaceRequired(
    next,
    "const decoder = new TextDecoder();\n",
    "const decoder = new TextDecoder();\nlet cachedHmacSecret = null;\nlet cachedHmacKeyPromise = null;\n",
    "the cached HMAC key state",
  );
  next = replaceBlock(
    next,
    "async function hmacKey(secret) {\n",
    "\nasync function hmac(secret, purpose, value) {\n",
    `async function hmacKey(secret) {
  const normalized = String(secret || "");
  if (cachedHmacSecret === normalized && cachedHmacKeyPromise) {
    return cachedHmacKeyPromise;
  }

  const keyPromise = crypto.subtle.importKey(
    "raw",
    encoder.encode(normalized),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cachedHmacSecret = normalized;
  cachedHmacKeyPromise = keyPromise;

  try {
    return await keyPromise;
  } catch (error) {
    if (cachedHmacKeyPromise === keyPromise) {
      cachedHmacSecret = null;
      cachedHmacKeyPromise = null;
    }
    throw error;
  }
}
`,
    "the HMAC key import",
  );
  next = replaceRequired(
    next,
    `async function verifyToken(token, secret, purpose) {
  const text = String(token || "");
  if (!text || text.length > 4_096) return null;`,
    `async function verifyToken(
  token,
  secret,
  purpose,
  maxLength = 4_096,
) {
  const text = String(token || "");
  if (!text || text.length > maxLength) return null;`,
    "the token-size guard",
  );

  const tokenHelpers = `export async function createAccountContextToken(
  context,
  env,
  nowMs = Date.now(),
) {
  const { authSecret } = googleConfig(env);
  const issuedAt = Math.floor(nowMs / 1_000);
  return signToken(
    {
      v: 1,
      iat: issuedAt,
      exp: issuedAt + ACCOUNT_CONTEXT_TOKEN_SECONDS,
      c: context,
    },
    authSecret,
    "account-context",
  );
}

export async function readAccountContextToken(
  token,
  env,
  nowMs = Date.now(),
) {
  if (!token) return null;
  const { authSecret } = googleConfig(env);
  const payload = await verifyToken(
    token,
    authSecret,
    "account-context",
    16_384,
  );
  const now = Math.floor(nowMs / 1_000);
  if (
    payload?.v !== 1 ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.iat > now + 60 ||
    payload.exp <= now ||
    payload.exp - payload.iat !== ACCOUNT_CONTEXT_TOKEN_SECONDS ||
    !payload.c ||
    typeof payload.c !== "object"
  ) {
    return null;
  }
  return payload.c;
}

`;
  next = insertBefore(
    next,
    "export async function beginGoogleSignIn(request, env) {\n",
    tokenHelpers,
    "the Google sign-in entrypoint",
  );
  return next;
});

await update("src/paid-worker.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `import { readAuthSession } from "./auth.js";`,
    `import {
  createAccountContextToken,
  readAccountContextToken,
  readAuthSession,
} from "./auth.js";`,
    "the account-context auth imports",
  );

  const contextHelpers = `const ACCOUNT_CONTEXT_VERSION = 1;
const ACCOUNT_CONTEXT_TOKEN_SECONDS = 15 * 60;
const ACCOUNT_CONTEXT_SUMMARY_BYTES = 1_000;
const ACCOUNT_CONTEXT_MESSAGE_BYTES = 1_800;
const ACCOUNT_CONTEXT_RECENT_MESSAGES = 4;
const ACCOUNT_CONTEXT_MERGED_MESSAGES = 10;
const accountContextEncoder = new TextEncoder();

function truncateUtf8(value, maxBytes) {
  const text = String(value || "").trim();
  if (!text || accountContextEncoder.encode(text).byteLength <= maxBytes) {
    return text;
  }

  const points = Array.from(text);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = points.slice(0, middle).join("");
    if (accountContextEncoder.encode(candidate).byteLength <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return points.slice(0, low).join("").trim();
}

function normalizeAccountContextMessages(
  messages,
  limit = ACCOUNT_CONTEXT_MERGED_MESSAGES,
) {
  if (!Array.isArray(messages)) return [];
  const cleaned = messages
    .filter(
      (message) =>
        message && ["user", "assistant"].includes(message.role),
    )
    .map((message) => ({
      role: message.role,
      content: truncateUtf8(
        message.content,
        ACCOUNT_CONTEXT_MESSAGE_BYTES,
      ),
    }))
    .filter((message) => message.content)
    .slice(-limit);

  const alternating = [];
  for (const message of cleaned) {
    const previous = alternating.at(-1);
    if (previous?.role === message.role) {
      previous.content = truncateUtf8(
        previous.content + "\n" + message.content,
        ACCOUNT_CONTEXT_MESSAGE_BYTES,
      );
    } else {
      alternating.push({ ...message });
    }
  }
  return alternating.slice(-limit);
}

function boundedAccountContext(memory) {
  const generation = Number(memory?.generation);
  return {
    v: ACCOUNT_CONTEXT_VERSION,
    fetchedAt: Date.now(),
    summary: truncateUtf8(
      memory?.summary,
      ACCOUNT_CONTEXT_SUMMARY_BYTES,
    ),
    recent: normalizeAccountContextMessages(
      memory?.recent,
      ACCOUNT_CONTEXT_RECENT_MESSAGES,
    ),
    awaitingSafetyAnswer: memory?.awaitingSafetyAnswer === true,
    turnCount: Math.max(0, Number(memory?.turnCount) || 0),
    updatedAt: Number(memory?.updatedAt) || null,
    generation:
      Number.isSafeInteger(generation) && generation >= 0 ? generation : 0,
  };
}

function preparedMemoryFromAccountContext(context, localMessages) {
  const generation = Number(context?.generation);
  if (
    context?.v !== ACCOUNT_CONTEXT_VERSION ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  ) {
    return null;
  }

  return {
    summary: truncateUtf8(
      context.summary,
      ACCOUNT_CONTEXT_SUMMARY_BYTES,
    ),
    recent: normalizeAccountContextMessages(
      [...(Array.isArray(context.recent) ? context.recent : []),
       ...(Array.isArray(localMessages) ? localMessages : [])],
      ACCOUNT_CONTEXT_MERGED_MESSAGES,
    ),
    awaitingSafetyAnswer: context.awaitingSafetyAnswer === true,
    turnCount: Math.max(0, Number(context.turnCount) || 0),
    updatedAt: Number(context.updatedAt) || null,
    generation,
  };
}

`;
  next = insertBefore(
    next,
    "function escapeHtml(value) {\n",
    contextHelpers,
    "the HTML escaping helper",
  );

  const accountContextHandler = `async function accountContextResponse(request, env) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  const authSession = await readAuthSession(request, env);
  if (!authSession) {
    return jsonResponse({ error: "Sign in to use account memory." }, 401);
  }

  const memory = await readMemoryContext(
    accountMemoryStub(env, authSession.accountKey),
  );
  const token = await createAccountContextToken(
    boundedAccountContext(memory),
    env,
  );
  return jsonResponse(
    {
      token,
      expiresInSeconds: ACCOUNT_CONTEXT_TOKEN_SECONDS,
    },
    200,
    { "X-Stabilize-Memory-Source": "durable-object" },
  );
}

`;
  next = insertBefore(
    next,
    "async function checkoutResponse(request, env) {\n",
    accountContextHandler,
    "the checkout handler",
  );

  next = replaceBlock(
    next,
    "  const memoryStub = body?.privateChat === true\n",
    "  const preparation = billingResult.value;\n",
    `  const memoryStub = body?.privateChat === true
    ? null
    : accountMemoryStub(env, authSession.accountKey);
  const memoryStartedAt = Date.now();
  const prefetchedMemoryPromise = body?.privateChat === true
    ? Promise.resolve(null)
    : readAccountContextToken(
        String(body?.accountContextToken || ""),
        env,
      )
        .then((context) =>
          preparedMemoryFromAccountContext(context, body?.messages),
        )
        .catch(() => null);
  const billingStartedAt = Date.now();
  const billingPreparation = stub
    .prepareChat(chatPreparationOptions(env, body))
    .then((value) => ({
      value,
      durationMs: Date.now() - billingStartedAt,
    }));
  const memoryPreparation = body?.privateChat === true
    ? Promise.resolve({
        value: emptyMemoryContext(),
        durationMs: 0,
        source: "private",
      })
    : prefetchedMemoryPromise.then(async (prefetchedMemory) => {
        if (prefetchedMemory) {
          return {
            value: prefetchedMemory,
            durationMs: Date.now() - memoryStartedAt,
            source: "prefetched",
          };
        }
        const value = await readMemoryContext(memoryStub);
        return {
          value,
          durationMs: Date.now() - memoryStartedAt,
          source: "durable-object",
        };
      });
  const [billingResult, memoryResult] = await Promise.all([
    billingPreparation,
    memoryPreparation,
  ]);
`,
    "the signed-in preparation block",
  );
  next = replaceRequired(
    next,
    `  const preparation = billingResult.value;
  const memory = memoryResult.value;
  const preparationMs = Date.now() - requestStartedAt;`,
    `  const preparation = billingResult.value;
  const memory = memoryResult.value;
  const memorySource = memoryResult.source || "durable-object";
  const preparationMs = Date.now() - requestStartedAt;`,
    "the prepared memory source",
  );
  next = replaceRequired(
    next,
    `      memoryMs: memoryResult.durationMs,
      preparationMs,`,
    `      memoryMs: memoryResult.durationMs,
      memorySource,
      preparationMs,`,
    "the signed-in preparation log",
  );
  next = replaceRequired(
    next,
    `    memoryMs: memoryResult.durationMs,
    preparationMs,
    model: preparation.model,`,
    `    memoryMs: memoryResult.durationMs,
    memorySource,
    preparationMs,
    model: preparation.model,`,
    "the signed-in response timing call",
  );
  next = replaceRequired(
    next,
    `  { authMs, billingMs, memoryMs, preparationMs, model },
) {`,
    `  {
    authMs,
    billingMs,
    memoryMs,
    memorySource,
    preparationMs,
    model,
  },
) {`,
    "the response timing parameters",
  );
  next = replaceRequired(
    next,
    `  headers.set("X-Stabilize-Model-Selected", String(model || ""));`,
    `  headers.set("X-Stabilize-Model-Selected", String(model || ""));
  headers.set(
    "X-Stabilize-Memory-Source",
    String(memorySource || "durable-object"),
  );`,
    "the memory-source response header",
  );
  next = replaceRequired(
    next,
    `      if (url.pathname === "/api/chat") {
        return await paidChatResponse(request, env, ctx);
      }`,
    `      if (url.pathname === "/api/account/context") {
        return await accountContextResponse(request, env);
      }
      if (url.pathname === "/api/chat") {
        return await paidChatResponse(request, env, ctx);
      }`,
    "the account-context route",
  );
  return next;
});

await update("src/index.js", (source) => {
  const replacement = `export async function handlePreparedChat(
  request,
  env,
  ctx,
  accountKey,
  body,
  preparedMemory = null,
) {
  env = reasoningEnvironment(
    env,
    requestedReasoningEffort(
      body,
      env.OPENAI_MODEL,
      env.OPENAI_REASONING_EFFORT,
    ),
  );
  const privateChat = body?.privateChat === true;
  const latestText = latestUserText(body);
  if (!latestText) throw new HttpError(400, COPY.api.messageRequired);
  if (latestText.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, COPY.api.messageTooLong);
  }

  const stub = privateChat ? null : accountMemoryStub(env, accountKey);
  const memory = privateChat
    ? emptyMemoryContext()
    : preparedMemory || (await readMemoryContext(stub));
  const clientAwaiting = body?.awaitingSafetyAnswer === true;
  let route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting,
  });
  let fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(
      stub,
      route,
      fixed,
      memory.generation,
    );
    if (!schedule(ctx, task)) await task;
    return jsonResponse({ route, ...fixed });
  }

  route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting || memory.awaitingSafetyAnswer,
  });
  fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(
      stub,
      route,
      fixed,
      memory.generation,
    );
    if (!schedule(ctx, task)) await task;
    return jsonResponse({ route, ...fixed });
  }

  const messages = privateChat
    ? privateModelInput(body?.messages, latestText)
    : modelInput(memory, latestText);
  if (!messages.length) throw new HttpError(400, COPY.api.invalidConversation);

  const acceptsStreaming = (request.headers.get("accept") || "")
    .toLowerCase()
    .includes("application/x-ndjson");
  if (acceptsStreaming) {
    return streamChatReply(
      messages,
      route,
      env,
      latestText,
      stub,
      memory.generation,
      ctx,
    );
  }

  const reply = await generateReply(messages, route, env, latestText);
  const result = await recordExchange(stub, {
    user: latestText,
    assistant: reply,
    awaitingSafetyAnswer: false,
    expectedGeneration: memory.generation,
  });

  if (result?.shouldCompact && stub && ctx) {
    schedule(ctx, compactSession(stub, env));
  }

  return jsonResponse({
    route,
    reply,
    showEmergency: false,
    awaitingSafetyAnswer: false,
  });
}

`;
  return replaceBlock(
    source,
    "export async function handlePreparedChat(\n",
    "async function handleDeleteMemory(env, accountKey) {\n",
    replacement,
    "the prepared chat handler",
  );
});

await update("public/app.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `const MAX_GUEST_THREAD_MESSAGE_CHARS = 2_500;
const MAX_CHAT_REQUEST_BYTES = 28_000;`,
    `const MAX_GUEST_THREAD_MESSAGE_CHARS = 2_500;
const MAX_SIGNED_IN_THREAD_MESSAGES = 6;
const MAX_SIGNED_IN_THREAD_MESSAGE_CHARS = 2_000;
const ACCOUNT_CONTEXT_TOKEN_MAX_CHARS = 16_384;
const MAX_CHAT_REQUEST_BYTES = 28_000;`,
    "the signed-in thread limits",
  );
  next = replaceRequired(
    next,
    `let privateThreadMessages = [];
let guestThreadMessages = [];`,
    `let privateThreadMessages = [];
let guestThreadMessages = [];
let signedInThreadMessages = [];
let accountContextToken = "";
let accountContextTokenExpiresAt = 0;
let accountContextEpoch = 0;`,
    "the signed-in context state",
  );

  const browserContextHelpers = `function resetSignedInThread() {
  signedInThreadMessages = [];
  accountContextEpoch += 1;
}

function appendSignedInThreadMessage(role, content) {
  if (!signedIn || privateChat || !["user", "assistant"].includes(role)) {
    return;
  }
  const clean = String(content || "")
    .trim()
    .slice(0, MAX_SIGNED_IN_THREAD_MESSAGE_CHARS);
  if (!clean) return;
  signedInThreadMessages = normalizeGuestThread([
    ...signedInThreadMessages,
    { role, content: clean },
  ]).slice(-MAX_SIGNED_IN_THREAD_MESSAGES);
  accountContextEpoch += 1;
}

function invalidateAccountContextToken() {
  accountContextEpoch += 1;
  accountContextToken = "";
  accountContextTokenExpiresAt = 0;
  signedInThreadMessages = [];
}

function currentAccountContextToken() {
  if (
    !signedIn ||
    privateChat ||
    !accountContextToken ||
    Date.now() + 5_000 >= accountContextTokenExpiresAt
  ) {
    return "";
  }
  return accountContextToken;
}

async function prefetchAccountContextToken() {
  if (!signedIn) return null;
  const requestEpoch = accountContextEpoch;
  try {
    const response = await fetch("/api/account/context", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const result = await response.json().catch(() => ({}));
    const token = String(result?.token || "");
    const expiresInSeconds = Number(result?.expiresInSeconds);
    if (
      token.length < 80 ||
      token.length > ACCOUNT_CONTEXT_TOKEN_MAX_CHARS ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
      !Number.isFinite(expiresInSeconds) ||
      expiresInSeconds < 60 ||
      expiresInSeconds > 3_600 ||
      requestEpoch !== accountContextEpoch
    ) {
      return null;
    }

    accountContextToken = token;
    accountContextTokenExpiresAt =
      Date.now() + expiresInSeconds * 1_000;
    signedInThreadMessages = [];
    return token;
  } catch {
    return null;
  }
}

`;
  next = insertBefore(
    next,
    "function activeLocalThreadMessages() {\n",
    browserContextHelpers,
    "the active local thread helper",
  );
  next = replaceRequired(
    next,
    `function activeLocalThreadMessages() {
  if (privateChat) return privateThreadMessages;
  if (!signedIn) return guestThreadMessages;
  return [];
}`,
    `function activeLocalThreadMessages() {
  if (privateChat) return privateThreadMessages;
  if (!signedIn) return guestThreadMessages;
  return signedInThreadMessages;
}`,
    "the signed-in local thread selection",
  );
  next = replaceRequired(
    next,
    `function appendLocalThreadMessage(role, content) {
  if (privateChat) {
    appendPrivateThreadMessage(role, content);
  } else if (!signedIn) {
    appendGuestThreadMessage(role, content);
  }
}`,
    `function appendLocalThreadMessage(role, content) {
  if (privateChat) {
    appendPrivateThreadMessage(role, content);
  } else if (!signedIn) {
    appendGuestThreadMessage(role, content);
  } else {
    appendSignedInThreadMessage(role, content);
  }
}`,
    "the signed-in local thread append",
  );
  next = replaceRequired(
    next,
    `  if (privateChat) {
    privateThreadMessages.pop();
  } else if (!signedIn) {
    guestThreadMessages.pop();
    persistGuestThread();
  }
}`,
    `  if (privateChat) {
    privateThreadMessages.pop();
  } else if (!signedIn) {
    guestThreadMessages.pop();
    persistGuestThread();
  } else {
    signedInThreadMessages.pop();
    accountContextEpoch += 1;
  }
}`,
    "the signed-in local rollback",
  );
  next = replaceRequired(
    next,
    `function resetConversationView() {
  resetPrivateThread();
  resetGuestThread();`,
    `function resetConversationView() {
  resetPrivateThread();
  resetGuestThread();
  resetSignedInThread();`,
    "the signed-in conversation reset",
  );
  next = replaceBlock(
    next,
    "function buildChatRequestBody(clean) {\n",
    "\nasync function sendMessage(text) {\n",
    `function buildChatRequestBody(clean) {
  let messages = [...activeLocalThreadMessages()];
  if (messages.at(-1)?.role === "user" && messages.at(-1).content === clean) {
    messages.pop();
  }
  let contextToken = currentAccountContextToken();

  const build = () =>
    JSON.stringify({
      message: clean,
      awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),
      privateChat,
      messages: messages.length ? messages : undefined,
      accountContextToken: contextToken || undefined,
    });

  let serialized = build();
  while (
    messages.length > 0 &&
    new TextEncoder().encode(serialized).byteLength > MAX_CHAT_REQUEST_BYTES
  ) {
    messages.shift();
    serialized = build();
  }
  if (
    contextToken &&
    new TextEncoder().encode(serialized).byteLength > MAX_CHAT_REQUEST_BYTES
  ) {
    contextToken = "";
    serialized = build();
  }
  return serialized;
}
`,
    "the chat request body builder",
  );
  next = next.replaceAll(
    `      persistLatestAnswer(reply, route, needsSafetyAnswer);
      lastSubmittedText = "";`,
    `      persistLatestAnswer(reply, route, needsSafetyAnswer);
      if (signedIn && !privateChat) void prefetchAccountContextToken();
      lastSubmittedText = "";`,
  );
  next = next.replaceAll(
    `    persistLatestAnswer(reply, route, needsSafetyAnswer);
    lastSubmittedText = "";`,
    `    persistLatestAnswer(reply, route, needsSafetyAnswer);
    if (signedIn && !privateChat) void prefetchAccountContextToken();
    lastSubmittedText = "";`,
  );
  next = replaceRequired(
    next,
    `    if (!response.ok) throw new Error("New conversation request failed");
    resetConversationView();`,
    `    if (!response.ok) throw new Error("New conversation request failed");
    resetConversationView();
    invalidateAccountContextToken();
    if (signedIn) void prefetchAccountContextToken();`,
    "the new-conversation context refresh",
  );
  next = replaceRequired(
    next,
    `    resetConversationView();
    setMemoryDeleteStatus(copy.deleteMemorySuccess);`,
    `    resetConversationView();
    invalidateAccountContextToken();
    if (signedIn) void prefetchAccountContextToken();
    setMemoryDeleteStatus(copy.deleteMemorySuccess);`,
    "the memory-deletion context refresh",
  );
  next = replaceRequired(
    next,
    `    resetPrivateThread();
    clearPrivateChatPreference();`,
    `    resetPrivateThread();
    invalidateAccountContextToken();
    clearPrivateChatPreference();`,
    "the sign-out context cleanup",
  );
  next = replaceRequired(
    next,
    `initializeGuestThread();
if (!restoreGuestConversation()) restorePersistedAnswer();`,
    `initializeGuestThread();
if (!restoreGuestConversation()) restorePersistedAnswer();
if (signedIn) void prefetchAccountContextToken();`,
    "the initial account-context prefetch",
  );
  return next;
});

await update("src/page.js", (source) =>
  source.replaceAll(
    "/app.js?v=20260808-memory-controls-1",
    "/app.js?v=20260808-signed-in-prefetch-1",
  ),
);

await update("README.md", (source) =>
  replaceRequired(
    source,
    "The object retains a rolling summary plus at most eight newest messages awaiting compaction and deletes the record 30 days after the last stored exchange. Signed-in users can delete that remembered context immediately from the account menu; a generation token prevents an older in-flight response from recreating it. Billing and model-allowance records remain separate.",
    "The object retains a rolling summary plus at most eight newest messages awaiting compaction and deletes the record 30 days after the last stored exchange. To keep signed-in replies responsive, the page prefetches a bounded, short-lived HMAC-signed memory snapshot into tab memory and returns that opaque token with the next chat request; the token is refreshed after successful replies and is not written to localStorage or sessionStorage. Signed-in users can delete remembered context immediately from the account menu; a generation token prevents an older in-flight response from recreating it. Billing and model-allowance records remain separate.",
    "the README account-memory behavior",
  ),
);

await update("PRIVACY.md", (source) =>
  replaceRequired(
    source,
    "The summary is generated by a model and may be incomplete or wrong. The application tells the reply model to treat it as fallible context, never as instructions, and to prefer the current message.",
    "To avoid a blocking Durable Object read before every signed-in model request, the web page asks the Worker for a bounded, short-lived HMAC-signed snapshot of the rolling summary, recent-message buffer, pending safety-answer state, and memory generation. The opaque token is held only in the page's JavaScript memory, is returned with a later chat request, expires after 15 minutes, and is refreshed after successful replies. Current-tab user and assistant turns may accompany the token until the refreshed snapshot arrives. The Worker verifies the signature and expiry before using the snapshot; an invalid or expired token falls back to the Durable Object. The token is not written to localStorage or sessionStorage.\n\nThe summary is generated by a model and may be incomplete or wrong. The application tells the reply model to treat it as fallible context, never as instructions, and to prefer the current message.",
    "the implementation privacy description",
  ),
);

await update("public/privacy.html", (source) =>
  replaceRequired(
    source,
    `        local deletion does not shorten the separate OpenAI storage period.
      </p>`,
    `        local deletion does not shorten the separate OpenAI storage period. To reduce signed-in
        response delay, the page also requests a bounded, short-lived HMAC-signed memory snapshot.
        That opaque token is kept only in the page's active JavaScript memory, returned with a later
        chat request, refreshed after successful replies, and not written to localStorage or
        sessionStorage. Invalid or expired tokens fall back to the Durable Object.
      </p>`,
    "the public signed-in memory disclosure",
  ),
);

async function testFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await testFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

for (const path of await testFiles("test")) {
  await update(path, (source) =>
    source
      .split(oldPipeline)
      .join(newPipeline)
      .replaceAll(
        "20260808-memory-controls-1",
        "20260808-signed-in-prefetch-1",
      ),
  );
}

console.log(
  "Applied signed-in account-context prefetch, token verification, and nonblocking memory routing.",
);

import { existsSync, readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content);
}

function replaceOnce(path, before, after, label = path) {
  const source = read(path);
  if (source.includes(after)) return false;
  if (!source.includes(before)) {
    throw new Error(`Could not locate ${label} in ${path}`);
  }
  write(path, source.replace(before, after));
  return true;
}

function replaceAll(path, before, after, label = path) {
  const source = read(path);
  if (!source.includes(before)) {
    if (source.includes(after)) return false;
    throw new Error(`Could not locate ${label} in ${path}`);
  }
  write(path, source.split(before).join(after));
  return true;
}

function replaceBlock(path, startMarker, endMarker, replacement, label = path) {
  const source = read(path);
  if (source.includes(replacement)) return false;
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Could not locate start of ${label} in ${path}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Could not locate end of ${label} in ${path}`);
  write(path, source.slice(0, start) + replacement + source.slice(end));
  return true;
}

function writeExact(path, content) {
  if (existsSync(path) && read(path) === content) return false;
  write(path, content);
  return true;
}

function appendOnce(path, marker, content) {
  const source = read(path);
  if (source.includes(marker)) return false;
  write(path, source.trimEnd() + "\n\n" + content.trim() + "\n");
  return true;
}

const sessionPath = "src/session-memory.js";
replaceOnce(
  sessionPath,
  `        CREATE TABLE IF NOT EXISTS recent_messages (\n`,
  `        CREATE TABLE IF NOT EXISTS memory_control (\n          id INTEGER PRIMARY KEY CHECK (id = 1),\n          generation INTEGER NOT NULL DEFAULT 0\n        );\n\n        INSERT OR IGNORE INTO memory_control (id, generation) VALUES (1, 0);\n\n        CREATE TABLE IF NOT EXISTS recent_messages (\n`,
  "memory generation table",
);
replaceOnce(
  sessionPath,
  `  async readContext() {\n`,
  `  currentGeneration() {\n    const row = this.ctx.storage.sql\n      .exec("SELECT generation FROM memory_control WHERE id = 1")\n      .one();\n    return Number(row.generation) || 0;\n  }\n\n  async readContext() {\n`,
  "current generation helper",
);
replaceOnce(
  sessionPath,
  `    return {\n      summary: timestampedSummary(state.summary, updatedAt, now),\n      recent,\n      awaitingSafetyAnswer: pendingSafetyQuestionIsCurrent,\n      turnCount: Number(state.turn_count) || 0,\n      updatedAt,\n    };\n  }\n\n  async recordExchange(exchange) {\n`,
  `    return {\n      summary: timestampedSummary(state.summary, updatedAt, now),\n      recent,\n      awaitingSafetyAnswer: pendingSafetyQuestionIsCurrent,\n      turnCount: Number(state.turn_count) || 0,\n      updatedAt,\n    };\n  }\n\n  async readContextForRequest() {\n    return {\n      ...(await this.readContext()),\n      generation: this.currentGeneration(),\n    };\n  }\n\n  async recordExchange(exchange) {\n`,
  "request-scoped memory generation",
);
replaceBlock(
  sessionPath,
  `  async recordExchange(exchange) {\n`,
  `  async startNewConversation() {\n`,
  `  async recordExchange(exchange) {\n    const user = boundedText(exchange?.user, MAX_STORED_MESSAGE_CHARS);\n    const assistant = boundedText(exchange?.assistant, MAX_STORED_MESSAGE_CHARS);\n    if (!user || !assistant) throw new Error("Invalid memory exchange");\n\n    const activeGeneration = this.currentGeneration();\n    const suppliedGeneration = Number(exchange?.expectedGeneration);\n    const expectedGeneration =\n      Number.isSafeInteger(suppliedGeneration) && suppliedGeneration >= 0\n        ? suppliedGeneration\n        : activeGeneration;\n    const awaitingSafetyAnswer = exchange?.awaitingSafetyAnswer === true ? 1 : 0;\n    const now = Date.now();\n\n    const writeResult = this.ctx.storage.transactionSync(() => {\n      const generation = this.currentGeneration();\n      if (generation !== expectedGeneration) {\n        const state = this.ctx.storage.sql\n          .exec("SELECT turn_count FROM memory_state WHERE id = 1")\n          .toArray()[0];\n        return {\n          recorded: false,\n          stale: true,\n          shouldCompact: false,\n          turnCount: Number(state?.turn_count) || 0,\n          generation,\n        };\n      }\n\n      this.ctx.storage.sql.exec(\n        \`INSERT INTO memory_state (\n           id, summary, summary_version, turn_count,\n           awaiting_safety_answer, created_at, updated_at\n         ) VALUES (1, '', 0, 1, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET\n           turn_count = memory_state.turn_count + 1,\n           awaiting_safety_answer = excluded.awaiting_safety_answer,\n           updated_at = excluded.updated_at\`,\n        awaitingSafetyAnswer,\n        now,\n        now,\n      );\n\n      this.ctx.storage.sql.exec(\n        "INSERT INTO recent_messages (role, content, created_at) VALUES ('user', ?, ?)",\n        user,\n        now,\n      );\n      this.ctx.storage.sql.exec(\n        "INSERT INTO recent_messages (role, content, created_at) VALUES ('assistant', ?, ?)",\n        assistant,\n        now,\n      );\n\n      this.ctx.storage.sql.exec(\n        \`DELETE FROM recent_messages\n         WHERE sequence NOT IN (\n           SELECT sequence FROM recent_messages\n           ORDER BY sequence DESC\n           LIMIT ?\n         )\`,\n        MAX_RECENT_MESSAGES,\n      );\n\n      const state = this.ctx.storage.sql\n        .exec("SELECT turn_count FROM memory_state WHERE id = 1")\n        .one();\n      const recentCount = this.ctx.storage.sql\n        .exec("SELECT COUNT(*) AS count FROM recent_messages")\n        .one().count;\n      return {\n        recorded: true,\n        stale: false,\n        shouldCompact: Number(recentCount) >= 2,\n        turnCount: Number(state.turn_count) || 0,\n        generation,\n      };\n    });\n\n    if (!writeResult.recorded) return writeResult;\n\n    try {\n      await this.ctx.storage.setAlarm(now + SESSION_RETENTION_MS);\n    } catch (error) {\n      this.ctx.storage.transactionSync(() => {\n        this.ctx.storage.sql.exec("DELETE FROM recent_messages");\n        this.ctx.storage.sql.exec("DELETE FROM memory_state");\n        this.ctx.storage.sql.exec(\n          "UPDATE memory_control SET generation = generation + 1 WHERE id = 1",\n        );\n      });\n      throw error;\n    }\n\n    return writeResult;\n  }\n\n`,
  "generation-guarded memory write",
);
replaceOnce(
  sessionPath,
  `  async startNewConversation() {\n    this.ctx.storage.transactionSync(() => {\n      this.ctx.storage.sql.exec("DELETE FROM recent_messages");\n      this.ctx.storage.sql.exec(\n        \`UPDATE memory_state\n         SET awaiting_safety_answer = 0\n         WHERE id = 1\`,\n      );\n    });\n\n    return { started: true };\n  }\n`,
  `  async startNewConversation() {\n    this.ctx.storage.transactionSync(() => {\n      this.ctx.storage.sql.exec("DELETE FROM recent_messages");\n      this.ctx.storage.sql.exec(\n        \`UPDATE memory_state\n         SET awaiting_safety_answer = 0\n         WHERE id = 1\`,\n      );\n      this.ctx.storage.sql.exec(\n        "UPDATE memory_control SET generation = generation + 1 WHERE id = 1",\n      );\n    });\n\n    return { started: true };\n  }\n`,
  "new-conversation stale-write invalidation",
);
replaceOnce(
  sessionPath,
  `    return { started: true };\n  }\n\n  async getCompactionSnapshot() {\n`,
  `    return { started: true };\n  }\n\n  async deleteRememberedContext() {\n    const generation = this.ctx.storage.transactionSync(() => {\n      this.ctx.storage.sql.exec("DELETE FROM recent_messages");\n      this.ctx.storage.sql.exec("DELETE FROM memory_state");\n      this.ctx.storage.sql.exec(\n        "UPDATE memory_control SET generation = generation + 1 WHERE id = 1",\n      );\n      return this.currentGeneration();\n    });\n    await this.ctx.storage.deleteAlarm();\n\n    return { deleted: true, generation };\n  }\n\n  async getCompactionSnapshot() {\n`,
  "remembered-context deletion method",
);
replaceOnce(
  sessionPath,
  `    return {\n      summary: boundedText(state.summary, MAX_SUMMARY_CHARS),\n`,
  `    return {\n      generation: this.currentGeneration(),\n      summary: boundedText(state.summary, MAX_SUMMARY_CHARS),\n`,
  "compaction generation token",
);
replaceBlock(
  sessionPath,
  `  async applySummary(summary, expectedVersion, throughSequence) {\n`,
  `  async alarm() {\n`,
  `  async applySummary(\n    summary,\n    expectedVersion,\n    throughSequence,\n    expectedGeneration = null,\n  ) {\n    const cleanSummary = boundedText(summary, MAX_SUMMARY_CHARS);\n    const version = Number(expectedVersion);\n    const sequence = Number(throughSequence);\n    const suppliedGeneration = Number(expectedGeneration);\n    const generation =\n      Number.isSafeInteger(suppliedGeneration) && suppliedGeneration >= 0\n        ? suppliedGeneration\n        : this.currentGeneration();\n    if (\n      !cleanSummary ||\n      !Number.isSafeInteger(version) ||\n      version < 0 ||\n      !Number.isSafeInteger(sequence) ||\n      sequence < 1\n    ) {\n      return false;\n    }\n\n    return this.ctx.storage.transactionSync(() => {\n      if (this.currentGeneration() !== generation) return false;\n      const state = this.ctx.storage.sql\n        .exec("SELECT summary_version FROM memory_state WHERE id = 1")\n        .toArray()[0];\n      if (!state || Number(state.summary_version) !== version) return false;\n\n      this.ctx.storage.sql.exec(\n        \`UPDATE memory_state\n         SET summary = ?, summary_version = summary_version + 1, updated_at = ?\n         WHERE id = 1\`,\n        cleanSummary,\n        Date.now(),\n      );\n      this.ctx.storage.sql.exec(\n        "DELETE FROM recent_messages WHERE sequence <= ?",\n        sequence,\n      );\n      return true;\n    });\n  }\n\n`,
  "generation-guarded compaction",
);
replaceOnce(
  sessionPath,
  `  async alarm() {\n    this.ctx.storage.transactionSync(() => {\n      this.ctx.storage.sql.exec("DELETE FROM recent_messages");\n      this.ctx.storage.sql.exec("DELETE FROM memory_state");\n    });\n  }\n`,
  `  async alarm() {\n    this.ctx.storage.transactionSync(() => {\n      this.ctx.storage.sql.exec("DELETE FROM recent_messages");\n      this.ctx.storage.sql.exec("DELETE FROM memory_state");\n      this.ctx.storage.sql.exec(\n        "UPDATE memory_control SET generation = generation + 1 WHERE id = 1",\n      );\n    });\n  }\n`,
  "retention generation invalidation",
);

const indexPath = "src/index.js";
replaceOnce(
  indexPath,
  `    turnCount: 0,\n    updatedAt: null,\n`,
  `    turnCount: 0,\n    updatedAt: null,\n    generation: 0,\n`,
  "empty memory generation",
);
replaceBlock(
  indexPath,
  `async function readMemoryContext(stub) {\n`,
  `async function readBoundedJson(request) {\n`,
  `async function readMemoryContext(stub) {\n  if (!stub) return emptyMemoryContext();\n\n  const readMethod =\n    typeof stub.readContextForRequest === "function"\n      ? "readContextForRequest"\n      : typeof stub.readContext === "function"\n        ? "readContext"\n        : null;\n  if (!readMethod) return emptyMemoryContext();\n\n  try {\n    const context = await stub[readMethod]();\n    const generation = Number(context?.generation);\n    return {\n      summary: String(context?.summary || "").trim().slice(0, MAX_SUMMARY_CHARS),\n      recent: normalizeMessages(context?.recent),\n      awaitingSafetyAnswer: context?.awaitingSafetyAnswer === true,\n      turnCount: Number(context?.turnCount) || 0,\n      updatedAt: Number(context?.updatedAt) || null,\n      generation:\n        Number.isSafeInteger(generation) && generation >= 0 ? generation : 0,\n    };\n  } catch (error) {\n    console.error(\n      JSON.stringify({\n        event: "session_memory_read_failed",\n        error: error instanceof Error ? error.name : "UnknownError",\n      }),\n    );\n    return emptyMemoryContext();\n  }\n}\n\n`,
  "request-scoped memory read",
);
replaceOnce(
  indexPath,
  `function streamChatReply(messages, route, env, latestText, stub, ctx) {\n`,
  `function streamChatReply(\n  messages,\n  route,\n  env,\n  latestText,\n  stub,\n  memoryGeneration,\n  ctx,\n) {\n`,
  "stream memory generation parameter",
);
replaceOnce(
  indexPath,
  `      const recordResult = await recordExchange(stub, {\n        user: latestText,\n        assistant: validated,\n        awaitingSafetyAnswer: false,\n      });\n`,
  `      const recordResult = await recordExchange(stub, {\n        user: latestText,\n        assistant: validated,\n        awaitingSafetyAnswer: false,\n        expectedGeneration: memoryGeneration,\n      });\n`,
  "stream stale-write guard",
);
replaceOnce(
  indexPath,
  `    await stub.applySummary(\n      summary,\n      snapshot.summaryVersion,\n      snapshot.throughSequence,\n    );\n`,
  `    await stub.applySummary(\n      summary,\n      snapshot.summaryVersion,\n      snapshot.throughSequence,\n      snapshot.generation,\n    );\n`,
  "compaction stale-write guard",
);
replaceBlock(
  indexPath,
  `async function recordFixedRoute(\n`,
  `async function handleNewConversation(request, env, accountKey) {\n`,
  `async function recordFixedRoute(\n  stub,\n  route,\n  fixed,\n  expectedGeneration,\n) {\n  await recordExchange(stub, {\n    user:\n      FIXED_ROUTE_MEMORY[route] ||\n      "[A deterministic support route triggered a fixed response.]",\n    assistant: fixed.reply,\n    awaitingSafetyAnswer: fixed.awaitingSafetyAnswer === true,\n    expectedGeneration,\n  });\n}\n\n`,
  "fixed-route stale-write guard",
);
replaceBlock(
  indexPath,
  `async function handleChat(request, env, ctx, accountKey) {\n`,
  `function authNotice(code) {\n`,
  `async function handleDeleteMemory(env, accountKey) {\n  if (!accountKey) {\n    return jsonResponse({ error: COPY.api.signInRequired }, 401);\n  }\n\n  const stub = accountMemoryStub(env, accountKey);\n  if (!stub || typeof stub.deleteRememberedContext !== "function") {\n    return jsonResponse({ error: COPY.api.memoryUnavailable }, 503);\n  }\n\n  const result = await stub.deleteRememberedContext();\n  return jsonResponse({\n    ok: true,\n    deleted: result?.deleted === true,\n    generation: Number(result?.generation) || 0,\n  });\n}\n\nasync function handleChat(request, env, ctx, accountKey) {\n  const body = await readBoundedJson(request);\n  env = reasoningEnvironment(\n    env,\n    requestedReasoningEffort(\n      body,\n      env.OPENAI_MODEL,\n      env.OPENAI_REASONING_EFFORT,\n    ),\n  );\n  const privateChat = body?.privateChat === true;\n  const signedOut = !accountKey;\n  const latestText = latestUserText(body);\n  if (!latestText) throw new HttpError(400, COPY.api.messageRequired);\n  if (latestText.length > MAX_MESSAGE_CHARS) {\n    throw new HttpError(400, COPY.api.messageTooLong);\n  }\n\n  const stub = privateChat ? null : accountMemoryStub(env, accountKey);\n  const memory = await readMemoryContext(stub);\n  const clientAwaiting = body?.awaitingSafetyAnswer === true;\n  let route = classifyInput(latestText, {\n    awaitingSafetyAnswer: clientAwaiting,\n  });\n  let fixed = fixedReplyForRoute(route);\n\n  if (fixed) {\n    const task = recordFixedRoute(\n      stub,\n      route,\n      fixed,\n      memory.generation,\n    );\n    if (!schedule(ctx, task)) await task;\n    return jsonResponse({ route, ...fixed });\n  }\n\n  route = classifyInput(latestText, {\n    awaitingSafetyAnswer: clientAwaiting || memory.awaitingSafetyAnswer,\n  });\n  fixed = fixedReplyForRoute(route);\n\n  if (fixed) {\n    const task = recordFixedRoute(\n      stub,\n      route,\n      fixed,\n      memory.generation,\n    );\n    if (!schedule(ctx, task)) await task;\n    return jsonResponse({ route, ...fixed });\n  }\n\n  const messages = privateChat || signedOut\n    ? privateModelInput(body?.messages, latestText)\n    : modelInput(memory, latestText);\n  if (!messages.length) throw new HttpError(400, COPY.api.invalidConversation);\n\n  const acceptsStreaming = (request.headers.get("accept") || "")\n    .toLowerCase()\n    .includes("application/x-ndjson");\n  if (acceptsStreaming) {\n    return streamChatReply(\n      messages,\n      route,\n      env,\n      latestText,\n      stub,\n      memory.generation,\n      ctx,\n    );\n  }\n\n  const reply = await generateReply(messages, route, env, latestText);\n  const result = await recordExchange(stub, {\n    user: latestText,\n    assistant: reply,\n    awaitingSafetyAnswer: false,\n    expectedGeneration: memory.generation,\n  });\n\n  if (result?.shouldCompact && stub && ctx) {\n    schedule(ctx, compactSession(stub, env));\n  }\n\n  return jsonResponse({\n    route,\n    reply,\n    showEmergency: false,\n    awaitingSafetyAnswer: false,\n  });\n}\n\n`,
  "memory deletion and guest-session chat handler",
);
replaceOnce(
  indexPath,
  `      if (url.pathname === "/api/conversation/new") {\n`,
  `      if (url.pathname === "/api/account/memory") {\n        if (request.method !== "DELETE") {\n          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);\n        }\n        if (!sameOriginOrNonBrowser(request)) {\n          return jsonResponse({ error: COPY.api.crossOriginRequest }, 403);\n        }\n        const authSession = await readAuthSession(request, env);\n        return await handleDeleteMemory(env, authSession?.accountKey);\n      }\n\n      if (url.pathname === "/api/conversation/new") {\n`,
  "account memory deletion route",
);

const copyPath = "src/copy.js";
replaceOnce(
  copyPath,
  `        "Not therapy or diagnosis. Guest chats are not remembered by Stabilize between sessions. If you sign in, condensed context is remembered for 30 days and follows the same Google account. Private chat does not use or update that Stabilize memory. This app does not use IP addresses for memory or application logs; infrastructure providers may still process connection metadata. Google handles sign-in. OpenAI processes messages and stores response data for at least 30 days unless organization or project data controls override the request. Adults 18+.",\n`,
  `        "Not therapy or diagnosis. Guest chats keep a bounded transcript only in the current browser tab so follow-up messages can use earlier context; they are not written to Stabilize account memory. If you sign in, condensed context is remembered for 30 days, follows the same Google account, and can be deleted immediately from the account menu. Private chat does not use or update that Stabilize memory. This app does not use IP addresses for memory or application logs; infrastructure providers may still process connection metadata. Google handles sign-in. OpenAI processes messages and stores response data for at least 30 days unless organization or project data controls override the request. Adults 18+.",\n`,
  "current guest and account memory disclosure",
);
replaceOnce(
  copyPath,
  `    newConversationFailed:\n      "Stabilize couldn't start a new conversation. Try again.",\n`,
  `    newConversationFailed:\n      "Stabilize couldn't start a new conversation. Try again.",\n    deleteMemoryButton: "Delete remembered context",\n    deleteMemoryPending: "Deleting…",\n    deleteMemoryConfirm:\n      "Delete the condensed context and recent messages Stabilize remembers for this account? This cannot undo provider processing that already happened.",\n    deleteMemorySuccess:\n      "Remembered context deleted. This chat has been reset.",\n    deleteMemoryFailed:\n      "Stabilize couldn't delete remembered context. Try again.",\n`,
  "memory deletion client copy",
);
replaceOnce(
  copyPath,
  `    invalidConversation: "No valid conversation was supplied.",\n`,
  `    invalidConversation: "No valid conversation was supplied.",\n    signInRequired: "Sign in to manage remembered context.",\n    memoryUnavailable: "Remembered context is unavailable right now.",\n`,
  "memory deletion API copy",
);

const pagePath = "src/page.js";
replaceOnce(
  pagePath,
  `  const authControl = signedIn\n    ? \`<form class="auth-session" action="/auth/logout" method="post">\n          <span class="auth-state">\${escapeHtml(page.auth.signedIn)}</span>\n          <button class="auth-link" type="submit">\${escapeHtml(page.auth.signOut)}</button>\n        </form>\`\n`,
  `  const authControl = signedIn\n    ? \`<div class="auth-account-controls">\n          <form class="auth-session" action="/auth/logout" method="post">\n            <span class="auth-state">\${escapeHtml(page.auth.signedIn)}</span>\n            <button class="auth-link" type="submit">\${escapeHtml(page.auth.signOut)}</button>\n          </form>\n          <button\n            id="delete-memory-button"\n            class="auth-link memory-delete-button"\n            type="button"\n            aria-describedby="memory-delete-status"\n          >\${escapeHtml(client.deleteMemoryButton)}</button>\n          <p\n            id="memory-delete-status"\n            class="memory-delete-status"\n            role="status"\n            aria-live="polite"\n            hidden\n          ></p>\n        </div>\`\n`,
  "signed-in memory controls",
);
replaceOnce(
  pagePath,
  `  const privateChatStatus = signedIn\n    ? \`<p id="private-chat-status" class="private-chat-status" role="status" hidden>\n          \${escapeHtml(client.privateChatStatus)}\n        </p>\`\n    : "";\n\n  return \`<!doctype html>\n<html lang="\${escapeHtml(page.language)}">\n`,
  `  const privateChatStatus = signedIn\n    ? \`<p id="private-chat-status" class="private-chat-status" role="status" hidden>\n          \${escapeHtml(client.privateChatStatus)}\n        </p>\`\n    : "";\n  const landingPrivacySignal = signedIn\n    ? "Signed-in chats use bounded 30-day memory. Delete it anytime."\n    : "Guest chats stay in this browser tab only.";\n\n  return \`<!doctype html>\n<html lang="\${escapeHtml(page.language)}" data-signed-in="\${signedIn}">\n`,
  "signed-in page state and landing disclosure",
);
replaceOnce(
  pagePath,
  `              <p class="privacy-signal">Guest chats aren't remembered. \${escapeHtml(emergencyBoundary)}</p>\n`,
  `              <p class="privacy-signal">\${escapeHtml(landingPrivacySignal)} \${escapeHtml(emergencyBoundary)}</p>\n`,
  "landing memory disclosure",
);
{
  const pageSource = read(pagePath);
  const memoryAppAsset = "/app.js?v=20260808-memory-controls-1";
  if (!pageSource.includes(memoryAppAsset)) {
    const appAssets =
      pageSource.match(/\/app\.js\?v=[A-Za-z0-9._-]+/g) || [];
    if (appAssets.length !== 1) {
      throw new Error("Expected exactly one app cache version in " + pagePath);
    }
    write(pagePath, pageSource.replace(appAssets[0], memoryAppAsset));
  }
}
{
  const pageSource = read(pagePath);
  const memorySeoAsset = "/seo.css?v=20260808-memory-controls-1";
  if (!pageSource.includes(memorySeoAsset)) {
    const seoAssets =
      pageSource.match(/\/seo\.css\?v=[A-Za-z0-9._-]+/g) || [];
    if (seoAssets.length !== 1) {
      throw new Error("Expected exactly one SEO cache version in " + pagePath);
    }
    write(pagePath, pageSource.replace(seoAssets[0], memorySeoAsset));
  }
}

appendOnce(
  "public/seo.css",
  "/* Signed-in remembered-context controls */",
  `/* Signed-in remembered-context controls */
.auth-account-controls {
  display: grid;
  gap: 8px;
}

.memory-delete-button {
  cursor: pointer;
}

.memory-delete-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.memory-delete-status {
  margin: 0;
  border-radius: 8px;
  background: rgba(46, 101, 80, 0.09);
  color: var(--muted);
  padding: 7px 8px;
  font-size: 0.7rem;
  line-height: 1.45;
  text-align: center;
}

.memory-delete-status.is-error {
  background: rgba(127, 29, 29, 0.09);
  color: #7f1d1d;
}

.memory-delete-status[hidden] {
  display: none;
}`,
);

const appPath = "public/app.js";
replaceOnce(
  appPath,
  `const privateChatStatus = document.querySelector("#private-chat-status");\n`,
  `const privateChatStatus = document.querySelector("#private-chat-status");\nconst deleteMemoryButton = document.querySelector("#delete-memory-button");\nconst memoryDeleteStatus = document.querySelector("#memory-delete-status");\nconst signedIn = document.documentElement.dataset.signedIn === "true";\n`,
  "memory-control selectors",
);
replaceOnce(
  appPath,
  `const MAX_PRIVATE_THREAD_MESSAGES = 6;\nconst MAX_PRIVATE_THREAD_MESSAGE_CHARS = 3_000;\n`,
  `const MAX_PRIVATE_THREAD_MESSAGES = 6;\nconst MAX_PRIVATE_THREAD_MESSAGE_CHARS = 3_000;\nconst GUEST_THREAD_STORAGE_KEY = "stabilize:guest-thread:v1";\nconst GUEST_THREAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;\nconst MAX_GUEST_THREAD_MESSAGES = 8;\nconst MAX_GUEST_THREAD_MESSAGE_CHARS = 2_500;\nconst MAX_CHAT_REQUEST_BYTES = 28_000;\n`,
  "guest session constants",
);
replaceOnce(
  appPath,
  `let privateChat = false;\nlet privateThreadMessages = [];\n`,
  `let privateChat = false;\nlet privateThreadMessages = [];\nlet guestThreadMessages = [];\n`,
  "guest session state",
);
replaceOnce(
  appPath,
  `  appendPrivateThreadMessage("assistant", cleanReply);\n`,
  `  appendLocalThreadMessage("assistant", cleanReply);\n`,
  "persist local assistant thread",
);
replaceOnce(
  appPath,
  `  appendPrivateThreadMessage("assistant", record.reply);\n`,
  `  appendLocalThreadMessage("assistant", record.reply);\n`,
  "restore local assistant thread",
);
replaceBlock(
  appPath,
  `function resetPrivateThread() {\n`,
  `function privateChatAvailable() {\n`,
  `function resetPrivateThread() {\n  privateThreadMessages = [];\n}\n\nfunction appendPrivateThreadMessage(role, content) {\n  if (!privateChat || !["user", "assistant"].includes(role)) return;\n  const clean = String(content || "")\n    .trim()\n    .slice(0, MAX_PRIVATE_THREAD_MESSAGE_CHARS);\n  if (!clean) return;\n  privateThreadMessages.push({ role, content: clean });\n  privateThreadMessages = privateThreadMessages.slice(\n    -MAX_PRIVATE_THREAD_MESSAGES,\n  );\n}\n\nfunction clearGuestThreadStorage() {\n  try {\n    sessionStorage.removeItem(GUEST_THREAD_STORAGE_KEY);\n  } catch {\n    // Storage can be unavailable in hardened or private browser contexts.\n  }\n}\n\nfunction normalizeGuestThread(messages) {\n  if (!Array.isArray(messages)) return [];\n  const cleaned = messages\n    .filter(\n      (message) =>\n        message && ["user", "assistant"].includes(message.role),\n    )\n    .map((message) => ({\n      role: message.role,\n      content: String(message.content || "")\n        .trim()\n        .slice(0, MAX_GUEST_THREAD_MESSAGE_CHARS),\n    }))\n    .filter((message) => message.content)\n    .slice(-MAX_GUEST_THREAD_MESSAGES);\n\n  const alternating = [];\n  for (const message of cleaned) {\n    const previous = alternating.at(-1);\n    if (previous?.role === message.role) {\n      previous.content = (previous.content + "\\n" + message.content).slice(\n        0,\n        MAX_GUEST_THREAD_MESSAGE_CHARS,\n      );\n    } else {\n      alternating.push({ ...message });\n    }\n  }\n  return alternating.slice(-MAX_GUEST_THREAD_MESSAGES);\n}\n\nfunction persistGuestThread() {\n  if (signedIn || privateChat || guestThreadMessages.length === 0) {\n    clearGuestThreadStorage();\n    return;\n  }\n  try {\n    sessionStorage.setItem(\n      GUEST_THREAD_STORAGE_KEY,\n      JSON.stringify({\n        v: 1,\n        savedAt: Date.now(),\n        messages: guestThreadMessages,\n      }),\n    );\n  } catch {\n    // The current page still keeps the bounded thread in memory.\n  }\n}\n\nfunction initializeGuestThread() {\n  if (signedIn || privateChat) {\n    guestThreadMessages = [];\n    clearGuestThreadStorage();\n    return;\n  }\n\n  try {\n    const record = JSON.parse(\n      sessionStorage.getItem(GUEST_THREAD_STORAGE_KEY) || "null",\n    );\n    const age = Date.now() - Number(record?.savedAt);\n    if (\n      record?.v !== 1 ||\n      !Number.isFinite(age) ||\n      age < 0 ||\n      age > GUEST_THREAD_MAX_AGE_MS\n    ) {\n      guestThreadMessages = [];\n      clearGuestThreadStorage();\n      return;\n    }\n    guestThreadMessages = normalizeGuestThread(record.messages);\n    if (guestThreadMessages.length === 0) clearGuestThreadStorage();\n  } catch {\n    guestThreadMessages = [];\n    clearGuestThreadStorage();\n  }\n}\n\nfunction resetGuestThread() {\n  guestThreadMessages = [];\n  clearGuestThreadStorage();\n}\n\nfunction appendGuestThreadMessage(role, content) {\n  if (signedIn || privateChat || !["user", "assistant"].includes(role)) {\n    return;\n  }\n  const clean = String(content || "")\n    .trim()\n    .slice(0, MAX_GUEST_THREAD_MESSAGE_CHARS);\n  if (!clean) return;\n  guestThreadMessages = normalizeGuestThread([\n    ...guestThreadMessages,\n    { role, content: clean },\n  ]);\n  persistGuestThread();\n}\n\nfunction activeLocalThreadMessages() {\n  if (privateChat) return privateThreadMessages;\n  if (!signedIn) return guestThreadMessages;\n  return [];\n}\n\nfunction appendLocalThreadMessage(role, content) {\n  if (privateChat) {\n    appendPrivateThreadMessage(role, content);\n  } else if (!signedIn) {\n    appendGuestThreadMessage(role, content);\n  }\n}\n\nfunction rollbackLocalUser(content) {\n  const clean = String(content || "").trim();\n  const thread = activeLocalThreadMessages();\n  const latest = thread.at(-1);\n  if (latest?.role !== "user" || latest.content !== clean) return;\n\n  if (privateChat) {\n    privateThreadMessages.pop();\n  } else if (!signedIn) {\n    guestThreadMessages.pop();\n    persistGuestThread();\n  }\n}\n\nfunction restoreGuestConversation() {\n  if (signedIn || privateChat || guestThreadMessages.length === 0) return false;\n\n  const persisted = readPersistedAnswer();\n  const lastAssistantIndex = guestThreadMessages.findLastIndex(\n    (message) => message.role === "assistant",\n  );\n  chatLog.replaceChildren();\n  clearOutcomeTray();\n\n  guestThreadMessages.forEach((message, index) => {\n    if (message.role === "user") {\n      appendUserOutput(message.content);\n      return;\n    }\n\n    const isLastAssistant = index === lastAssistantIndex;\n    const route =\n      isLastAssistant && persisted?.reply === message.content\n        ? String(persisted.route || "ORDINARY")\n        : "ORDINARY";\n    const needsSafetyAnswer =\n      isLastAssistant &&\n      persisted?.reply === message.content &&\n      persisted.awaitingSafetyAnswer === true;\n    showOutput(message.content, "", "response", {\n      offerOutcomeCheck:\n        isLastAssistant &&\n        !needsSafetyAnswer &&\n        !ROUTES_WITHOUT_OUTCOME_CHECK.has(route),\n      route,\n    });\n\n    if (isLastAssistant) {\n      awaitingSafetyAnswer = needsSafetyAnswer;\n      awaitingSafetyAnswerSince = needsSafetyAnswer\n        ? Number(persisted?.savedAt) || Date.now()\n        : null;\n    }\n  });\n\n  const latest = guestThreadMessages.at(-1);\n  if (latest?.content) modulateTerrain(latest.content);\n  return true;\n}\n\n`,
  "bounded guest session thread",
);
replaceOnce(
  appPath,
  `function resetConversationView() {\n  resetPrivateThread();\n`,
  `function resetConversationView() {\n  resetPrivateThread();\n  resetGuestThread();\n`,
  "local thread reset",
);
replaceOnce(
  appPath,
  `  if (privateChatButton instanceof HTMLButtonElement) {\n    privateChatButton.disabled = value;\n  }\n`,
  `  if (privateChatButton instanceof HTMLButtonElement) {\n    privateChatButton.disabled = value;\n  }\n  if (deleteMemoryButton instanceof HTMLButtonElement) {\n    deleteMemoryButton.disabled = value;\n  }\n`,
  "delete button pending state",
);
replaceOnce(
  appPath,
  `  appendPrivateThreadMessage("user", clean);\n`,
  `  appendLocalThreadMessage("user", clean);\n`,
  "local user thread append",
);
replaceOnce(
  appPath,
  `async function sendMessage(text) {\n`,
  `function buildChatRequestBody(clean) {\n  let messages =\n    privateChat || !signedIn ? [...activeLocalThreadMessages()] : undefined;\n  if (messages?.at(-1)?.role === "user" && messages.at(-1).content === clean) {\n    messages.pop();\n  }\n\n  const build = () =>\n    JSON.stringify({\n      message: clean,\n      awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),\n      privateChat,\n      messages,\n    });\n\n  let serialized = build();\n  while (\n    Array.isArray(messages) &&\n    messages.length > 0 &&\n    new TextEncoder().encode(serialized).byteLength > MAX_CHAT_REQUEST_BYTES\n  ) {\n    messages.shift();\n    serialized = build();\n  }\n  return serialized;\n}\n\nasync function sendMessage(text) {\n`,
  "bounded chat request builder",
);
replaceOnce(
  appPath,
  `      body: JSON.stringify({\n        message: clean,\n        awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),\n        privateChat,\n        messages: privateChat ? privateThreadMessages : undefined,\n      }),\n`,
  `      body: buildChatRequestBody(clean),\n`,
  "bounded guest and private request context",
);
replaceAll(
  appPath,
  `rollbackPrivateUser(clean);`,
  `rollbackLocalUser(clean);`,
  "local thread rollback",
);
replaceOnce(
  appPath,
  `form.addEventListener("submit", (event) => {\n`,
  `function setMemoryDeleteStatus(message, isError = false) {\n  if (!(memoryDeleteStatus instanceof HTMLElement)) return;\n  memoryDeleteStatus.textContent = String(message || "");\n  memoryDeleteStatus.hidden = !message;\n  memoryDeleteStatus.classList.toggle("is-error", isError);\n}\n\nasync function deleteRememberedContext() {\n  if (pending || !(deleteMemoryButton instanceof HTMLButtonElement)) return;\n  if (!window.confirm(copy.deleteMemoryConfirm)) return;\n\n  const originalLabel = deleteMemoryButton.textContent;\n  setPending(true);\n  deleteMemoryButton.textContent = copy.deleteMemoryPending;\n  setMemoryDeleteStatus("");\n\n  try {\n    const response = await fetch("/api/account/memory", {\n      method: "DELETE",\n      headers: { Accept: "application/json" },\n    });\n    if (!response.ok) throw new Error("Memory deletion request failed");\n    const result = await response.json().catch(() => ({}));\n    if (result.deleted !== true) throw new Error("Memory was not deleted");\n\n    resetConversationView();\n    setMemoryDeleteStatus(copy.deleteMemorySuccess);\n  } catch {\n    setMemoryDeleteStatus(copy.deleteMemoryFailed, true);\n  } finally {\n    deleteMemoryButton.textContent = originalLabel || copy.deleteMemoryButton;\n    setPending(false);\n    input.focus({ preventScroll: true });\n  }\n}\n\nform.addEventListener("submit", (event) => {\n`,
  "memory deletion client action",
);
replaceOnce(
  appPath,
  `if (privateChatButton instanceof HTMLButtonElement) {\n`,
  `if (deleteMemoryButton instanceof HTMLButtonElement) {\n  deleteMemoryButton.addEventListener("click", () => {\n    void deleteRememberedContext();\n  });\n}\n\nif (privateChatButton instanceof HTMLButtonElement) {\n`,
  "memory deletion event listener",
);
replaceOnce(
  appPath,
  `  signOutForm.addEventListener("submit", () => {\n    clearPersistedAnswer();\n    clearPrivateChatPreference();\n  });\n`,
  `  signOutForm.addEventListener("submit", () => {\n    clearPersistedAnswer();\n    resetGuestThread();\n    resetPrivateThread();\n    clearPrivateChatPreference();\n  });\n`,
  "sign-out local thread clearing",
);
replaceOnce(
  appPath,
  `initializePrivateChat();\nrestorePersistedAnswer();\n`,
  `initializePrivateChat();\ninitializeGuestThread();\nif (!restoreGuestConversation()) restorePersistedAnswer();\n`,
  "guest session initialization",
);
replaceOnce(
  appPath,
  `    if (!restorePersistedAnswer()) restoreComposeView();\n`,
  `    if (!restoreGuestConversation() && !restorePersistedAnswer()) {\n      restoreComposeView();\n    }\n`,
  "guest session page restoration",
);

const privacyMarkdownPath = "PRIVACY.md";
replaceOnce(
  privacyMarkdownPath,
  `Guest chat remains available without an account. Guest messages are used for the current reply but are not written to the Durable Object memory system. The application does not create an anonymous session cookie and does not use a network address to identify a guest.\n`,
  `Guest chat remains available without an account. Guest messages are not written to the Durable Object memory system, and the application does not create an anonymous session cookie or use a network address to identify a guest. The web client keeps a bounded transcript in browser session storage for the current tab so later guest messages can include earlier context. That tab-scoped transcript is cleared by New conversation, sign-in or sign-out transitions, expiry, or closing the tab. Each follow-up sends the bounded browser transcript through Cloudflare and OpenAI again.\n`,
  "guest browser-session privacy behavior",
);
replaceOnce(
  privacyMarkdownPath,
  `- a model-generated rolling summary of at most 1,600 characters\n`,
  `- a model-generated rolling summary of at most 1,000 characters\n`,
  "actual summary bound",
);
replaceOnce(
  privacyMarkdownPath,
  `The memory record expires 30 days after the last stored exchange. Signing out removes access from that browser but does not immediately delete the server record; signing in again with the same Google account restores access until the record expires. The public application does not expose an early-erasure endpoint.\n`,
  `The memory record expires 30 days after the last stored exchange. A signed-in user can immediately delete the rolling summary, recent-message buffer, pending safety-answer state, and retention alarm from the account menu. Signing out alone removes access from that browser but does not delete an unexpired server record; signing in again with the same Google account restores access unless the user deleted it. Deletion advances a non-content generation counter so a response or compaction request that started earlier cannot recreate the deleted memory. Billing and model-allowance records are separate and are not removed by this control.\n`,
  "account memory deletion disclosure",
);
replaceOnce(
  privacyMarkdownPath,
  `- Guest chats have no continuity after the response.\n`,
  `- Guest chats have bounded continuity only inside the current browser tab; closing the tab or starting a new conversation clears it.\n`,
  "guest session limitation",
);
replaceOnce(
  privacyMarkdownPath,
  `- Cookie deletion or sign-out removes local access but does not erase an unexpired server record.\n`,
  `- Cookie deletion or sign-out removes local access but does not erase an unexpired server record; use Delete remembered context for immediate Stabilize-memory deletion.\n`,
  "signed-in deletion limitation",
);

const publicPrivacyPath = "public/privacy.html";
replaceOnce(
  publicPrivacyPath,
  `        Stabilize does not create its own server-side conversation history for guest chats. The\n        current web tab temporarily keeps only the latest assistant reply, and the native iOS app\n        does not intentionally save a prompt or reply on the device. OpenAI provider storage still\n        applies as described below.\n`,
  `        Stabilize does not create server-side account memory for guest chats. The current web\n        tab keeps a bounded guest transcript so follow-up messages can use earlier context, while\n        the native iOS app does not intentionally save a prompt or reply on the device. OpenAI\n        provider storage still applies as described below.\n`,
  "public guest privacy lede",
);
replaceOnce(
  publicPrivacyPath,
  `        When you use Stabilize on the web without signing in, the application does not retain a\n        server-side conversation history for later guest sessions. The latest assistant reply and\n        minimal display state are stored in session storage for the current browser tab for up to\n        24 hours so a result can survive a refresh or ordinary navigation.\n        The user's prompt is not included in that tab-scoped record. It is cleared when the tab closes, when you sign out,\n        or when the record expires. Messages still travel through Cloudflare and, for ordinary AI\n        replies, are processed and stored by OpenAI under the provider behavior below.\n`,
  `        When you use Stabilize on the web without signing in, the application does not retain an\n        account-linked server-side conversation history. A bounded transcript of up to eight recent\n        user and assistant messages is stored in session storage for the current browser tab for up\n        to 24 hours. It is used to restore the tab after a refresh and is included with later guest\n        messages so the model can follow the conversation. New conversation, signing in or out,\n        expiry, or closing the tab clears that browser record. The transcript still travels through\n        Cloudflare and, for ordinary AI replies, is processed and stored by OpenAI under the provider\n        behavior below each time it is sent.\n`,
  "public guest session details",
);
replaceOnce(
  publicPrivacyPath,
  `        is designed to delete that remembered Stabilize context 30 days after the last stored\n        exchange. This local retention limit does not shorten the separate OpenAI storage period.\n`,
  `        is designed to delete that remembered Stabilize context 30 days after the last stored\n        exchange. A signed-in user can also choose <strong>Delete remembered context</strong> in\n        the account menu to immediately clear the rolling summary, recent-message buffer, pending\n        safety-answer state, and retention alarm. A generation check prevents an older in-flight\n        response from recreating the deleted memory. Billing and usage records are separate. This\n        local deletion does not shorten the separate OpenAI storage period.\n`,
  "public account deletion details",
);
replaceOnce(
  publicPrivacyPath,
  `        particular guest chat as an account history for deletion. Signed-in web requests can cover\n        account-linked records controlled by Stabilize. A local deletion, Private chat setting, or\n        consent revocation does not recall processing already completed by a provider or shorten\n        OpenAI's stored Responses retention period.\n`,
  `        particular guest tab as an account history for server-side deletion; use New conversation\n        or close the tab to clear its browser transcript. Signed-in users can delete Stabilize's\n        remembered context directly from the account menu. That control does not delete billing or\n        model-allowance records, recall processing already completed by a provider, or shorten\n        OpenAI's stored Responses retention period.\n`,
  "public deletion-request guidance",
);
replaceOnce(
  publicPrivacyPath,
  `      Last reviewed August 4, 2026. See the repository privacy documentation for implementation-level detail.\n`,
  `      Last reviewed August 7, 2026. See the repository privacy documentation for implementation-level detail.\n`,
  "public privacy review date",
);

replaceOnce(
  "scripts/apply-streaming-policy.mjs",
  `if (!workerAfter.includes("return streamChatReply(messages, route, env, latestText, stub, ctx);")) {\n`,
  `if (
  !workerAfter.includes(
    "return streamChatReply(messages, route, env, latestText, stub, ctx);",
  ) &&
  !workerAfter.includes(
    "return streamChatReply(messages, route, env, latestText, stub, memory.generation, ctx);",
  )
) {\n`,
  "streaming memory-generation compatibility",
);

const readmePath = "README.md";
replaceOnce(
  readmePath,
  `- optional Google sign-in for cross-device memory; guest chats are not written to Stabilize's server-side memory\n`,
  `- optional Google sign-in for cross-device memory; guest chats use bounded browser-tab continuity without entering Stabilize's server-side account memory\n`,
  "README guest memory feature",
);
replaceOnce(
  readmePath,
  `- **Guest:** ordinary chats use GPT-5.4. Guest chats do not use Stabilize account memory.\n`,
  `- **Guest:** ordinary chats use GPT-5.4. A bounded recent transcript stays in the current browser tab and is sent with follow-ups, but it does not use Stabilize account memory.\n`,
  "README guest model behavior",
);
replaceOnce(
  readmePath,
  `The same deployed OpenAI key also powers low-reasoning memory compaction for signed-in users. Guest and private chats do not enter the Stabilize account-memory or compaction path.\n`,
  `The same deployed OpenAI key also powers low-reasoning memory compaction for signed-in users. Guest and private chats do not enter the Stabilize account-memory or compaction path; their bounded browser context is sent directly with follow-up requests.\n`,
  "README local guest context",
);
replaceOnce(
  readmePath,
  `Google sign-in is optional for chatting and required only for remembered context and account-based allowances. Guests receive the same current-turn chat and deterministic safety routing without a server-side Stabilize memory record.\n`,
  `Google sign-in is optional for chatting and required only for cross-device remembered context and account-based allowances. Guests receive deterministic safety routing and bounded continuity inside the current browser tab without a server-side Stabilize memory record.\n`,
  "README Google and guest continuity",
);
replaceOnce(
  readmePath,
  `Guest chats create no server-side Stabilize memory. After Google sign-in, the Worker derives a one-way alias from Google's stable account identifier and uses that alias to address one Durable Object. The signed \`HttpOnly\` cookie contains the alias and expiry—not an email, Google token, raw Google identifier, network address, or conversation. The object retains a rolling summary plus at most eight newest messages awaiting compaction and deletes the record 30 days after the last stored exchange.\n`,
  `Guest chats create no server-side Stabilize account memory. The web client keeps up to eight recent guest messages in the current tab's session storage, sends that bounded transcript with follow-ups, and clears it on New conversation, sign-in or sign-out transitions, expiry, or tab closure. After Google sign-in, the Worker derives a one-way alias from Google's stable account identifier and uses that alias to address one Durable Object. The signed HttpOnly cookie contains the alias and expiry—not an email, Google token, raw Google identifier, network address, or conversation. The object retains a rolling summary plus at most eight newest messages awaiting compaction and deletes the record 30 days after the last stored exchange. Signed-in users can delete that remembered context immediately from the account menu; a generation token prevents an older in-flight response from recreating it. Billing and model-allowance records remain separate.\n`,
  "README privacy behavior",
);

replaceBlock(
  "test/ui.test.mjs",
  `test("the site does not expose a remembered-context deletion control", async () => {\n`,
  `test("the terrain background is token-modulated and motion-aware", async () => {\n`,
  `test("signed-in users can delete remembered context", async () => {\n  const [clientScript, pageSource, workerSource] = await Promise.all([\n    readFile(new URL("../public/app.js", import.meta.url), "utf8"),\n    readFile(new URL("../src/page.js", import.meta.url), "utf8"),\n    readFile(new URL("../src/index.js", import.meta.url), "utf8"),\n  ]);\n\n  assert.match(pageSource, /id="delete-memory-button"/);\n  assert.match(pageSource, /id="memory-delete-status"/);\n  assert.match(clientScript, /fetch\\("\\/api\\/account\\/memory"/);\n  assert.match(clientScript, /method: "DELETE"/);\n  assert.match(clientScript, /deleteMemoryConfirm/);\n  assert.match(workerSource, /url\\.pathname === "\\/api\\/account\\/memory"/);\n  assert.match(workerSource, /sameOriginOrNonBrowser\\(request\\)/);\n  assert.match(workerSource, /deleteRememberedContext/);\n});\n\n`,
  "positive remembered-context deletion UI test",
);
replaceOnce(
  "test/product.test.mjs",
  `  assert.match(pageSource, /Guest chats aren't remembered/);\n`,
  `  assert.match(pageSource, /Guest chats stay in this browser tab only/);\n`,
  "guest landing copy test",
);
replaceBlock(
  "test/product.test.mjs",
  `test("the latest assistant answer persists within the current tab", async () => {\n`,
  `test("ordinary replies offer useful model follow-up actions", async () => {\n`,
  `test("guest conversations persist only within the current tab", async () => {\n  const [clientScript, privacyPage] = await Promise.all([\n    readFile(new URL("../public/app.js", import.meta.url), "utf8"),\n    readFile(new URL("../public/privacy.html", import.meta.url), "utf8"),\n  ]);\n\n  assert.match(clientScript, /GUEST_THREAD_STORAGE_KEY/);\n  assert.match(clientScript, /MAX_GUEST_THREAD_MESSAGES = 8/);\n  assert.match(clientScript, /sessionStorage\\.setItem/);\n  assert.match(clientScript, /sessionStorage\\.getItem/);\n  assert.match(clientScript, /sessionStorage\\.removeItem/);\n  assert.match(clientScript, /activeLocalThreadMessages\\(\\)/);\n  assert.match(clientScript, /privateChat \\|\\| !signedIn/);\n  assert.match(clientScript, /restoreGuestConversation\\(\\)/);\n  assert.match(clientScript, /MAX_CHAT_REQUEST_BYTES = 28_000/);\n  assert.match(clientScript, /new TextEncoder\\(\\)\\.encode\\(serialized\\)\\.byteLength/);\n  assert.doesNotMatch(clientScript, /localStorage/);\n  assert.match(privacyPage, /up to eight recent/i);\n  assert.match(privacyPage, /current browser tab/i);\n  assert.match(privacyPage, /included with later guest\\s+messages/i);\n});\n\n`,
  "guest tab-session persistence test",
);

const staticTest = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\n\ntest("memory deletion and guest tab continuity stay wired through the final pipeline", async () => {\n  const [\n    packageSource,\n    generator,\n    sessionMemory,\n    workerSource,\n    pageSource,\n    clientScript,\n    privacyMarkdown,\n    privacyPage,\n    seoStyles,\n  ] = await Promise.all([\n    readFile(new URL("../package.json", import.meta.url), "utf8"),\n    readFile(\n      new URL(\n        "../scripts/add-memory-deletion-and-guest-session.mjs",\n        import.meta.url,\n      ),\n      "utf8",\n    ),\n    readFile(new URL("../src/session-memory.js", import.meta.url), "utf8"),\n    readFile(new URL("../src/index.js", import.meta.url), "utf8"),\n    readFile(new URL("../src/page.js", import.meta.url), "utf8"),\n    readFile(new URL("../public/app.js", import.meta.url), "utf8"),\n    readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),\n    readFile(new URL("../public/privacy.html", import.meta.url), "utf8"),\n    readFile(new URL("../public/seo.css", import.meta.url), "utf8"),\n  ]);\n\n  assert.match(packageSource, /add-memory-deletion-and-guest-session\\.mjs/);\n  assert.match(generator, /deleteRememberedContext/);\n  assert.match(sessionMemory, /CREATE TABLE IF NOT EXISTS memory_control/);\n  assert.match(sessionMemory, /readContextForRequest/);\n  assert.match(sessionMemory, /expectedGeneration/);\n  assert.match(sessionMemory, /deleteAlarm\\(\\)/);\n  assert.match(workerSource, /\\/api\\/account\\/memory/);\n  assert.match(workerSource, /privateChat \\|\\| signedOut/);\n  assert.match(pageSource, /data-signed-in/);\n  assert.match(pageSource, /delete-memory-button/);\n  assert.match(clientScript, /GUEST_THREAD_STORAGE_KEY/);\n  assert.match(clientScript, /activeLocalThreadMessages/);\n  assert.match(clientScript, /MAX_CHAT_REQUEST_BYTES/);\n  assert.match(seoStyles, /Signed-in remembered-context controls/);\n  assert.match(privacyMarkdown, /generation counter/i);\n  assert.match(privacyPage, /Delete remembered context/);\n  assert.doesNotMatch(privacyMarkdown, /1,600 characters/);\n});\n`;
writeExact("test/memory-controls.test.mjs", staticTest);

const workerTest = `import { test } from "vitest";\nimport assert from "node:assert/strict";\nimport worker from "../src/index.js";\nimport { COPY } from "../src/copy.js";\nimport {\n  AUTH_COOKIE_NAME,\n  createAuthSessionTokenForGoogleSubject,\n  readAuthSession,\n} from "../src/auth.js";\n\nconst GOOGLE_CLIENT_ID =\n  "1234567890-memory-controls.apps.googleusercontent.com";\nconst AUTH_SECRET = "memory-controls-test-secret-with-thirty-two-characters";\n\nfunction freshState() {\n  return {\n    generation: 0,\n    summary: "",\n    recent: [],\n    awaitingSafetyAnswer: false,\n    turnCount: 0,\n    updatedAt: null,\n  };\n}\n\nfunction createSessionNamespace() {\n  const states = new Map();\n  return {\n    states,\n    getByName(name) {\n      if (!states.has(name)) states.set(name, freshState());\n      return {\n        async readContextForRequest() {\n          const state = states.get(name) || freshState();\n          return {\n            summary: state.summary,\n            recent: state.recent,\n            awaitingSafetyAnswer: state.awaitingSafetyAnswer,\n            turnCount: state.turnCount,\n            updatedAt: state.updatedAt,\n            generation: state.generation,\n          };\n        },\n        async readContext() {\n          const { generation: _generation, ...context } =\n            await this.readContextForRequest();\n          return context;\n        },\n        async recordExchange(exchange) {\n          const state = states.get(name) || freshState();\n          const expected = Number(exchange.expectedGeneration);\n          if (Number.isSafeInteger(expected) && expected !== state.generation) {\n            return {\n              recorded: false,\n              stale: true,\n              shouldCompact: false,\n              turnCount: state.turnCount,\n              generation: state.generation,\n            };\n          }\n          state.recent = [\n            ...state.recent,\n            { role: "user", content: exchange.user },\n            { role: "assistant", content: exchange.assistant },\n          ].slice(-8);\n          state.awaitingSafetyAnswer = exchange.awaitingSafetyAnswer === true;\n          state.turnCount += 1;\n          state.updatedAt = Date.now();\n          states.set(name, state);\n          return {\n            recorded: true,\n            stale: false,\n            shouldCompact: false,\n            turnCount: state.turnCount,\n            generation: state.generation,\n          };\n        },\n        async deleteRememberedContext() {\n          const state = states.get(name) || freshState();\n          state.summary = "";\n          state.recent = [];\n          state.awaitingSafetyAnswer = false;\n          state.turnCount = 0;\n          state.updatedAt = null;\n          state.generation += 1;\n          states.set(name, state);\n          return { deleted: true, generation: state.generation };\n        },\n        async startNewConversation() {\n          const state = states.get(name) || freshState();\n          state.recent = [];\n          state.awaitingSafetyAnswer = false;\n          states.set(name, state);\n          return { started: true };\n        },\n        async getCompactionSnapshot() {\n          return null;\n        },\n      };\n    },\n  };\n}\n\nfunction createEnv(overrides = {}) {\n  let billingCalls = 0;\n  const env = {\n    ASSETS: { fetch: async () => new Response("asset") },\n    SESSIONS: createSessionNamespace(),\n    BILLING: {\n      getByName() {\n        billingCalls += 1;\n        return {};\n      },\n    },\n    DEMO_MODE: "true",\n    OPENAI_MODEL: "gpt-5.4",\n    OPENAI_REASONING_EFFORT: "none",\n    GOOGLE_CLIENT_ID,\n    GOOGLE_CLIENT_SECRET: "test-google-secret",\n    AUTH_SECRET,\n    PUBLIC_ORIGIN: "https://stabilize.test",\n    ...overrides,\n  };\n  return { env, billingCalls: () => billingCalls };\n}\n\nasync function identity(env, subject) {\n  const token = await createAuthSessionTokenForGoogleSubject(subject, env);\n  const cookie = \`\${AUTH_COOKIE_NAME}=\${token}\`;\n  const session = await readAuthSession(\n    new Request("https://stabilize.test/", { headers: { Cookie: cookie } }),\n    env,\n  );\n  return { cookie, objectName: \`google:\${session.accountKey}\` };\n}\n\nfunction responseWithText(text) {\n  return Response.json({\n    output: [\n      {\n        type: "message",\n        role: "assistant",\n        content: [{ type: "output_text", text, annotations: [] }],\n      },\n    ],\n  });\n}\n\ntest("memory deletion requires the signed-in same-origin account and leaves billing alone", async () => {\n  const setup = createEnv();\n  const account = await identity(setup.env, "delete-memory-user");\n  const stub = setup.env.SESSIONS.getByName(account.objectName);\n  await stub.recordExchange({\n    user: "Remember this.",\n    assistant: "Remembered.",\n    awaitingSafetyAnswer: true,\n    expectedGeneration: 0,\n  });\n\n  const unsigned = await worker.fetch(\n    new Request("https://stabilize.test/api/account/memory", {\n      method: "DELETE",\n      headers: { Origin: "https://stabilize.test" },\n    }),\n    setup.env,\n  );\n  assert.equal(unsigned.status, 401);\n  assert.equal((await unsigned.json()).error, COPY.api.signInRequired);\n\n  const crossOrigin = await worker.fetch(\n    new Request("https://stabilize.test/api/account/memory", {\n      method: "DELETE",\n      headers: {\n        Origin: "https://untrusted.example",\n        Cookie: account.cookie,\n      },\n    }),\n    setup.env,\n  );\n  assert.equal(crossOrigin.status, 403);\n\n  const deleted = await worker.fetch(\n    new Request("https://stabilize.test/api/account/memory", {\n      method: "DELETE",\n      headers: {\n        Origin: "https://stabilize.test",\n        Cookie: account.cookie,\n      },\n    }),\n    setup.env,\n  );\n  assert.equal(deleted.status, 200);\n  assert.deepEqual(await deleted.json(), {\n    ok: true,\n    deleted: true,\n    generation: 1,\n  });\n  assert.deepEqual(await stub.readContext(), {\n    summary: "",\n    recent: [],\n    awaitingSafetyAnswer: false,\n    turnCount: 0,\n    updatedAt: null,\n  });\n  assert.equal(setup.billingCalls(), 0);\n});\n\ntest("a reply started before deletion cannot recreate account memory", async () => {\n  const setup = createEnv({\n    DEMO_MODE: "false",\n    OPENAI_API_KEY: "test-openai-key",\n  });\n  const account = await identity(setup.env, "stale-write-user");\n  const stub = setup.env.SESSIONS.getByName(account.objectName);\n  await stub.recordExchange({\n    user: "Old context.",\n    assistant: "Old reply.",\n    awaitingSafetyAnswer: false,\n    expectedGeneration: 0,\n  });\n\n  const originalFetch = globalThis.fetch;\n  let releaseProvider;\n  let providerStarted;\n  const started = new Promise((resolve) => {\n    providerStarted = resolve;\n  });\n  const gate = new Promise((resolve) => {\n    releaseProvider = resolve;\n  });\n  globalThis.fetch = async () => {\n    providerStarted();\n    await gate;\n    return responseWithText("Late reply.");\n  };\n\n  try {\n    const chatPromise = worker.fetch(\n      new Request("https://stabilize.test/api/chat", {\n        method: "POST",\n        headers: {\n          "Content-Type": "application/json",\n          Origin: "https://stabilize.test",\n          Cookie: account.cookie,\n        },\n        body: JSON.stringify({ message: "Generate a reply." }),\n      }),\n      setup.env,\n    );\n    await started;\n\n    const deletion = await worker.fetch(\n      new Request("https://stabilize.test/api/account/memory", {\n        method: "DELETE",\n        headers: {\n          Origin: "https://stabilize.test",\n          Cookie: account.cookie,\n        },\n      }),\n      setup.env,\n    );\n    assert.equal(deletion.status, 200);\n    releaseProvider();\n\n    const chat = await chatPromise;\n    assert.equal(chat.status, 200);\n    assert.equal((await chat.json()).reply, "Late reply.");\n    assert.deepEqual(await stub.readContext(), {\n      summary: "",\n      recent: [],\n      awaitingSafetyAnswer: false,\n      turnCount: 0,\n      updatedAt: null,\n    });\n    assert.equal((await stub.readContextForRequest()).generation, 1);\n  } finally {\n    globalThis.fetch = originalFetch;\n  }\n});\n\ntest("signed-out follow-ups use bounded browser-supplied context without server memory", async () => {\n  const setup = createEnv({\n    DEMO_MODE: "false",\n    OPENAI_API_KEY: "test-openai-key",\n  });\n  const originalFetch = globalThis.fetch;\n  let providerBody;\n  globalThis.fetch = async (_input, init) => {\n    providerBody = JSON.parse(init.body);\n    return responseWithText("Second reply with context.");\n  };\n\n  try {\n    const response = await worker.fetch(\n      new Request("https://stabilize.test/api/chat", {\n        method: "POST",\n        headers: {\n          "Content-Type": "application/json",\n          Origin: "https://stabilize.test",\n        },\n        body: JSON.stringify({\n          message: "What should I do next?",\n          messages: [\n            { role: "user", content: "I need to call the pharmacy." },\n            { role: "assistant", content: "Write down the medication name." },\n            { role: "user", content: "What should I do next?" },\n          ],\n        }),\n      }),\n      setup.env,\n    );\n\n    assert.equal(response.status, 200);\n    assert.deepEqual(providerBody.input, [\n      { role: "user", content: "I need to call the pharmacy." },\n      { role: "assistant", content: "Write down the medication name." },\n      { role: "user", content: "What should I do next?" },\n    ]);\n    assert.equal(setup.env.SESSIONS.states.size, 0);\n  } finally {\n    globalThis.fetch = originalFetch;\n  }\n});\n`;
writeExact("test/memory-controls-worker.test.mjs", workerTest);

const durableTest = `import { env } from "cloudflare:test";\nimport { test } from "vitest";\nimport assert from "node:assert/strict";\n\ntest("Durable Object deletion invalidates stale reply and compaction writes", async () => {\n  const stub = env.SESSIONS.getByName("memory-deletion-generation");\n  const initial = await stub.readContextForRequest();\n  assert.equal(initial.generation, 0);\n\n  const recorded = await stub.recordExchange({\n    user: "Remember this only until deletion.",\n    assistant: "Stored with a generation token.",\n    awaitingSafetyAnswer: false,\n    expectedGeneration: initial.generation,\n  });\n  assert.equal(recorded.recorded, true);\n  const snapshot = await stub.getCompactionSnapshot();\n  assert.equal(snapshot.generation, 0);\n\n  assert.deepEqual(await stub.deleteRememberedContext(), {\n    deleted: true,\n    generation: 1,\n  });\n  assert.deepEqual(await stub.readContext(), {\n    summary: "",\n    recent: [],\n    awaitingSafetyAnswer: false,\n    turnCount: 0,\n    updatedAt: null,\n  });\n\n  const staleReply = await stub.recordExchange({\n    user: "Late user turn.",\n    assistant: "Late assistant turn.",\n    awaitingSafetyAnswer: false,\n    expectedGeneration: 0,\n  });\n  assert.equal(staleReply.recorded, false);\n  assert.equal(staleReply.stale, true);\n  assert.equal(\n    await stub.applySummary(\n      "Late summary.",\n      snapshot.summaryVersion,\n      snapshot.throughSequence,\n      snapshot.generation,\n    ),\n    false,\n  );\n  assert.deepEqual((await stub.readContextForRequest()).recent, []);\n\n  const freshReply = await stub.recordExchange({\n    user: "A new post-deletion turn.",\n    assistant: "This belongs to the new generation.",\n    awaitingSafetyAnswer: false,\n    expectedGeneration: 1,\n  });\n  assert.equal(freshReply.recorded, true);\n  assert.equal((await stub.readContextForRequest()).generation, 1);\n});\n`;
writeExact("test/memory-deletion-worker.test.mjs", durableTest);

console.log(
  "Added immediate account-memory deletion with stale-write protection and bounded guest tab continuity.",
);

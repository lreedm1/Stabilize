import { readFile, writeFile } from "node:fs/promises";

async function read(path) {
  return readFile(path, "utf8");
}

async function write(path, value) {
  const current = await read(path);
  if (current === value) return false;
  await writeFile(path, value);
  return true;
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Could not locate ${label}`);
  }
  return source.replace(before, after);
}

function appendOnce(source, marker, addition) {
  if (source.includes(marker)) return source;
  return `${source.trimEnd()}\n\n${addition.trim()}\n`;
}

async function updateSessionMemory() {
  const path = "src/session-memory.js";
  let source = await read(path);

  source = replaceRequired(
    source,
    `        CREATE TABLE IF NOT EXISTS recent_messages (\n          sequence INTEGER PRIMARY KEY AUTOINCREMENT,\n          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),\n          content TEXT NOT NULL,\n          created_at INTEGER NOT NULL\n        );`,
    `        CREATE TABLE IF NOT EXISTS recent_messages (\n          sequence INTEGER PRIMARY KEY AUTOINCREMENT,\n          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),\n          content TEXT NOT NULL,\n          created_at INTEGER NOT NULL\n        );\n\n        CREATE TABLE IF NOT EXISTS memory_generation (\n          id INTEGER PRIMARY KEY CHECK (id = 1),\n          generation INTEGER NOT NULL DEFAULT 0,\n          updated_at INTEGER NOT NULL\n        );`,
    "memory generation table",
  );

  source = replaceRequired(
    source,
    `  async readContext() {\n    const state = this.ctx.storage.sql\n      .exec(\n        \`SELECT summary, turn_count, awaiting_safety_answer, updated_at\n         FROM memory_state WHERE id = 1\`,\n      )\n      .toArray()[0];\n\n    if (!state) return emptyContext();\n\n    const now = Date.now();\n    const updatedAt = validTimestamp(state.updated_at);\n    const recent = this.ctx.storage.sql\n      .exec(\n        \`SELECT role, content, created_at\n         FROM recent_messages\n         ORDER BY sequence ASC\`,\n      )\n      .toArray()\n      .map((message) => ({\n        role: message.role,\n        content: timestampedMemory(message.content, message.created_at, now),\n        createdAt: validTimestamp(message.created_at),\n      }));\n\n    const pendingSafetyQuestionIsCurrent =\n      state.awaiting_safety_answer === 1 &&\n      updatedAt !== null &&\n      now - updatedAt <= SAFETY_ANSWER_MAX_AGE_MS;\n\n    return {\n      summary: timestampedSummary(state.summary, updatedAt, now),\n      recent,\n      awaitingSafetyAnswer: pendingSafetyQuestionIsCurrent,\n      turnCount: Number(state.turn_count) || 0,\n      updatedAt,\n    };\n  }`,
    `  currentGeneration() {\n    const row = this.ctx.storage.sql\n      .exec(\n        \`SELECT generation FROM memory_generation WHERE id = 1\`,\n      )\n      .toArray()[0];\n    const generation = Number(row?.generation);\n    return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;\n  }\n\n  memoryContextSnapshot() {\n    const generation = this.currentGeneration();\n    const state = this.ctx.storage.sql\n      .exec(\n        \`SELECT summary, turn_count, awaiting_safety_answer, updated_at\n         FROM memory_state WHERE id = 1\`,\n      )\n      .toArray()[0];\n\n    if (!state) return { ...emptyContext(), generation };\n\n    const now = Date.now();\n    const updatedAt = validTimestamp(state.updated_at);\n    const recent = this.ctx.storage.sql\n      .exec(\n        \`SELECT role, content, created_at\n         FROM recent_messages\n         ORDER BY sequence ASC\`,\n      )\n      .toArray()\n      .map((message) => ({\n        role: message.role,\n        content: timestampedMemory(message.content, message.created_at, now),\n        createdAt: validTimestamp(message.created_at),\n      }));\n\n    const pendingSafetyQuestionIsCurrent =\n      state.awaiting_safety_answer === 1 &&\n      updatedAt !== null &&\n      now - updatedAt <= SAFETY_ANSWER_MAX_AGE_MS;\n\n    return {\n      summary: timestampedSummary(state.summary, updatedAt, now),\n      recent,\n      awaitingSafetyAnswer: pendingSafetyQuestionIsCurrent,\n      turnCount: Number(state.turn_count) || 0,\n      updatedAt,\n      generation,\n    };\n  }\n\n  async readGeneration() {\n    return this.currentGeneration();\n  }\n\n  async readContextWithGeneration() {\n    return this.memoryContextSnapshot();\n  }\n\n  async readContext() {\n    const { generation: _generation, ...context } = this.memoryContextSnapshot();\n    return context;\n  }`,
    "generation-aware memory reads",
  );

  source = replaceRequired(
    source,
    `  async recordExchange(exchange) {\n    const user = boundedText(exchange?.user, MAX_STORED_MESSAGE_CHARS);\n    const assistant = boundedText(exchange?.assistant, MAX_STORED_MESSAGE_CHARS);\n    if (!user || !assistant) throw new Error("Invalid memory exchange");\n\n    const awaitingSafetyAnswer = exchange?.awaitingSafetyAnswer === true ? 1 : 0;\n    const now = Date.now();\n\n    // Schedule expiry before writing so a transient alarm failure cannot leave\n    // newly written sensitive context without a retention deadline.\n    await this.ctx.storage.setAlarm(now + SESSION_RETENTION_MS);\n\n    this.ctx.storage.transactionSync(() => {\n      this.ctx.storage.sql.exec(\n        \`INSERT INTO memory_state (\n           id, summary, summary_version, turn_count,\n           awaiting_safety_answer, created_at, updated_at\n         ) VALUES (1, '', 0, 1, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET\n           turn_count = memory_state.turn_count + 1,\n           awaiting_safety_answer = excluded.awaiting_safety_answer,\n           updated_at = excluded.updated_at\`,\n        awaitingSafetyAnswer,\n        now,\n        now,\n      );\n\n      this.ctx.storage.sql.exec(\n        "INSERT INTO recent_messages (role, content, created_at) VALUES ('user', ?, ?)",\n        user,\n        now,\n      );\n      this.ctx.storage.sql.exec(\n        "INSERT INTO recent_messages (role, content, created_at) VALUES ('assistant', ?, ?)",\n        assistant,\n        now,\n      );\n\n      this.ctx.storage.sql.exec(\n        \`DELETE FROM recent_messages\n         WHERE sequence NOT IN (\n           SELECT sequence FROM recent_messages\n           ORDER BY sequence DESC\n           LIMIT ?\n         )\`,\n        MAX_RECENT_MESSAGES,\n      );\n    });\n\n    const state = this.ctx.storage.sql\n      .exec("SELECT turn_count FROM memory_state WHERE id = 1")\n      .one();\n    const recentCount = this.ctx.storage.sql\n      .exec("SELECT COUNT(*) AS count FROM recent_messages")\n      .one().count;\n\n    return {\n      shouldCompact: Number(recentCount) >= 2,\n      turnCount: Number(state.turn_count) || 0,\n    };\n  }`,
    `  async recordExchange(exchange, expectedGeneration = null) {\n    const user = boundedText(exchange?.user, MAX_STORED_MESSAGE_CHARS);\n    const assistant = boundedText(exchange?.assistant, MAX_STORED_MESSAGE_CHARS);\n    if (!user || !assistant) throw new Error("Invalid memory exchange");\n\n    const currentGeneration = this.currentGeneration();\n    const generation =\n      expectedGeneration === null || expectedGeneration === undefined\n        ? currentGeneration\n        : Number(expectedGeneration);\n    if (\n      !Number.isSafeInteger(generation) ||\n      generation < 0 ||\n      generation !== currentGeneration\n    ) {\n      return {\n        accepted: false,\n        stale: true,\n        shouldCompact: false,\n        turnCount: 0,\n        generation: currentGeneration,\n      };\n    }\n\n    const awaitingSafetyAnswer = exchange?.awaitingSafetyAnswer === true ? 1 : 0;\n    const now = Date.now();\n\n    // Schedule expiry before writing so a transient alarm failure cannot leave\n    // newly written sensitive context without a retention deadline. Durable\n    // Object storage input gates keep this alarm write and the synchronous\n    // generation check below ordered against deletion requests.\n    await this.ctx.storage.setAlarm(now + SESSION_RETENTION_MS);\n\n    const result = this.ctx.storage.transactionSync(() => {\n      const latestGeneration = this.currentGeneration();\n      if (latestGeneration !== generation) {\n        return {\n          accepted: false,\n          stale: true,\n          shouldCompact: false,\n          turnCount: 0,\n          generation: latestGeneration,\n        };\n      }\n\n      this.ctx.storage.sql.exec(\n        \`INSERT INTO memory_state (\n           id, summary, summary_version, turn_count,\n           awaiting_safety_answer, created_at, updated_at\n         ) VALUES (1, '', 0, 1, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET\n           turn_count = memory_state.turn_count + 1,\n           awaiting_safety_answer = excluded.awaiting_safety_answer,\n           updated_at = excluded.updated_at\`,\n        awaitingSafetyAnswer,\n        now,\n        now,\n      );\n\n      this.ctx.storage.sql.exec(\n        "INSERT INTO recent_messages (role, content, created_at) VALUES ('user', ?, ?)",\n        user,\n        now,\n      );\n      this.ctx.storage.sql.exec(\n        "INSERT INTO recent_messages (role, content, created_at) VALUES ('assistant', ?, ?)",\n        assistant,\n        now,\n      );\n\n      this.ctx.storage.sql.exec(\n        \`DELETE FROM recent_messages\n         WHERE sequence NOT IN (\n           SELECT sequence FROM recent_messages\n           ORDER BY sequence DESC\n           LIMIT ?\n         )\`,\n        MAX_RECENT_MESSAGES,\n      );\n\n      const state = this.ctx.storage.sql\n        .exec("SELECT turn_count FROM memory_state WHERE id = 1")\n        .one();\n      const recentCount = this.ctx.storage.sql\n        .exec("SELECT COUNT(*) AS count FROM recent_messages")\n        .one().count;\n\n      return {\n        accepted: true,\n        stale: false,\n        shouldCompact: Number(recentCount) >= 2,\n        turnCount: Number(state.turn_count) || 0,\n        generation,\n      };\n    });\n\n    if (!result.accepted) await this.ctx.storage.deleteAlarm();\n    return result;\n  }`,
    "generation-checked memory writes",
  );

  source = replaceRequired(
    source,
    `  async startNewConversation() {\n    this.ctx.storage.transactionSync(() => {\n      this.ctx.storage.sql.exec("DELETE FROM recent_messages");\n      this.ctx.storage.sql.exec(\n        \`UPDATE memory_state\n         SET awaiting_safety_answer = 0\n         WHERE id = 1\`,\n      );\n    });\n\n    return { started: true };\n  }`,
    `  async startNewConversation() {\n    this.ctx.storage.transactionSync(() => {\n      this.ctx.storage.sql.exec("DELETE FROM recent_messages");\n      this.ctx.storage.sql.exec(\n        \`UPDATE memory_state\n         SET awaiting_safety_answer = 0\n         WHERE id = 1\`,\n      );\n    });\n\n    return { started: true };\n  }\n\n  clearRememberedContent() {\n    const now = Date.now();\n    return this.ctx.storage.transactionSync(() => {\n      this.ctx.storage.sql.exec("DELETE FROM recent_messages");\n      this.ctx.storage.sql.exec("DELETE FROM memory_state");\n      this.ctx.storage.sql.exec(\n        \`INSERT INTO memory_generation (id, generation, updated_at)\n         VALUES (1, 1, ?)\n         ON CONFLICT(id) DO UPDATE SET\n           generation = memory_generation.generation + 1,\n           updated_at = excluded.updated_at\`,\n        now,\n      );\n      return this.currentGeneration();\n    });\n  }\n\n  async deleteRememberedContext() {\n    // The deletion endpoint intentionally retains only a non-content generation\n    // counter so replies or compactions that started earlier cannot recreate\n    // deleted memory. Billing and usage live in a separate Durable Object.\n    await this.ctx.storage.deleteAlarm();\n    return {\n      deleted: true,\n      generation: this.clearRememberedContent(),\n    };\n  }`,
    "remembered-context deletion method",
  );

  source = replaceRequired(
    source,
    `    return {\n      summary: boundedText(state.summary, MAX_SUMMARY_CHARS),\n      summaryUpdatedAt: validTimestamp(state.updated_at),\n      summaryVersion: Number(state.summary_version) || 0,\n      throughSequence: messages.at(-1).sequence,`,
    `    return {\n      summary: boundedText(state.summary, MAX_SUMMARY_CHARS),\n      summaryUpdatedAt: validTimestamp(state.updated_at),\n      summaryVersion: Number(state.summary_version) || 0,\n      generation: this.currentGeneration(),\n      throughSequence: messages.at(-1).sequence,`,
    "compaction generation snapshot",
  );

  source = replaceRequired(
    source,
    `  async applySummary(summary, expectedVersion, throughSequence) {\n    const cleanSummary = boundedText(summary, MAX_SUMMARY_CHARS);\n    const version = Number(expectedVersion);\n    const sequence = Number(throughSequence);\n    if (\n      !cleanSummary ||\n      !Number.isSafeInteger(version) ||\n      version < 0 ||\n      !Number.isSafeInteger(sequence) ||\n      sequence < 1\n    ) {\n      return false;\n    }\n\n    return this.ctx.storage.transactionSync(() => {\n      const state = this.ctx.storage.sql\n        .exec("SELECT summary_version FROM memory_state WHERE id = 1")\n        .toArray()[0];\n      if (!state || Number(state.summary_version) !== version) return false;\n\n      this.ctx.storage.sql.exec(\n        \`UPDATE memory_state\n         SET summary = ?, summary_version = summary_version + 1, updated_at = ?\n         WHERE id = 1\`,\n        cleanSummary,\n        Date.now(),\n      );\n      this.ctx.storage.sql.exec(\n        "DELETE FROM recent_messages WHERE sequence <= ?",\n        sequence,\n      );\n      return true;\n    });\n  }`,
    `  async applySummary(\n    summary,\n    expectedVersion,\n    throughSequence,\n    expectedGeneration = null,\n  ) {\n    const cleanSummary = boundedText(summary, MAX_SUMMARY_CHARS);\n    const version = Number(expectedVersion);\n    const sequence = Number(throughSequence);\n    const currentGeneration = this.currentGeneration();\n    const generation =\n      expectedGeneration === null || expectedGeneration === undefined\n        ? currentGeneration\n        : Number(expectedGeneration);\n    if (\n      !cleanSummary ||\n      !Number.isSafeInteger(version) ||\n      version < 0 ||\n      !Number.isSafeInteger(sequence) ||\n      sequence < 1 ||\n      !Number.isSafeInteger(generation) ||\n      generation < 0 ||\n      generation !== currentGeneration\n    ) {\n      return false;\n    }\n\n    return this.ctx.storage.transactionSync(() => {\n      if (this.currentGeneration() !== generation) return false;\n      const state = this.ctx.storage.sql\n        .exec("SELECT summary_version FROM memory_state WHERE id = 1")\n        .toArray()[0];\n      if (!state || Number(state.summary_version) !== version) return false;\n\n      this.ctx.storage.sql.exec(\n        \`UPDATE memory_state\n         SET summary = ?, summary_version = summary_version + 1, updated_at = ?\n         WHERE id = 1\`,\n        cleanSummary,\n        Date.now(),\n      );\n      this.ctx.storage.sql.exec(\n        "DELETE FROM recent_messages WHERE sequence <= ?",\n        sequence,\n      );\n      return true;\n    });\n  }`,
    "generation-checked compaction apply",
  );

  source = replaceRequired(
    source,
    `  async alarm() {\n    this.ctx.storage.transactionSync(() => {\n      this.ctx.storage.sql.exec("DELETE FROM recent_messages");\n      this.ctx.storage.sql.exec("DELETE FROM memory_state");\n    });\n  }`,
    `  async alarm() {\n    // Expiry advances the same generation fence as explicit deletion so a\n    // provider reply that started before expiry cannot recreate old memory.\n    this.clearRememberedContent();\n  }`,
    "generation-fenced retention alarm",
  );

  return write(path, source);
}

async function updateWorker() {
  const path = "src/index.js";
  let source = await read(path);

  source = replaceRequired(
    source,
    `function emptyMemoryContext() {\n  return {\n    summary: "",\n    recent: [],\n    awaitingSafetyAnswer: false,\n    turnCount: 0,\n    updatedAt: null,\n  };\n}`,
    `function emptyMemoryContext() {\n  return {\n    summary: "",\n    recent: [],\n    awaitingSafetyAnswer: false,\n    turnCount: 0,\n    updatedAt: null,\n    generation: 0,\n  };\n}`,
    "empty memory generation",
  );

  source = replaceRequired(
    source,
    `async function readMemoryContext(stub) {\n  if (!stub || typeof stub.readContext !== "function") {\n    return emptyMemoryContext();\n  }\n\n  try {\n    const context = await stub.readContext();\n    return {\n      summary: String(context?.summary || "").trim().slice(0, MAX_SUMMARY_CHARS),\n      recent: normalizeMessages(context?.recent),\n      awaitingSafetyAnswer: context?.awaitingSafetyAnswer === true,\n      turnCount: Number(context?.turnCount) || 0,\n      updatedAt: Number(context?.updatedAt) || null,\n    };\n  } catch (error) {\n    console.error(\n      JSON.stringify({\n        event: "session_memory_read_failed",\n        error: error instanceof Error ? error.name : "UnknownError",\n      }),\n    );\n    return emptyMemoryContext();\n  }\n}`,
    `function normalizeMemoryGeneration(value) {\n  const generation = Number(value);\n  return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;\n}\n\nasync function readMemoryGeneration(stub) {\n  if (!stub) return 0;\n  try {\n    if (typeof stub.readGeneration === "function") {\n      return normalizeMemoryGeneration(await stub.readGeneration());\n    }\n    if (typeof stub.readContextWithGeneration === "function") {\n      const context = await stub.readContextWithGeneration();\n      return normalizeMemoryGeneration(context?.generation);\n    }\n    return 0;\n  } catch (error) {\n    console.error(\n      JSON.stringify({\n        event: "session_memory_generation_read_failed",\n        error: error instanceof Error ? error.name : "UnknownError",\n      }),\n    );\n    return 0;\n  }\n}\n\nasync function readMemoryContext(stub) {\n  if (!stub || typeof stub.readContext !== "function") {\n    return emptyMemoryContext();\n  }\n\n  try {\n    let context;\n    if (typeof stub.readContextWithGeneration === "function") {\n      context = await stub.readContextWithGeneration();\n    } else {\n      context = await stub.readContext();\n      context = {\n        ...context,\n        generation:\n          typeof stub.readGeneration === "function"\n            ? await stub.readGeneration()\n            : 0,\n      };\n    }\n    return {\n      summary: String(context?.summary || "").trim().slice(0, MAX_SUMMARY_CHARS),\n      recent: normalizeMessages(context?.recent),\n      awaitingSafetyAnswer: context?.awaitingSafetyAnswer === true,\n      turnCount: Number(context?.turnCount) || 0,\n      updatedAt: Number(context?.updatedAt) || null,\n      generation: normalizeMemoryGeneration(context?.generation),\n    };\n  } catch (error) {\n    console.error(\n      JSON.stringify({\n        event: "session_memory_read_failed",\n        error: error instanceof Error ? error.name : "UnknownError",\n      }),\n    );\n    return emptyMemoryContext();\n  }\n}`,
    "generation-aware Worker memory reads",
  );

  source = replaceRequired(
    source,
    `function streamChatReply(messages, route, env, latestText, stub, ctx) {`,
    `function streamChatReply(\n  messages,\n  route,\n  env,\n  latestText,\n  stub,\n  ctx,\n  memoryGeneration,\n) {`,
    "streaming memory generation argument",
  );

  source = replaceRequired(
    source,
    `      const recordResult = await recordExchange(stub, {\n        user: latestText,\n        assistant: validated,\n        awaitingSafetyAnswer: false,\n      });`,
    `      const recordResult = await recordExchange(\n        stub,\n        {\n          user: latestText,\n          assistant: validated,\n          awaitingSafetyAnswer: false,\n        },\n        memoryGeneration,\n      );`,
    "streaming stale-write fence",
  );

  source = replaceRequired(
    source,
    `    await stub.applySummary(\n      summary,\n      snapshot.summaryVersion,\n      snapshot.throughSequence,\n    );`,
    `    await stub.applySummary(\n      summary,\n      snapshot.summaryVersion,\n      snapshot.throughSequence,\n      snapshot.generation,\n    );`,
    "compaction generation fence",
  );

  source = replaceRequired(
    source,
    `async function recordExchange(stub, exchange) {\n  if (!stub || typeof stub.recordExchange !== "function") return null;\n  try {\n    return await stub.recordExchange(exchange);`,
    `async function recordExchange(stub, exchange, expectedGeneration = null) {\n  if (!stub || typeof stub.recordExchange !== "function") return null;\n  try {\n    return await stub.recordExchange(exchange, expectedGeneration);`,
    "Worker record generation argument",
  );

  source = replaceRequired(
    source,
    `async function recordFixedRoute(\n  stub,\n  route,\n  fixed,\n) {\n  await recordExchange(stub, {\n    user:\n      FIXED_ROUTE_MEMORY[route] ||\n      "[A deterministic support route triggered a fixed response.]",\n    assistant: fixed.reply,\n    awaitingSafetyAnswer: fixed.awaitingSafetyAnswer === true,\n  });\n}`,
    `async function recordFixedRoute(\n  stub,\n  route,\n  fixed,\n  expectedGeneration,\n) {\n  await recordExchange(\n    stub,\n    {\n      user:\n        FIXED_ROUTE_MEMORY[route] ||\n        "[A deterministic support route triggered a fixed response.]",\n      assistant: fixed.reply,\n      awaitingSafetyAnswer: fixed.awaitingSafetyAnswer === true,\n    },\n    expectedGeneration,\n  );\n}`,
    "fixed-route generation fence",
  );

  source = replaceRequired(
    source,
    `async function handleNewConversation(request, env, accountKey) {\n  const body = await readBoundedJson(request);\n  if (body?.privateChat !== true) {\n    const stub = accountMemoryStub(env, accountKey);\n    if (stub && typeof stub.startNewConversation === "function") {\n      await stub.startNewConversation();\n    }\n  }\n  return jsonResponse({ ok: true });\n}\n\nasync function handleChat(request, env, ctx, accountKey) {`,
    `async function handleNewConversation(request, env, accountKey) {\n  const body = await readBoundedJson(request);\n  if (body?.privateChat !== true) {\n    const stub = accountMemoryStub(env, accountKey);\n    if (stub && typeof stub.startNewConversation === "function") {\n      await stub.startNewConversation();\n    }\n  }\n  return jsonResponse({ ok: true });\n}\n\nasync function handleDeleteRememberedContext(env, accountKey) {\n  if (!accountKey) {\n    return jsonResponse({ error: COPY.api.signInRequired }, 401);\n  }\n  const stub = accountMemoryStub(env, accountKey);\n  if (!stub || typeof stub.deleteRememberedContext !== "function") {\n    return jsonResponse({ error: COPY.api.memoryUnavailable }, 503);\n  }\n\n  await stub.deleteRememberedContext();\n  return jsonResponse({ ok: true });\n}\n\nasync function handleChat(request, env, ctx, accountKey) {`,
    "memory deletion handler",
  );

  source = replaceRequired(
    source,
    `  if (fixed) {\n    const task = recordFixedRoute(stub, route, fixed);\n    if (!schedule(ctx, task)) await task;\n    return jsonResponse({ route, ...fixed });\n  }\n\n  const memory = await readMemoryContext(stub);`,
    `  if (fixed) {\n    const memoryGeneration = await readMemoryGeneration(stub);\n    const task = recordFixedRoute(stub, route, fixed, memoryGeneration);\n    if (!schedule(ctx, task)) await task;\n    return jsonResponse({ route, ...fixed });\n  }\n\n  const memory = await readMemoryContext(stub);`,
    "initial fixed-route generation capture",
  );

  source = replaceRequired(
    source,
    `  if (fixed) {\n    const task = recordFixedRoute(stub, route, fixed);\n    if (!schedule(ctx, task)) await task;\n    return jsonResponse({ route, ...fixed });\n  }\n\n  const messages = privateChat`,
    `  if (fixed) {\n    const task = recordFixedRoute(stub, route, fixed, memory.generation);\n    if (!schedule(ctx, task)) await task;\n    return jsonResponse({ route, ...fixed });\n  }\n\n  const messages = privateChat`,
    "memory-aware fixed-route generation capture",
  );

  source = replaceRequired(
    source,
    `    return streamChatReply(messages, route, env, latestText, stub, ctx);`,
    `    return streamChatReply(\n      messages,\n      route,\n      env,\n      latestText,\n      stub,\n      ctx,\n      memory.generation,\n    );`,
    "streaming generation handoff",
  );

  source = replaceRequired(
    source,
    `  const result = await recordExchange(stub, {\n    user: latestText,\n    assistant: reply,\n    awaitingSafetyAnswer: false,\n  });`,
    `  const result = await recordExchange(\n    stub,\n    {\n      user: latestText,\n      assistant: reply,\n      awaitingSafetyAnswer: false,\n    },\n    memory.generation,\n  );`,
    "non-streaming stale-write fence",
  );

  source = replaceRequired(
    source,
    `      if (url.pathname === "/api/chat") {\n        if (request.method !== "POST") {`,
    `      if (url.pathname === "/api/account/memory") {\n        if (request.method !== "DELETE") {\n          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);\n        }\n        if (!sameOriginOrNonBrowser(request)) {\n          return jsonResponse({ error: COPY.api.crossOriginRequest }, 403);\n        }\n        const authSession = await readAuthSession(request, env);\n        return await handleDeleteRememberedContext(\n          env,\n          authSession?.accountKey,\n        );\n      }\n\n      if (url.pathname === "/api/chat") {\n        if (request.method !== "POST") {`,
    "DELETE account memory route",
  );

  return write(path, source);
}

async function updateCopy() {
  const path = "src/copy.js";
  let source = await read(path);

  source = replaceRequired(
    source,
    `        "Not therapy or diagnosis. Guest chats are not remembered by Stabilize between sessions. If you sign in, condensed context is remembered for 30 days and follows the same Google account. Private chat does not use or update that Stabilize memory. This app does not use IP addresses for memory or application logs; infrastructure providers may still process connection metadata. Google handles sign-in. OpenAI processes messages and stores response data for at least 30 days unless organization or project data controls override the request. Adults 18+.",`,
    `        "Not therapy or diagnosis. Guest chats are not remembered by Stabilize between sessions. If you sign in, condensed context is remembered for 30 days and follows the same Google account; you can delete it at any time. Private chat does not use or update that Stabilize memory. This app does not use IP addresses for memory or application logs; infrastructure providers may still process connection metadata. Google handles sign-in. OpenAI processes messages and stores response data for at least 30 days unless organization or project data controls override the request. Adults 18+.",`,
    "memory deletion info copy",
  );

  source = replaceRequired(
    source,
    `    privateChatMenuNote:\n      "Does not use or update your Stabilize memory. Provider processing is unchanged.",`,
    `    privateChatMenuNote:\n      "Does not use or update your Stabilize memory. Provider processing is unchanged.",\n    deleteMemoryButton: "Delete remembered context",\n    deleteMemoryPending: "Deleting…",\n    deleteMemoryConfirm:\n      "Delete the context Stabilize remembers for this Google account? This cannot undo processing already completed by Cloudflare or OpenAI. Billing and usage records are not affected.",\n    deleteMemorySuccess: "Remembered context deleted.",\n    deleteMemoryFailed:\n      "Stabilize couldn't delete remembered context. Try again.",`,
    "memory deletion client copy",
  );

  source = replaceRequired(
    source,
    `    googleSignInUnavailable:\n      "Google sign-in is not configured yet. Guest chat is still available.",`,
    `    googleSignInUnavailable:\n      "Google sign-in is not configured yet. Guest chat is still available.",\n    signInRequired: "Sign in to delete remembered context.",\n    memoryUnavailable:\n      "Remembered context is unavailable right now. Try again later.",`,
    "memory deletion API copy",
  );

  return write(path, source);
}

async function updatePage() {
  const path = "src/page.js";
  let source = await read(path);

  source = replaceRequired(
    source,
    `  const privateChatStatus = signedIn\n    ? \`<p id="private-chat-status" class="private-chat-status" role="status" hidden>\n          \${escapeHtml(client.privateChatStatus)}\n        </p>\`\n    : "";`,
    `  const privateChatStatus = signedIn\n    ? \`<p id="private-chat-status" class="private-chat-status" role="status" hidden>\n          \${escapeHtml(client.privateChatStatus)}\n        </p>\`\n    : "";\n  const memoryDeleteControl = signedIn\n    ? \`<div class="memory-delete-control">\n          <button\n            id="delete-memory-button"\n            class="auth-link memory-delete-button"\n            type="button"\n          >\${escapeHtml(client.deleteMemoryButton)}</button>\n          <p\n            id="delete-memory-status"\n            class="memory-delete-status"\n            role="status"\n            hidden\n          ></p>\n        </div>\`\n    : "";`,
    "memory deletion menu control",
  );

  source = replaceRequired(
    source,
    `              <div class="menu-account" aria-label="\${escapeHtml(page.auth.label)}">\n                \${authControl}\n              </div>`,
    `              <div class="menu-account" aria-label="\${escapeHtml(page.auth.label)}">\n                \${authControl}\n                \${memoryDeleteControl}\n              </div>`,
    "memory deletion menu placement",
  );

  source = replaceRequired(
    source,
    `<script type="module" src="/app.js?v=20260806-static-mobile-background-1"></script>`,
    `<script type="module" src="/app.js?v=20260807-memory-deletion-1"></script>`,
    "memory deletion app cache bust",
  );

  return write(path, source);
}

async function updateClient() {
  const path = "public/app.js";
  let source = await read(path);

  source = replaceRequired(
    source,
    `const privateChatStatus = document.querySelector("#private-chat-status");`,
    `const privateChatStatus = document.querySelector("#private-chat-status");\nconst deleteMemoryButton = document.querySelector("#delete-memory-button");\nconst deleteMemoryStatus = document.querySelector("#delete-memory-status");`,
    "memory deletion DOM controls",
  );

  source = replaceRequired(
    source,
    `let privateChat = false;\nlet privateThreadMessages = [];`,
    `let privateChat = false;\nlet privateThreadMessages = [];\nlet memoryDeletePending = false;\nlet activeChatController = null;\nlet conversationResetVersion = 0;`,
    "memory deletion client state",
  );

  source = replaceRequired(
    source,
    `function resetConversationView() {\n  resetPrivateThread();`,
    `function resetConversationView() {\n  conversationResetVersion += 1;\n  if (activeChatController instanceof AbortController) {\n    activeChatController.abort();\n  }\n  activeChatController = null;\n  resetPrivateThread();`,
    "conversation reset abort",
  );

  source = replaceRequired(
    source,
    `async function startNewConversation() {\n  if (pending || !(newConversationButton instanceof HTMLButtonElement)) return;`,
    `function setMemoryDeleteStatus(message, isError = false) {\n  if (!(deleteMemoryStatus instanceof HTMLElement)) return;\n  const clean = String(message || "").trim();\n  deleteMemoryStatus.textContent = clean;\n  deleteMemoryStatus.hidden = !clean;\n  deleteMemoryStatus.dataset.state = isError ? "error" : "success";\n}\n\nasync function deleteRememberedContext() {\n  if (\n    memoryDeletePending ||\n    !(deleteMemoryButton instanceof HTMLButtonElement)\n  ) {\n    return;\n  }\n  if (!window.confirm(copy.deleteMemoryConfirm)) return;\n\n  memoryDeletePending = true;\n  deleteMemoryButton.disabled = true;\n  deleteMemoryButton.textContent = copy.deleteMemoryPending;\n  setMemoryDeleteStatus("");\n\n  try {\n    const response = await fetch("/api/account/memory", {\n      method: "DELETE",\n      headers: { Accept: "application/json" },\n    });\n    const result = await response.json().catch(() => ({}));\n    if (!response.ok) {\n      throw new Error(String(result.error || copy.deleteMemoryFailed));\n    }\n\n    resetConversationView();\n    setPending(false);\n    setMemoryDeleteStatus(copy.deleteMemorySuccess);\n  } catch (error) {\n    setMemoryDeleteStatus(\n      String(error?.message || copy.deleteMemoryFailed),\n      true,\n    );\n  } finally {\n    memoryDeletePending = false;\n    deleteMemoryButton.disabled = false;\n    deleteMemoryButton.textContent = copy.deleteMemoryButton;\n    deleteMemoryButton.focus({ preventScroll: true });\n  }\n}\n\nasync function startNewConversation() {\n  if (pending || !(newConversationButton instanceof HTMLButtonElement)) return;`,
    "memory deletion client action",
  );

  source = replaceRequired(
    source,
    `  const visibleUserText = String(nextVisibleUserText || clean).trim() || clean;\n  nextVisibleUserText = "";`,
    `  const requestResetVersion = conversationResetVersion;\n  const controller = new AbortController();\n  activeChatController = controller;\n  const visibleUserText = String(nextVisibleUserText || clean).trim() || clean;\n  nextVisibleUserText = "";`,
    "chat request abort controller",
  );

  source = replaceRequired(
    source,
    `      body: JSON.stringify({\n        message: clean,\n        awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),\n        privateChat,\n        messages: privateChat ? privateThreadMessages : undefined,\n      }),\n    });`,
    `      body: JSON.stringify({\n        message: clean,\n        awaitingSafetyAnswer: currentAwaitingSafetyAnswer(),\n        privateChat,\n        messages: privateChat ? privateThreadMessages : undefined,\n      }),\n      signal: controller.signal,\n    });\n\n    if (requestResetVersion !== conversationResetVersion) return;`,
    "chat fetch abort signal",
  );

  source = replaceRequired(
    source,
    `      const result = await readStreamingResponse(response, pendingOutput);\n      const reply = String(result.reply || copy.missingReply);`,
    `      const result = await readStreamingResponse(response, pendingOutput);\n      if (requestResetVersion !== conversationResetVersion) return;\n      const reply = String(result.reply || copy.missingReply);`,
    "stream reset fence",
  );

  source = replaceRequired(
    source,
    `    const result = await response.json().catch(() => ({}));\n\n    if (!response.ok) {`,
    `    const result = await response.json().catch(() => ({}));\n    if (requestResetVersion !== conversationResetVersion) return;\n\n    if (!response.ok) {`,
    "JSON reset fence",
  );

  source = replaceRequired(
    source,
    `  } catch (error) {\n    rollbackPrivateUser(clean);\n    input.value = clean;`,
    `  } catch (error) {\n    if (\n      controller.signal.aborted ||\n      requestResetVersion !== conversationResetVersion\n    ) {\n      return;\n    }\n    rollbackPrivateUser(clean);\n    input.value = clean;`,
    "silent deletion abort handling",
  );

  source = replaceRequired(
    source,
    `  } finally {\n    setPending(false);\n    input.focus({ preventScroll: true });\n  }\n}\n\nform.addEventListener`,
    `  } finally {\n    if (activeChatController === controller) activeChatController = null;\n    if (requestResetVersion === conversationResetVersion) {\n      setPending(false);\n      input.focus({ preventScroll: true });\n    }\n  }\n}\n\nform.addEventListener`,
    "chat reset-aware finalization",
  );

  source = replaceRequired(
    source,
    `if (newConversationButton instanceof HTMLButtonElement) {\n  newConversationButton.addEventListener("click", () => {\n    void startNewConversation();\n  });\n}\n\nif (signOutForm instanceof HTMLFormElement) {`,
    `if (newConversationButton instanceof HTMLButtonElement) {\n  newConversationButton.addEventListener("click", () => {\n    void startNewConversation();\n  });\n}\n\nif (deleteMemoryButton instanceof HTMLButtonElement) {\n  deleteMemoryButton.addEventListener("click", () => {\n    void deleteRememberedContext();\n  });\n}\n\nif (signOutForm instanceof HTMLFormElement) {`,
    "memory deletion event listener",
  );

  return write(path, source);
}

async function updateStyles() {
  const path = "public/product.css";
  let source = await read(path);
  source = appendOnce(
    source,
    ".memory-delete-control {",
    `.memory-delete-control {\n  display: grid;\n  gap: 0.35rem;\n  margin-top: 0.55rem;\n}\n\n.memory-delete-button {\n  justify-self: start;\n  text-align: left;\n}\n\n.memory-delete-status {\n  margin: 0;\n  max-width: 30rem;\n  font-size: 0.78rem;\n  line-height: 1.4;\n  opacity: 0.9;\n}\n\n.memory-delete-status[data-state="error"] {\n  font-weight: 600;\n}`,
  );
  return write(path, source);
}

async function updatePrivacyDocs() {
  const rootPath = "PRIVACY.md";
  let root = await read(rootPath);
  root = replaceRequired(
    root,
    "- a model-generated rolling summary of at most 1,600 characters",
    "- a model-generated rolling summary of at most 1,000 characters",
    "documented summary limit",
  );
  root = replaceRequired(
    root,
    "The memory record expires 30 days after the last stored exchange. Signing out removes access from that browser but does not immediately delete the server record; signing in again with the same Google account restores access until the record expires. The public application does not expose an early-erasure endpoint.",
    "The memory record expires 30 days after the last stored exchange. Signing out removes access from that browser but does not immediately delete the server record; signing in again with the same Google account restores access until the record expires. Signed-in users can use **Delete remembered context** to erase the rolling summary, recent-message buffer, pending safety-answer state, and retention alarm immediately. A non-content generation counter remains so replies or compactions that started before deletion cannot recreate the erased memory. Billing and usage records are stored separately and are not deleted by this control.",
    "root privacy deletion behavior",
  );
  root = replaceRequired(
    root,
    "- Cookie deletion or sign-out removes local access but does not erase an unexpired server record.",
    "- Cookie deletion or sign-out removes local access but does not erase an unexpired server record; the signed-in deletion control does.",
    "root privacy deletion limitation",
  );
  await write(rootPath, root);

  const publicPath = "public/privacy.html";
  let page = await read(publicPath);
  page = replaceRequired(
    page,
    `        Google sign-in is optional on the website and is used only to associate a one-way account\n        alias with a rolling summary and a small recent-message buffer. The current implementation\n        is designed to delete that remembered Stabilize context 30 days after the last stored\n        exchange. This local retention limit does not shorten the separate OpenAI storage period.`,
    `        Google sign-in is optional on the website and is used only to associate a one-way account\n        alias with a rolling summary of at most 1,000 characters and a small recent-message buffer.\n        The current implementation is designed to delete that remembered Stabilize context 30 days\n        after the last stored exchange. Signed-in users can also choose <strong>Delete remembered\n        context</strong> in the account menu to erase the summary, recent messages, and pending\n        safety-answer state immediately. Stabilize retains only a non-content generation counter so\n        work that started before deletion cannot recreate the erased memory. Billing and usage\n        records are separate and are not deleted by this control. This local deletion does not undo\n        processing already completed by Cloudflare or OpenAI.`,
    "public signed-in deletion description",
  );
  page = replaceRequired(
    page,
    `        See <a href="/support.html">Support</a> for contact information. Stabilize cannot identify a\n        particular guest chat as an account history for deletion. Signed-in web requests can cover\n        account-linked records controlled by Stabilize. A local deletion, Private chat setting, or\n        consent revocation does not recall processing already completed by a provider or shorten\n        OpenAI's stored Responses retention period.`,
    `        See <a href="/support.html">Support</a> for contact information. Stabilize cannot identify a\n        particular guest chat as an account history for deletion. Signed-in users can delete the\n        remembered context controlled by Stabilize directly from the account menu. That control does\n        not delete subscription or usage records, recall processing already completed by a provider,\n        or shorten OpenAI's stored Responses retention period.`,
    "public deletion request guidance",
  );
  page = replaceRequired(
    page,
    "Last reviewed August 4, 2026.",
    "Last reviewed August 7, 2026.",
    "public privacy review date",
  );
  await write(publicPath, page);
}

const changes = await Promise.all([
  updateSessionMemory(),
  updateWorker(),
  updateCopy(),
  updatePage(),
  updateClient(),
  updateStyles(),
  updatePrivacyDocs(),
]);

console.log(
  changes.some(Boolean)
    ? "Applied immediate remembered-context deletion with stale-write protection."
    : "Remembered-context deletion is already materialized.",
);

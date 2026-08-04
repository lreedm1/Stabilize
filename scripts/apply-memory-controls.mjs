import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`Memory-controls policy could not find ${label}`);
  }
}

await update("src/copy.js", (source) => {
  let text = source;

  if (!text.includes('memoryControlsLabel: "Memory controls"')) {
    const anchor = '      newConversationButton: "New conversation",';
    requireText(text, anchor, "the new-conversation label");
    text = text.replace(
      anchor,
      `${anchor}\n      memoryControlsLabel: "Memory controls",`,
    );
  }

  const privateSentence =
    "Private chat does not use or update that Stabilize memory.";
  const controlsSentence =
    "Signed-in users can review, correct, disable, or delete that memory from Memory controls.";
  if (!text.includes(controlsSentence)) {
    requireText(text, privateSentence, "the private-chat memory disclosure");
    text = text.replace(
      privateSentence,
      `${privateSentence} ${controlsSentence}`,
    );
  }

  if (!text.includes('signInRequired: "Sign in to manage Stabilize memory."')) {
    const anchor = `    googleSignInUnavailable:
      "Google sign-in is not configured yet. Guest chat is still available.",`;
    requireText(text, anchor, "the API sign-in copy anchor");
    text = text.replace(
      anchor,
      `${anchor}
    signInRequired: "Sign in to manage Stabilize memory.",
    memoryUnavailable: "Stabilize memory is unavailable right now.",
    invalidMemoryUpdate: "Choose one valid memory change.",`,
    );
  }

  requireText(text, 'memoryControlsLabel: "Memory controls"', "the memory menu label");
  requireText(text, "review, correct, disable, or delete", "the memory-controls disclosure");
  requireText(text, "memoryUnavailable", "the memory API error copy");
  return text;
});

await update("src/page.js", (source) => {
  let text = source;

  if (!text.includes("const memoryMenuLink = signedIn")) {
    const anchor = `  const privateChatStatus = signedIn
    ? \`<p id="private-chat-status" class="private-chat-status" role="status" hidden>
          \${escapeHtml(client.privateChatStatus)}
        </p>\`
    : "";`;
    requireText(text, anchor, "the private-chat status definition");
    text = text.replace(
      anchor,
      `${anchor}
  const memoryMenuLink = signedIn
    ? \`<a href="/memory">\${escapeHtml(page.chat.memoryControlsLabel)}</a>\`
    : "";`,
    );
  }

  if (!text.includes("${memoryMenuLink}")) {
    const anchor = `              <nav class="menu-links" aria-label="Site pages">
                <a href="/about.html">About</a>`;
    requireText(text, anchor, "the site menu navigation");
    text = text.replace(
      anchor,
      `              <nav class="menu-links" aria-label="Site pages">
                \${memoryMenuLink}
                <a href="/about.html">About</a>`,
    );
  }

  requireText(text, "const memoryMenuLink = signedIn", "the signed-in memory link");
  requireText(text, "${memoryMenuLink}", "the rendered memory link");
  return text;
});

await update("src/session-memory.js", (source) => {
  let text = source;

  if (!text.includes("CREATE TABLE IF NOT EXISTS memory_preferences")) {
    const anchor = `        CREATE TABLE IF NOT EXISTS recent_messages (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );`;
    requireText(text, anchor, "the recent-message schema");
    text = text.replace(
      anchor,
      `${anchor}

        CREATE TABLE IF NOT EXISTS memory_preferences (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL
        );`,
    );
  }

  if (!text.includes("memoryEnabledValue()")) {
    const anchor = "  async readContext() {";
    requireText(text, anchor, "the context reader");
    const helpers = `  memoryEnabledValue() {
    const preference = this.ctx.storage.sql
      .exec("SELECT enabled FROM memory_preferences WHERE id = 1")
      .toArray()[0];
    return !preference || Number(preference.enabled) !== 0;
  }

  currentTurnCount() {
    const state = this.ctx.storage.sql
      .exec("SELECT turn_count FROM memory_state WHERE id = 1")
      .toArray()[0];
    return Number(state?.turn_count) || 0;
  }

`;
    text = text.replace(anchor, helpers + anchor);
  }

  if (!text.includes("async readContext() {\n    if (!this.memoryEnabledValue())")) {
    const anchor = "  async readContext() {";
    requireText(text, anchor, "the context-reader signature");
    text = text.replace(
      anchor,
      `${anchor}
    if (!this.memoryEnabledValue()) return emptyContext();`,
    );
  }

  if (!text.includes("async recordExchange(exchange) {\n    if (!this.memoryEnabledValue())")) {
    const anchor = "  async recordExchange(exchange) {";
    requireText(text, anchor, "the exchange writer");
    text = text.replace(
      anchor,
      `${anchor}
    if (!this.memoryEnabledValue()) {
      return {
        shouldCompact: false,
        turnCount: this.currentTurnCount(),
        memoryEnabled: false,
      };
    }`,
    );
  }

  if (!text.includes("async isMemoryEnabled()")) {
    const anchor = "  async startNewConversation() {";
    requireText(text, anchor, "the generated new-conversation method");
    const methods = `  async isMemoryEnabled() {
    return this.memoryEnabledValue();
  }

  async readMemorySettings() {
    const state = this.ctx.storage.sql
      .exec(
        \`SELECT summary, turn_count, created_at, updated_at
         FROM memory_state WHERE id = 1\`,
      )
      .toArray()[0];
    const recent = this.ctx.storage.sql
      .exec(
        \`SELECT sequence, role, content, created_at
         FROM recent_messages
         ORDER BY sequence ASC\`,
      )
      .toArray()
      .map((message) => ({
        sequence: Number(message.sequence),
        role: message.role,
        content: boundedText(message.content, MAX_STORED_MESSAGE_CHARS),
        createdAt: validTimestamp(message.created_at),
      }));

    return {
      enabled: this.memoryEnabledValue(),
      summary: boundedText(state?.summary, MAX_SUMMARY_CHARS),
      recent,
      turnCount: Number(state?.turn_count) || 0,
      createdAt: validTimestamp(state?.created_at),
      updatedAt: validTimestamp(state?.updated_at),
    };
  }

  async setMemoryEnabled(enabled) {
    if (typeof enabled !== "boolean") {
      throw new Error("Invalid memory preference");
    }
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        \`INSERT INTO memory_preferences (id, enabled, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at\`,
        enabled ? 1 : 0,
        now,
      );
      if (!enabled) {
        this.ctx.storage.sql.exec(
          "UPDATE memory_state SET awaiting_safety_answer = 0 WHERE id = 1",
        );
      }
    });
    return this.readMemorySettings();
  }

  async replaceMemorySummary(summary) {
    if (typeof summary !== "string") {
      throw new Error("Invalid memory summary");
    }
    const cleanSummary = boundedText(summary, MAX_SUMMARY_CHARS);
    const now = Date.now();
    await this.ctx.storage.setAlarm(now + SESSION_RETENTION_MS);
    this.ctx.storage.sql.exec(
      \`INSERT INTO memory_state (
         id, summary, summary_version, turn_count,
         awaiting_safety_answer, created_at, updated_at
       ) VALUES (1, ?, 1, 0, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         summary = excluded.summary,
         summary_version = memory_state.summary_version + 1,
         awaiting_safety_answer = 0,
         updated_at = excluded.updated_at\`,
      cleanSummary,
      now,
      now,
    );
    return this.readMemorySettings();
  }

  async deleteRecentMemory(sequence) {
    const cleanSequence = Number(sequence);
    if (!Number.isSafeInteger(cleanSequence) || cleanSequence < 1) {
      throw new Error("Invalid recent-memory sequence");
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM recent_messages WHERE sequence = ?",
        cleanSequence,
      );
      this.ctx.storage.sql.exec(
        "UPDATE memory_state SET awaiting_safety_answer = 0, updated_at = ? WHERE id = 1",
        Date.now(),
      );
    });
    return this.readMemorySettings();
  }

  async clearRecentMemory() {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM recent_messages");
      this.ctx.storage.sql.exec(
        "UPDATE memory_state SET awaiting_safety_answer = 0, updated_at = ? WHERE id = 1",
        Date.now(),
      );
    });
    return this.readMemorySettings();
  }

  async deleteAllMemory() {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM recent_messages");
      this.ctx.storage.sql.exec("DELETE FROM memory_state");
    });
    if (typeof this.ctx.storage.deleteAlarm === "function") {
      await this.ctx.storage.deleteAlarm();
    }
    return this.readMemorySettings();
  }

`;
    text = text.replace(anchor, methods + anchor);
  }

  if (!text.includes("async startNewConversation() {\n    if (!this.memoryEnabledValue())")) {
    const anchor = "  async startNewConversation() {";
    requireText(text, anchor, "the new-conversation method");
    text = text.replace(
      anchor,
      `${anchor}
    if (!this.memoryEnabledValue()) return { started: true };`,
    );
  }

  if (!text.includes("async getCompactionSnapshot() {\n    if (!this.memoryEnabledValue())")) {
    const anchor = "  async getCompactionSnapshot() {";
    requireText(text, anchor, "the compaction snapshot method");
    text = text.replace(
      anchor,
      `${anchor}
    if (!this.memoryEnabledValue()) return null;`,
    );
  }

  if (!text.includes("async applySummary(summary, expectedVersion, throughSequence) {\n    if (!this.memoryEnabledValue())")) {
    const anchor =
      "  async applySummary(summary, expectedVersion, throughSequence) {";
    requireText(text, anchor, "the summary writer");
    text = text.replace(
      anchor,
      `${anchor}
    if (!this.memoryEnabledValue()) return false;`,
    );
  }

  requireText(text, "CREATE TABLE IF NOT EXISTS memory_preferences", "the memory preference table");
  requireText(text, "async readMemorySettings()", "the editable memory reader");
  requireText(text, "async deleteAllMemory()", "the complete erasure method");
  requireText(text, "if (!this.memoryEnabledValue()) return emptyContext()", "the disabled read boundary");
  return text;
});

await update("src/index.js", (source) => {
  let text = source;

  if (!text.includes('import { renderMemoryPage } from "./memory-page.js";')) {
    const anchor = 'import { renderPage } from "./page.js";';
    requireText(text, anchor, "the main page import");
    text = text.replace(
      anchor,
      `${anchor}\nimport { renderMemoryPage } from "./memory-page.js";`,
    );
  }

  if (!text.includes("async function readMemoryEnabledForChat(")) {
    const anchor = "async function handleNewConversation(";
    requireText(text, anchor, "the new-conversation handler");
    const helpers = `function publicMemorySettings(settings) {
  const recent = Array.isArray(settings?.recent)
    ? settings.recent
        .map((entry) => ({
          sequence: Number(entry?.sequence),
          role: entry?.role === "assistant" ? "assistant" : "user",
          content: String(entry?.content || "").trim().slice(0, MAX_MESSAGE_CHARS),
          createdAt: Number(entry?.createdAt) || null,
        }))
        .filter(
          (entry) =>
            Number.isSafeInteger(entry.sequence) &&
            entry.sequence > 0 &&
            entry.content,
        )
        .slice(-8)
    : [];

  return {
    enabled: settings?.enabled !== false,
    summary: String(settings?.summary || "").trim().slice(0, 1_000),
    recent,
    turnCount: Number(settings?.turnCount) || 0,
    updatedAt: Number(settings?.updatedAt) || null,
  };
}

async function readMemoryEnabledForChat(stub) {
  if (!stub) return false;
  if (typeof stub.isMemoryEnabled !== "function") return true;
  try {
    return (await stub.isMemoryEnabled()) !== false;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "session_memory_preference_read_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return false;
  }
}

async function handleMemoryRequest(request, env, accountKey, pathname) {
  if (!accountKey) {
    return jsonResponse({ error: COPY.api.signInRequired }, 401);
  }
  const stub = accountMemoryStub(env, accountKey);
  if (!stub || typeof stub.readMemorySettings !== "function") {
    return jsonResponse({ error: COPY.api.memoryUnavailable }, 503);
  }

  if (request.method === "GET" && pathname === "/api/memory") {
    return jsonResponse(publicMemorySettings(await stub.readMemorySettings()));
  }

  if (!["PATCH", "DELETE"].includes(request.method)) {
    return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
  }
  if (!sameOriginOrNonBrowser(request)) {
    return jsonResponse({ error: COPY.api.crossOriginRequest }, 403);
  }

  if (request.method === "PATCH" && pathname === "/api/memory") {
    const body = await readBoundedJson(request);
    const hasEnabled = Object.prototype.hasOwnProperty.call(body, "enabled");
    const hasSummary = Object.prototype.hasOwnProperty.call(body, "summary");
    if (Number(hasEnabled) + Number(hasSummary) !== 1) {
      return jsonResponse({ error: COPY.api.invalidMemoryUpdate }, 400);
    }

    if (hasEnabled) {
      if (
        typeof body.enabled !== "boolean" ||
        typeof stub.setMemoryEnabled !== "function"
      ) {
        return jsonResponse({ error: COPY.api.invalidMemoryUpdate }, 400);
      }
      return jsonResponse(
        publicMemorySettings(await stub.setMemoryEnabled(body.enabled)),
      );
    }

    if (
      typeof body.summary !== "string" ||
      body.summary.length > 1_000 ||
      typeof stub.replaceMemorySummary !== "function"
    ) {
      return jsonResponse({ error: COPY.api.invalidMemoryUpdate }, 400);
    }
    return jsonResponse(
      publicMemorySettings(await stub.replaceMemorySummary(body.summary)),
    );
  }

  if (request.method === "DELETE" && pathname === "/api/memory") {
    if (typeof stub.deleteAllMemory !== "function") {
      return jsonResponse({ error: COPY.api.memoryUnavailable }, 503);
    }
    return jsonResponse(publicMemorySettings(await stub.deleteAllMemory()));
  }

  if (request.method === "DELETE" && pathname === "/api/memory/recent") {
    if (typeof stub.clearRecentMemory !== "function") {
      return jsonResponse({ error: COPY.api.memoryUnavailable }, 503);
    }
    return jsonResponse(publicMemorySettings(await stub.clearRecentMemory()));
  }

  const recentMatch = pathname.match(/^\/api\/memory\/recent\/(\d+)$/);
  if (request.method === "DELETE" && recentMatch) {
    if (typeof stub.deleteRecentMemory !== "function") {
      return jsonResponse({ error: COPY.api.memoryUnavailable }, 503);
    }
    return jsonResponse(
      publicMemorySettings(
        await stub.deleteRecentMemory(Number(recentMatch[1])),
      ),
    );
  }

  return jsonResponse({ error: COPY.api.notFound }, 404);
}

`;
    text = text.replace(anchor, helpers + anchor);
  }

  const oldStub =
    "  const stub = privateChat ? null : accountMemoryStub(env, accountKey);";
  const gatedStub = `  const accountStub = privateChat
    ? null
    : accountMemoryStub(env, accountKey);
  const stub =
    accountStub && (await readMemoryEnabledForChat(accountStub))
      ? accountStub
      : null;`;
  if (text.includes(oldStub)) {
    text = text.replace(oldStub, gatedStub);
  } else {
    requireText(text, gatedStub, "the memory-enabled chat boundary");
  }

  if (!text.includes('url.pathname === "/memory"')) {
    const anchor = `      if (url.pathname === "/auth/google") {`;
    requireText(text, anchor, "the Google sign-in route");
    const route = `      if (url.pathname === "/memory" || url.pathname === "/memory.html") {
        if (!["GET", "HEAD"].includes(request.method)) {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        const authSession = await readAuthSession(request, env);
        const headers = pageHeaders();
        appendRetiredCookieCleanup(headers, request, authSession);
        return new Response(
          request.method === "HEAD"
            ? null
            : renderMemoryPage({
                signedIn: Boolean(authSession),
                googleSignInAvailable: googleAuthConfigured(env),
              }),
          { headers },
        );
      }

`;
    text = text.replace(anchor, route + anchor);
  }

  if (!text.includes('url.pathname === "/api/memory"')) {
    const anchor = `      if (url.pathname === "/api/chat") {`;
    requireText(text, anchor, "the chat API route");
    const route = `      if (
        url.pathname === "/api/memory" ||
        url.pathname === "/api/memory/recent" ||
        /^\/api\/memory\/recent\/\d+$/.test(url.pathname)
      ) {
        const authSession = await readAuthSession(request, env);
        return await handleMemoryRequest(
          request,
          env,
          authSession?.accountKey,
          url.pathname,
        );
      }

`;
    text = text.replace(anchor, route + anchor);
  }

  requireText(text, 'renderMemoryPage } from "./memory-page.js"', "the memory page renderer");
  requireText(text, "async function handleMemoryRequest(", "the memory API handler");
  requireText(text, "await readMemoryEnabledForChat(accountStub)", "the disabled-memory chat gate");
  requireText(text, 'url.pathname === "/api/memory"', "the memory API route");
  return text;
});

await update("PRIVACY.md", (source) => {
  let text = source;
  const oldErasure =
    "The public application does not expose an early-erasure endpoint.";
  const newErasure =
    "Signed-in users can open **Memory controls** to view the raw rolling summary and bounded recent-message buffer controlled by Stabilize, replace or clear the summary, delete individual recent entries, clear the recent buffer, delete all remembered context, or turn memory off. Turning memory off prevents account memory from being read or updated while preserving the saved context until the user deletes it or the content retention window expires. The enabled/disabled preference is retained separately from message content so deletion does not silently turn memory back on.";
  if (text.includes(oldErasure)) text = text.replace(oldErasure, newErasure);

  const oldLimitation =
    "- Cookie deletion or sign-out removes local access but does not erase an unexpired server record.";
  const newLimitation =
    "- Signing out removes local access but does not erase an unexpired server record; signed-in users can instead use Memory controls for early erasure or to turn memory off.";
  if (text.includes(oldLimitation)) {
    text = text.replace(oldLimitation, newLimitation);
  }

  const providerAnchor =
    "Both requests use `store: true`, so OpenAI stores the resulting response data as application state for at least 30 days under its current platform policy.";
  const providerAddition =
    "Both requests use `store: true`, so OpenAI stores the resulting response data as application state for at least 30 days under its current platform policy. Stabilize memory controls affect only account context stored by this application; they cannot recall provider processing or delete provider-held response data.";
  if (
    !text.includes(
      "Stabilize memory controls affect only account context stored by this application",
    ) &&
    text.includes(providerAnchor)
  ) {
    text = text.replace(providerAnchor, providerAddition);
  }

  requireText(text, "Signed-in users can open **Memory controls**", "the repository memory-controls disclosure");
  requireText(text, "cannot recall provider processing", "the provider erasure boundary");
  return text;
});

await update("public/privacy.html", (source) => {
  let text = source;

  if (!text.includes("<h2>Memory controls</h2>")) {
    const anchor = `      <h2>Public feedback</h2>`;
    requireText(text, anchor, "the public-feedback privacy section");
    const section = `      <h2>Memory controls</h2>
      <p>
        Signed-in web users can open <a href="/memory">Memory controls</a> to view the raw rolling
        summary and bounded recent-message buffer controlled by Stabilize. They can correct or
        clear the summary, delete individual recent entries, clear the recent buffer, delete all
        remembered context, or turn memory off.
      </p>
      <p>
        When memory is off, saved account context is not read or updated. Existing context remains
        available for deletion and can be used again only after memory is turned back on. Deleting
        all remembered context preserves the off setting so deletion does not silently re-enable
        memory. These controls affect Stabilize account memory only; they cannot recall processing
        already completed by Cloudflare, OpenAI, or another provider.
      </p>

`;
    text = text.replace(anchor, section + anchor);
  }

  const oldDeletion = `        See <a href="/support.html">Support</a> for contact information. Stabilize cannot identify a
        particular guest chat as an account history for deletion. Signed-in web requests can cover
        account-linked records controlled by Stabilize. A local deletion or consent revocation does
        not recall processing already completed by a provider or shorten OpenAI's stored Responses
        retention period.`;
  const newDeletion = `        Stabilize cannot identify a particular guest chat as an account history for deletion.
        Signed-in users can use <a href="/memory">Memory controls</a> for immediate viewing,
        correction, disabling, and deletion of account-linked context controlled by Stabilize, or
        see <a href="/support.html">Support</a> for help. A local deletion or consent revocation does
        not recall processing already completed by a provider or shorten OpenAI's stored Responses
        retention period.`;
  if (text.includes(oldDeletion)) text = text.replace(oldDeletion, newDeletion);

  text = text.replace(
    "Last reviewed August 3, 2026.",
    "Last reviewed August 4, 2026.",
  );

  requireText(text, "<h2>Memory controls</h2>", "the public memory-controls section");
  requireText(text, "turn memory off", "the public disable-memory disclosure");
  requireText(text, "cannot recall processing", "the public provider boundary");
  return text;
});

await update("test/ui.test.mjs", (source) => {
  const oldTest = `test("the site does not expose a remembered-context deletion control", async () => {
  const [clientScript, styles, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(clientScript, /forgetMemory|\/api\/session/);
  assert.doesNotMatch(styles, /forget-memory/);
  assert.doesNotMatch(pageSource, /forget-memory|forgetMemory/);
});`;
  const newTest = `test("signed-in users can reach remembered-context controls", async () => {
  const [pageSource, memoryPage, memoryClient] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/memory-page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/memory.js", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /const memoryMenuLink = signedIn/);
  assert.match(pageSource, /href="\/memory"/);
  assert.match(memoryPage, /id="memory-enabled"/);
  assert.match(memoryPage, /id="delete-all-memory"/);
  assert.match(memoryClient, /fetch\(path/);
  assert.match(memoryClient, /\/api\/memory/);
  assert.doesNotMatch(memoryClient, /localStorage|sessionStorage|innerHTML\s*=/);
});`;

  if (source.includes(oldTest)) return source.replace(oldTest, newTest);
  requireText(source, newTest, "the positive memory-controls UI test");
  return source;
});

await update("test/private-chat.test.mjs", (source) => {
  let text = source;
  text = text.replace(
    /assert\.match\(\s*workerSource,\s*\/const stub = privateChat \\? null : accountMemoryStub\\\(env, accountKey\\\);\/[,]?\s*\);/,
    `assert.match(
    workerSource,
    /const accountStub = privateChat[\s\S]*accountMemoryStub\(env, accountKey\)/,
  );
  assert.match(workerSource, /await readMemoryEnabledForChat\(accountStub\)/);`,
  );

  if (!text.includes("await readMemoryEnabledForChat\\(accountStub\\)")) {
    const oldAssertion = `  assert.match(
    workerSource,
    /const stub = privateChat \? null : accountMemoryStub\(env, accountKey\);/,
  );`;
    const newAssertion = `  assert.match(
    workerSource,
    /const accountStub = privateChat[\s\S]*accountMemoryStub\(env, accountKey\)/,
  );
  assert.match(workerSource, /await readMemoryEnabledForChat\(accountStub\)/);`;
    requireText(text, oldAssertion, "the private-chat memory boundary assertion");
    text = text.replace(oldAssertion, newAssertion);
  }

  requireText(text, "await readMemoryEnabledForChat\\(accountStub\\)", "the updated private-chat regression check");
  return text;
});

console.log("Applied signed-in memory viewing, correction, disable, and deletion controls.");

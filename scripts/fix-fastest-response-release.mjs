import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform, { optional = false } = {}) {
  let before;
  try {
    before = await readFile(path, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return;
    throw error;
  }
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Fastest-response release repair could not find ${label}`);
  }
}

function occurrences(value, expected) {
  return value.split(expected).length - 1;
}

await update("src/impact-analytics.js", (source) => {
  let text = source;

  if (!text.includes("          conversation_hash TEXT,")) {
    const marker = `          session_hash TEXT NOT NULL,
          browser_hash TEXT NOT NULL,
          account_type TEXT NOT NULL,`;
    requireText(text, marker, "the chat-turn identity columns");
    text = text.replace(
      marker,
      `          session_hash TEXT NOT NULL,
          browser_hash TEXT NOT NULL,
          conversation_hash TEXT,
          account_type TEXT NOT NULL,`,
    );
  }

  if (!text.includes('exec("PRAGMA table_info(chat_turns)")')) {
    const marker = `      \`);
    });
  }

  async scheduleRetention`;
    requireText(text, marker, "the analytics constructor ending");
    const migration = `      \`);

      const chatTurnColumns = this.ctx.storage.sql
        .exec("PRAGMA table_info(chat_turns)")
        .toArray();
      if (
        !chatTurnColumns.some(
          (column) => column.name === "conversation_hash",
        )
      ) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE chat_turns ADD COLUMN conversation_hash TEXT",
        );
      }
      this.ctx.storage.sql.exec(
        \`CREATE INDEX IF NOT EXISTS chat_turns_conversation
         ON chat_turns (conversation_hash, occurred_at)\`,
      );
    });
  }

  async scheduleRetention`;
    text = text.replace(marker, migration);
  }

  if (!text.includes("record?.conversationHash")) {
    const marker = `    const sessionHash = boundedText(record?.sessionHash, 128);
    const browserHash = boundedText(record?.browserHash, 128);
    if (!turnId || !sessionHash || !browserHash) return false;`;
    requireText(text, marker, "the chat-start identifiers");
    text = text.replace(
      marker,
      `    const sessionHash = boundedText(record?.sessionHash, 128);
    const browserHash = boundedText(record?.browserHash, 128);
    const conversationHash =
      boundedText(record?.conversationHash, 128) || sessionHash;
    if (!turnId || !sessionHash || !browserHash) return false;`,
    );
  }

  if (!text.includes("browser_hash, conversation_hash,")) {
    const marker = `      \`INSERT INTO chat_turns (
         turn_id, occurred_at, session_hash, browser_hash,
         account_type, route, status, model, estimated_cost_micros
       ) VALUES (?, ?, ?, ?, ?, NULL, 'started', ?, ?)
       ON CONFLICT(turn_id) DO NOTHING\`,
      turnId,
      occurredAt,
      sessionHash,
      browserHash,
      boundedText(record?.accountType, 24) || "guest",`;
    requireText(text, marker, "the chat-turn insert");
    text = text.replace(
      marker,
      `      \`INSERT INTO chat_turns (
         turn_id, occurred_at, session_hash, browser_hash, conversation_hash,
         account_type, route, status, model, estimated_cost_micros
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'started', ?, ?)
       ON CONFLICT(turn_id) DO NOTHING\`,
      turnId,
      occurredAt,
      sessionHash,
      browserHash,
      conversationHash,
      boundedText(record?.accountType, 24) || "guest",`,
    );
  }

  if (!text.includes("const conversationRows = this.ctx.storage.sql")) {
    const marker = `    const chatSessionRows = this.ctx.storage.sql
      .exec(
        \`SELECT session_hash, COUNT(*) AS count
         FROM chat_turns
         WHERE occurred_at >= ?
         GROUP BY session_hash\`,
        since,
      )
      .toArray();
    const chatSessions = chatSessionRows.length;
    const multiTurnSessions = chatSessionRows.filter(
      (row) => Number(row.count || 0) >= 2,
    ).length;`;
    requireText(text, marker, "the legacy session aggregation");
    text = text.replace(
      marker,
      `    const conversationRows = this.ctx.storage.sql
      .exec(
        \`SELECT COALESCE(conversation_hash, session_hash) AS conversation_hash,
                COUNT(*) AS count
         FROM chat_turns
         WHERE occurred_at >= ?
         GROUP BY COALESCE(conversation_hash, session_hash)\`,
        since,
      )
      .toArray();
    const conversations = conversationRows.length;
    const multiTurnConversations = conversationRows.filter(
      (row) => Number(row.count || 0) >= 2,
    ).length;`,
    );
  }

  const oldReturn = `      chatSessions,
      multiTurnSessions,
      secondMessageRate: rate(multiTurnSessions, chatSessions),`;
  const newReturn = `      conversations,
      multiTurnConversations,
      secondMessageRate: rate(multiTurnConversations, conversations),`;
  if (text.includes(oldReturn)) text = text.replace(oldReturn, newReturn);

  for (const expected of [
    "          conversation_hash TEXT,",
    'exec("PRAGMA table_info(chat_turns)")',
    "ALTER TABLE chat_turns ADD COLUMN conversation_hash TEXT",
    "browser_hash, conversation_hash,",
    "COALESCE(conversation_hash, session_hash)",
    "const multiTurnConversations =",
    "secondMessageRate: rate(multiTurnConversations, conversations)",
  ]) {
    requireText(text, expected, `analytics contract ${expected}`);
  }
  return text;
});

await update("public/app.js", (source) => {
  let text = source;
  const listenerPattern =
    /^[ \t]*if \(privateChatButton instanceof HTMLButtonElement\) \{\n[ \t]*privateChatButton\.addEventListener\("click", togglePrivateChat\);\n[ \t]*\}\n(?:[ \t]*\n)*/gm;
  text = text.replace(listenerPattern, "");

  const anchor = `if (newConversationButton instanceof HTMLButtonElement) {
  newConversationButton.addEventListener("click", () => {`;
  requireText(text, anchor, "the new-conversation click listener");
  const listener = `if (privateChatButton instanceof HTMLButtonElement) {
  privateChatButton.addEventListener("click", togglePrivateChat);
}

`;
  text = text.replace(anchor, listener + anchor);

  if (
    occurrences(
      text,
      'privateChatButton.addEventListener("click", togglePrivateChat)',
    ) !== 1
  ) {
    throw new Error("Private chat must register exactly one click listener");
  }
  const pendingStart = text.indexOf("function setPending(value)");
  const pendingEnd = text.indexOf("\nfunction ", pendingStart + 1);
  if (pendingStart < 0 || pendingEnd <= pendingStart) {
    throw new Error("Could not isolate the pending-state function");
  }
  if (text.slice(pendingStart, pendingEnd).includes("addEventListener")) {
    throw new Error("Pending-state updates must not register event listeners");
  }
  return text;
});

await update(
  "test/daily-usage-dashboard.test.mjs",
  (source) => {
    let text = source;
    const oldAssertions = `  assert.match(config.scripts["apply:prompt-policy"], /unify-impact-dashboard-theme\\.mjs/);
  assert.match(config.scripts["apply:prompt-policy"], /add-daily-usage-metrics\\.mjs$/);`;
    if (text.includes(oldAssertions)) {
      text = text.replace(
        oldAssertions,
        `  const pipeline = config.scripts["apply:prompt-policy"];
  const themeIndex = pipeline.indexOf("unify-impact-dashboard-theme.mjs");
  const usageIndex = pipeline.indexOf("add-daily-usage-metrics.mjs");
  assert.ok(themeIndex >= 0, "Missing dashboard theming pass");
  assert.ok(usageIndex > themeIndex, "Daily usage must run after dashboard theming");`,
      );
    }
    requireText(text, "usageIndex > themeIndex", "the daily-usage ordering check");
    return text;
  },
  { optional: true },
);

await update(
  "test/thread-history.test.mjs",
  (source) => {
    let text = source;
    text = text.replace(
      `/appendUserOutput\\(visibleUserText\\);[\\s\\S]*showOutput\\(copy\\.thinking/`,
      `/appendUserOutput\\(visibleUserText\\);[\\s\\S]*showOutput\\(pendingReplyCopy\\(\\), "thinking-output", "thinking"\\)/`,
    );
    requireText(text, "pendingReplyCopy\\(\\)", "the thread pending-copy expectation");
    return text;
  },
  { optional: true },
);

await update(
  "test/ui.test.mjs",
  (source) => {
    let text = source;
    text = text.replace(
      `  assert.match(clientScript, /showOutput\\(copy\\.thinking, "thinking-output", "thinking"\\)/);`,
      `  assert.match(
    clientScript,
    /showOutput\\(pendingReplyCopy\\(\\), "thinking-output", "thinking"\\)/,
  );
  assert.match(clientScript, /copy\\.responding \\|\\| "Responding…"/);`,
    );
    requireText(text, "pendingReplyCopy\\(\\)", "the UI fastest-status expectation");
    return text;
  },
  { optional: true },
);

await update(
  "test/private-chat.test.mjs",
  (source) => {
    let text = source;
    if (!text.includes("const privateListenerCount =")) {
      const marker = `  assert.match(clientSource, /clearPrivateChatPreference\\(\\)/);`;
      requireText(text, marker, "the private-chat client assertion ending");
      text = text.replace(
        marker,
        `${marker}
  const privateListenerCount = (
    clientSource.match(
      /privateChatButton\\.addEventListener\\("click", togglePrivateChat\\)/g,
    ) || []
  ).length;
  assert.equal(privateListenerCount, 1);
  const pendingStart = clientSource.indexOf("function setPending(value)");
  const pendingEnd = clientSource.indexOf("\\nfunction ", pendingStart + 1);
  assert.ok(pendingStart >= 0 && pendingEnd > pendingStart);
  assert.doesNotMatch(
    clientSource.slice(pendingStart, pendingEnd),
    /addEventListener/,
  );`,
      );
    }
    requireText(text, "privateListenerCount", "the single-listener regression check");
    return text;
  },
  { optional: true },
);

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    let text = source;
    if (!text.includes('"scripts/fix-fastest-response-release.mjs"')) {
      const marker = '  "scripts/finalize-instant-thinking-tests.mjs",\n';
      requireText(text, marker, "the final instant-thinking fixture");
      text = text.replace(
        marker,
        `${marker}  "scripts/fix-reasoning-refresh-freeze.mjs",\n  "scripts/fix-fastest-response-release.mjs",\n`,
      );
    }
    requireText(
      text,
      '"scripts/fix-fastest-response-release.mjs"',
      "the release-repair fixture",
    );
    return text;
  },
  { optional: true },
);

console.log(
  "Repaired fastest-response release generation, analytics migration, and regression checks.",
);

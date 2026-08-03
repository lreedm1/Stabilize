import { DurableObject } from "cloudflare:workers";

export const SESSION_RETENTION_DAYS = 30;

const SESSION_RETENTION_MS = SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
const PROVIDER_DELETE_RETRY_MS = 24 * 60 * 60 * 1_000;
const MAX_RECENT_MESSAGES = 8;
const MAX_STORED_MESSAGE_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 1_600;
const OPENAI_CONVERSATIONS_URL = "https://api.openai.com/v1/conversations";
const CONVERSATION_ID_PATTERN = /^conv_[A-Za-z0-9_-]{1,120}$/;
const ITEM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function boundedText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function cleanConversationId(value) {
  const text = String(value || "").trim();
  return CONVERSATION_ID_PATTERN.test(text) ? text : null;
}

function emptyContext() {
  return {
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
    conversationId: null,
  };
}

function providerHeaders(apiKey) {
  return {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
  };
}

async function requireProviderSuccess(response, operation) {
  if (response.ok || response.status === 404) return response;
  throw new Error(`OpenAI conversation ${operation} failed with ${response.status}`);
}

async function purgeConversationItems(apiKey, conversationId) {
  // Deleting a Conversation object does not delete its items. Remove every
  // item first, repeatedly reading the first page as the collection shrinks.
  for (let page = 0; page < 100; page += 1) {
    const listResponse = await fetch(
      `${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/items?limit=100&order=desc`,
      { headers: providerHeaders(apiKey) },
    );
    await requireProviderSuccess(listResponse, "item list");
    if (listResponse.status === 404) return;

    const body = await listResponse.json().catch(() => ({}));
    const itemIds = (Array.isArray(body?.data) ? body.data : [])
      .map((item) => String(item?.id || ""))
      .filter((itemId) => ITEM_ID_PATTERN.test(itemId));

    if (!itemIds.length) return;

    for (const itemId of itemIds) {
      const deleteResponse = await fetch(
        `${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/items/${encodeURIComponent(itemId)}`,
        {
          method: "DELETE",
          headers: providerHeaders(apiKey),
        },
      );
      await requireProviderSuccess(deleteResponse, "item deletion");
    }

    if (body?.has_more !== true && itemIds.length < 100) return;
  }

  throw new Error("OpenAI conversation item deletion exceeded the page limit");
}

async function purgeOpenAIConversation(apiKey, conversationId) {
  await purgeConversationItems(apiKey, conversationId);
  const response = await fetch(
    `${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}`,
    {
      method: "DELETE",
      headers: providerHeaders(apiKey),
    },
  );
  await requireProviderSuccess(response, "deletion");
}

export class SessionMemory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS memory_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          summary TEXT NOT NULL DEFAULT '',
          summary_version INTEGER NOT NULL DEFAULT 0,
          turn_count INTEGER NOT NULL DEFAULT 0,
          awaiting_safety_answer INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recent_messages (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS provider_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          openai_conversation_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    });
  }

  async readContext() {
    const state = this.ctx.storage.sql
      .exec(
        `SELECT summary, turn_count, awaiting_safety_answer, updated_at
         FROM memory_state WHERE id = 1`,
      )
      .toArray()[0];
    const provider = this.ctx.storage.sql
      .exec(
        `SELECT openai_conversation_id
         FROM provider_state WHERE id = 1`,
      )
      .toArray()[0];

    if (!state && !provider) return emptyContext();

    const recent = state
      ? this.ctx.storage.sql
          .exec(
            `SELECT role, content
             FROM recent_messages
             ORDER BY sequence ASC`,
          )
          .toArray()
          .map((message) => ({
            role: message.role,
            content: boundedText(message.content, MAX_STORED_MESSAGE_CHARS),
          }))
      : [];

    return {
      summary: boundedText(state?.summary, MAX_SUMMARY_CHARS),
      recent,
      awaitingSafetyAnswer: state?.awaiting_safety_answer === 1,
      turnCount: Number(state?.turn_count) || 0,
      updatedAt: Number(state?.updated_at) || null,
      conversationId: cleanConversationId(provider?.openai_conversation_id),
    };
  }

  async adoptOpenAIConversation(candidateId) {
    const conversationId = cleanConversationId(candidateId);
    if (!conversationId) throw new Error("Invalid OpenAI conversation ID");

    const now = Date.now();
    await this.ctx.storage.setAlarm(now + SESSION_RETENTION_MS);

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO provider_state (
           id, openai_conversation_id, created_at, updated_at
         ) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           openai_conversation_id = provider_state.openai_conversation_id,
           updated_at = excluded.updated_at`,
        conversationId,
        now,
        now,
      );
    });

    const current = this.ctx.storage.sql
      .exec(
        `SELECT openai_conversation_id
         FROM provider_state WHERE id = 1`,
      )
      .one();

    return {
      conversationId: cleanConversationId(current.openai_conversation_id),
      adopted: current.openai_conversation_id === conversationId,
    };
  }

  async replaceOpenAIConversation(expectedId, replacementId) {
    const expected = cleanConversationId(expectedId);
    const replacement = cleanConversationId(replacementId);
    if (!expected || !replacement) {
      throw new Error("Invalid OpenAI conversation replacement");
    }

    const now = Date.now();
    await this.ctx.storage.setAlarm(now + SESSION_RETENTION_MS);

    this.ctx.storage.sql.exec(
      `UPDATE provider_state
       SET openai_conversation_id = ?, updated_at = ?
       WHERE id = 1 AND openai_conversation_id = ?`,
      replacement,
      now,
      expected,
    );

    const current = this.ctx.storage.sql
      .exec(
        `SELECT openai_conversation_id
         FROM provider_state WHERE id = 1`,
      )
      .toArray()[0];

    if (!current) return this.adoptOpenAIConversation(replacement);

    return {
      conversationId: cleanConversationId(current.openai_conversation_id),
      adopted: current.openai_conversation_id === replacement,
    };
  }

  async forgetOpenAIConversation(expectedId) {
    const expected = cleanConversationId(expectedId);
    if (!expected) return false;

    this.ctx.storage.sql.exec(
      `DELETE FROM provider_state
       WHERE id = 1 AND openai_conversation_id = ?`,
      expected,
    );
    return true;
  }

  async purgeUnusedOpenAIConversation(conversationId) {
    const cleanId = cleanConversationId(conversationId);
    const apiKey = String(this.env.OPENAI_API_KEY || "");
    if (!cleanId || !apiKey) return false;

    try {
      await purgeOpenAIConversation(apiKey, cleanId);
      return true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "openai_conversation_cleanup_failed",
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return false;
    }
  }

  async recordExchange(exchange) {
    const user = boundedText(exchange?.user, MAX_STORED_MESSAGE_CHARS);
    const assistant = boundedText(exchange?.assistant, MAX_STORED_MESSAGE_CHARS);
    if (!user || !assistant) throw new Error("Invalid memory exchange");

    const awaitingSafetyAnswer = exchange?.awaitingSafetyAnswer === true ? 1 : 0;
    const now = Date.now();

    // Schedule expiry before writing so a transient alarm failure cannot leave
    // newly written sensitive context without a retention deadline.
    await this.ctx.storage.setAlarm(now + SESSION_RETENTION_MS);

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO memory_state (
           id, summary, summary_version, turn_count,
           awaiting_safety_answer, created_at, updated_at
         ) VALUES (1, '', 0, 1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           turn_count = memory_state.turn_count + 1,
           awaiting_safety_answer = excluded.awaiting_safety_answer,
           updated_at = excluded.updated_at`,
        awaitingSafetyAnswer,
        now,
        now,
      );

      this.ctx.storage.sql.exec(
        "INSERT INTO recent_messages (role, content, created_at) VALUES ('user', ?, ?)",
        user,
        now,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO recent_messages (role, content, created_at) VALUES ('assistant', ?, ?)",
        assistant,
        now,
      );

      this.ctx.storage.sql.exec(
        `DELETE FROM recent_messages
         WHERE sequence NOT IN (
           SELECT sequence FROM recent_messages
           ORDER BY sequence DESC
           LIMIT ?
         )`,
        MAX_RECENT_MESSAGES,
      );
    });

    const state = this.ctx.storage.sql
      .exec("SELECT turn_count FROM memory_state WHERE id = 1")
      .one();
    const recentCount = this.ctx.storage.sql
      .exec("SELECT COUNT(*) AS count FROM recent_messages")
      .one().count;

    return {
      shouldCompact: Number(recentCount) >= 2,
      turnCount: Number(state.turn_count) || 0,
    };
  }

  async getCompactionSnapshot() {
    const state = this.ctx.storage.sql
      .exec(
        `SELECT summary, summary_version
         FROM memory_state WHERE id = 1`,
      )
      .toArray()[0];
    if (!state) return null;

    const messages = this.ctx.storage.sql
      .exec(
        `SELECT sequence, role, content
         FROM recent_messages
         ORDER BY sequence ASC`,
      )
      .toArray()
      .map((message) => ({
        sequence: Number(message.sequence),
        role: message.role,
        content: boundedText(message.content, MAX_STORED_MESSAGE_CHARS),
      }));

    if (messages.length < 2) return null;

    return {
      summary: boundedText(state.summary, MAX_SUMMARY_CHARS),
      summaryVersion: Number(state.summary_version) || 0,
      throughSequence: messages.at(-1).sequence,
      messages: messages.map(({ role, content }) => ({ role, content })),
    };
  }

  async applySummary(summary, expectedVersion, throughSequence) {
    const cleanSummary = boundedText(summary, MAX_SUMMARY_CHARS);
    const version = Number(expectedVersion);
    const sequence = Number(throughSequence);
    if (
      !cleanSummary ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1
    ) {
      return false;
    }

    return this.ctx.storage.transactionSync(() => {
      const state = this.ctx.storage.sql
        .exec("SELECT summary_version FROM memory_state WHERE id = 1")
        .toArray()[0];
      if (!state || Number(state.summary_version) !== version) return false;

      this.ctx.storage.sql.exec(
        `UPDATE memory_state
         SET summary = ?, summary_version = summary_version + 1, updated_at = ?
         WHERE id = 1`,
        cleanSummary,
        Date.now(),
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM recent_messages WHERE sequence <= ?",
        sequence,
      );
      return true;
    });
  }

  async alarm() {
    const provider = this.ctx.storage.sql
      .exec(
        `SELECT openai_conversation_id
         FROM provider_state WHERE id = 1`,
      )
      .toArray()[0];
    const conversationId = cleanConversationId(provider?.openai_conversation_id);

    if (conversationId) {
      const apiKey = String(this.env.OPENAI_API_KEY || "");
      if (!apiKey) {
        console.error(
          JSON.stringify({
            event: "openai_conversation_cleanup_deferred",
            error: "MissingOpenAIKey",
          }),
        );
        await this.ctx.storage.setAlarm(Date.now() + PROVIDER_DELETE_RETRY_MS);
        return;
      }

      try {
        await purgeOpenAIConversation(apiKey, conversationId);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "openai_conversation_cleanup_deferred",
            error: error instanceof Error ? error.name : "UnknownError",
          }),
        );
        await this.ctx.storage.setAlarm(Date.now() + PROVIDER_DELETE_RETRY_MS);
        return;
      }
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM recent_messages");
      this.ctx.storage.sql.exec("DELETE FROM memory_state");
      this.ctx.storage.sql.exec("DELETE FROM provider_state");
    });
  }
}

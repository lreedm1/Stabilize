import { DurableObject } from "cloudflare:workers";

export const SESSION_RETENTION_DAYS = 30;

const SESSION_RETENTION_MS = SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
const MAX_RECENT_MESSAGES = 8;
const MAX_STORED_MESSAGE_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 1_600;

function boundedText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function emptyContext() {
  return {
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
  };
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

    if (!state) return emptyContext();

    const recent = this.ctx.storage.sql
      .exec(
        `SELECT role, content
         FROM recent_messages
         ORDER BY sequence ASC`,
      )
      .toArray()
      .map((message) => ({
        role: message.role,
        content: boundedText(message.content, MAX_STORED_MESSAGE_CHARS),
      }));

    return {
      summary: boundedText(state.summary, MAX_SUMMARY_CHARS),
      recent,
      awaitingSafetyAnswer: state.awaiting_safety_answer === 1,
      turnCount: Number(state.turn_count) || 0,
      updatedAt: Number(state.updated_at) || null,
    };
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
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM recent_messages");
      this.ctx.storage.sql.exec("DELETE FROM memory_state");
    });
  }
}

import { DurableObject } from "cloudflare:workers";

export const SESSION_RETENTION_DAYS = 30;

const SESSION_RETENTION_MS = SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
const MODEL_TURN_LEASE_MS = 90 * 1_000;
const SAFETY_ANSWER_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
const MAX_RECENT_MESSAGES = 8;
const MAX_STORED_MESSAGE_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 1_000;
const LEASE_TOKEN_PATTERN = /^lease_[A-Za-z0-9_-]{20,128}$/;

class HardDeleteDeadlineExpired extends Error {
  constructor() {
    super("Guest session storage deadline expired");
    this.name = "HardDeleteDeadlineExpired";
  }
}

function boundedText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function cleanLeaseToken(value) {
  const text = String(value || "").trim();
  return LEASE_TOKEN_PATTERN.test(text) ? text : null;
}

function cleanEpoch(value) {
  const epoch = Number(value);
  return Number.isSafeInteger(epoch) && epoch > 0 ? epoch : null;
}

function cleanSessionIssuedAtMs(value) {
  const issuedAtMs = Number(value);
  return Number.isSafeInteger(issuedAtMs) && issuedAtMs > 0
    ? issuedAtMs
    : null;
}

function cleanExchange(exchange) {
  const user = boundedText(exchange?.user, MAX_STORED_MESSAGE_CHARS);
  const assistant = boundedText(
    exchange?.assistant,
    MAX_STORED_MESSAGE_CHARS,
  );
  if (!user || !assistant) throw new Error("Invalid memory exchange");

  return {
    user,
    assistant,
    awaitingSafetyAnswer: exchange?.awaitingSafetyAnswer === true ? 1 : 0,
  };
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

function validTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function ageDescription(timestamp, now = Date.now()) {
  const ageMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "less than a minute old";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} old`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} old`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} old`;
}

function relevanceDescription(timestamp, now = Date.now()) {
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs <= 6 * 60 * 60 * 1_000) {
    return "recent context; consider it, but current-turn evidence still wins";
  }
  if (ageMs <= 24 * 60 * 60 * 1_000) {
    return "same-day background; use only when it helps answer the current message";
  }
  if (ageMs <= 3 * 24 * 60 * 60 * 1_000) {
    return "older context with reduced relevance; do not infer the user's present state from it";
  }
  return "historical context only; it is not evidence of present danger or current intent";
}

function timestampedMemory(content, createdAt, now = Date.now()) {
  const timestamp = validTimestamp(createdAt);
  const clean = boundedText(content, MAX_STORED_MESSAGE_CHARS);
  if (!timestamp) return clean;

  return `[Recorded ${new Date(timestamp).toISOString()}; ${ageDescription(
    timestamp,
    now,
  )}; ${relevanceDescription(timestamp, now)}]\n${clean}`;
}

function timestampedSummary(summary, updatedAt, now = Date.now()) {
  const clean = boundedText(summary, MAX_SUMMARY_CHARS);
  const timestamp = validTimestamp(updatedAt);
  if (!clean || !timestamp) return clean;

  return `[Historical summary last updated ${new Date(
    timestamp,
  ).toISOString()}; ${ageDescription(
    timestamp,
    now,
  )}. Background only: never treat past risk as proof of present risk.]\n${clean}`;
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

        CREATE TABLE IF NOT EXISTS session_control (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          state_epoch INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER,
          lease_token TEXT,
          lease_epoch INTEGER,
          lease_expires_at INTEGER,
          last_erased_at INTEGER,
          revoked_through_issued_at_ms INTEGER,
          hard_delete_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

      `);

      const controlColumns = this.ctx.storage.sql
        .exec("PRAGMA table_info(session_control)")
        .toArray();
      if (!controlColumns.some((column) => column.name === "last_erased_at")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE session_control ADD COLUMN last_erased_at INTEGER",
        );
      }
      if (
        !controlColumns.some(
          (column) => column.name === "revoked_through_issued_at_ms",
        )
      ) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE session_control ADD COLUMN revoked_through_issued_at_ms INTEGER",
        );
      }
      if (!controlColumns.some((column) => column.name === "hard_delete_at")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE session_control ADD COLUMN hard_delete_at INTEGER",
        );
      }
      this.ctx.storage.sql.exec(
        `UPDATE session_control
         SET revoked_through_issued_at_ms = last_erased_at
         WHERE revoked_through_issued_at_ms IS NULL
           AND last_erased_at IS NOT NULL`,
      );

      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO session_control (
           id, state_epoch, created_at, updated_at
         ) VALUES (1, 0, ?, ?)`,
        now,
        now,
      );

      // Existing rolling-memory objects keep their original deadline. Startup
      // never turns old activity into a fresh 30-day retention period.
      const control = this._controlRow();
      if (!Number(control.expires_at)) {
        const memory = this.ctx.storage.sql
          .exec("SELECT updated_at FROM memory_state WHERE id = 1")
          .toArray()[0];
        const lastActivity = Number(memory?.updated_at) || 0;
        if (lastActivity) {
          this.ctx.storage.sql.exec(
            `UPDATE session_control
             SET expires_at = ?, updated_at = ?
             WHERE id = 1`,
            lastActivity + SESSION_RETENTION_MS,
            now,
          );
        }
      }

      this.ctx.storage.transactionSync(() => {
        this._enforceDeadlinesInTransaction(now, {
          enforceHardDelete: false,
        });
      });
      await this._syncAlarm();
    });
  }

  _controlRow() {
    return this.ctx.storage.sql
      .exec(
      `SELECT state_epoch, expires_at, lease_token, lease_epoch,
                lease_expires_at, last_erased_at,
                revoked_through_issued_at_ms, hard_delete_at
         FROM session_control WHERE id = 1`,
      )
      .one();
  }

  _eraseLocalTextInTransaction() {
    this.ctx.storage.sql.exec("DELETE FROM recent_messages");
    this.ctx.storage.sql.exec("DELETE FROM memory_state");
  }

  _clearLeaseAndBumpEpochInTransaction(now) {
    this.ctx.storage.sql.exec(
      `UPDATE session_control
       SET state_epoch = state_epoch + 1,
           lease_token = NULL,
           lease_epoch = NULL,
           lease_expires_at = NULL,
           updated_at = ?
       WHERE id = 1`,
      now,
    );
  }

  _hardDeleteAtForInput(_value) {
    return null;
  }

  _setHardDeleteAtInTransaction(value, now) {
    const hardDeleteAt = this._hardDeleteAtForInput(value);
    if (hardDeleteAt === null) return;
    this.ctx.storage.sql.exec(
      `UPDATE session_control
       SET hard_delete_at = CASE
             WHEN hard_delete_at IS NULL OR hard_delete_at > ? THEN ?
             ELSE hard_delete_at
           END,
           updated_at = ?
       WHERE id = 1`,
      hardDeleteAt,
      hardDeleteAt,
      now,
    );
  }

  _hasExactLiveLease(control, leaseToken, epoch, now) {
    return (
      cleanLeaseToken(control.lease_token) === leaseToken &&
      Number(control.lease_epoch) === epoch &&
      Number(control.state_epoch) === epoch &&
      Number(control.lease_expires_at) > now
    );
  }

  _enforceDeadlinesInTransaction(
    now,
    { enforceHardDelete = true } = {},
  ) {
    const control = this._controlRow();
    if (
      enforceHardDelete &&
      Number(control.hard_delete_at) > 0 &&
      Number(control.hard_delete_at) <= now
    ) {
      throw new HardDeleteDeadlineExpired();
    }
    const retentionExpired =
      Number(control.expires_at) > 0 && Number(control.expires_at) <= now;

    if (retentionExpired) {
      this._eraseLocalTextInTransaction();
      this._clearLeaseAndBumpEpochInTransaction(now);
      this.ctx.storage.sql.exec(
        "UPDATE session_control SET expires_at = NULL WHERE id = 1",
      );
      return { retentionExpired: true, leaseExpired: false };
    }

    const leaseMetadataPresent =
      control.lease_token !== null ||
      control.lease_epoch !== null ||
      control.lease_expires_at !== null;
    const validLeaseShape =
      Boolean(cleanLeaseToken(control.lease_token)) &&
      cleanEpoch(control.lease_epoch) !== null &&
      Number(control.lease_epoch) === Number(control.state_epoch) &&
      Number(control.lease_expires_at) > now;

    if (leaseMetadataPresent && !validLeaseShape) {
      this._clearLeaseAndBumpEpochInTransaction(now);
      return { retentionExpired: false, leaseExpired: true };
    }

    return { retentionExpired: false, leaseExpired: false };
  }

  _readContextFromStorage(now = Date.now()) {
    const state = this.ctx.storage.sql
      .exec(
        `SELECT summary, turn_count, awaiting_safety_answer, updated_at
         FROM memory_state WHERE id = 1`,
      )
      .toArray()[0];

    if (!state) return emptyContext();

    const updatedAt = validTimestamp(state.updated_at);
    const recent = this.ctx.storage.sql
      .exec(
        `SELECT role, content, created_at
         FROM recent_messages
         ORDER BY sequence ASC`,
      )
      .toArray()
      .map((message) => ({
        role: message.role,
        content: timestampedMemory(message.content, message.created_at, now),
        createdAt: validTimestamp(message.created_at),
      }));

    const pendingSafetyQuestionIsCurrent =
      state.awaiting_safety_answer === 1 &&
      updatedAt !== null &&
      now - updatedAt <= SAFETY_ANSWER_MAX_AGE_MS;

    return {
      summary: timestampedSummary(state.summary, updatedAt, now),
      recent,
      awaitingSafetyAnswer: pendingSafetyQuestionIsCurrent,
      turnCount: Number(state.turn_count) || 0,
      updatedAt,
    };
  }

  _writeExchangeInTransaction(exchange, now) {
    this.ctx.storage.sql.exec(
      `INSERT INTO memory_state (
         id, summary, summary_version, turn_count,
         awaiting_safety_answer, created_at, updated_at
       ) VALUES (1, '', 0, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         turn_count = memory_state.turn_count + 1,
         awaiting_safety_answer = excluded.awaiting_safety_answer,
         updated_at = excluded.updated_at`,
      exchange.awaitingSafetyAnswer,
      now,
      now,
    );

    this.ctx.storage.sql.exec(
      "INSERT INTO recent_messages (role, content, created_at) VALUES ('user', ?, ?)",
      exchange.user,
      now,
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO recent_messages (role, content, created_at) VALUES ('assistant', ?, ?)",
      exchange.assistant,
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

    const turnCount = Number(
      this.ctx.storage.sql
        .exec("SELECT turn_count FROM memory_state WHERE id = 1")
        .one().turn_count,
    );
    const recentCount = Number(
      this.ctx.storage.sql
        .exec("SELECT COUNT(*) AS count FROM recent_messages")
        .one().count,
    );

    return {
      shouldCompact: recentCount >= MAX_RECENT_MESSAGES - 2,
      turnCount: Number.isFinite(turnCount) ? turnCount : 0,
    };
  }

  async _armAtOrBefore(timestamp) {
    const deadline = Number(timestamp);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || deadline < current) {
      await this.ctx.storage.setAlarm(deadline);
    }
  }

  _nextDeadline() {
    const control = this._controlRow();
    const deadlines = [
      Number(control.expires_at) || 0,
      Number(control.lease_expires_at) || 0,
      Number(control.hard_delete_at) || 0,
    ].filter((value) => value > 0);
    return deadlines.length ? Math.min(...deadlines) : null;
  }

  async _syncAlarm() {
    const deadline = this._nextDeadline();
    if (deadline === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    await this.ctx.storage.setAlarm(deadline > now ? deadline : now);
  }

  async readContext() {
    const now = Date.now();
    const context = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      return this._readContextFromStorage(now);
    });
    await this._syncAlarm();
    return context;
  }

  async beginModelTurn(request = {}) {
    const requestStartedAt = Number.isFinite(Number(request?.requestStartedAt))
      ? Math.floor(Number(request.requestStartedAt))
      : Date.now();
    const sessionIssuedAtMs = cleanSessionIssuedAtMs(
      request?.sessionIssuedAtMs,
    );
    const hardDeleteAt = this._hardDeleteAtForInput(
      request?.hardDeleteAtMs,
    );
    if (hardDeleteAt !== null) {
      await this._armAtOrBefore(hardDeleteAt);
    }
    await this._armAtOrBefore(Date.now() + MODEL_TURN_LEASE_MS);
    const now = Date.now();
    const leaseExpiresAt = now + MODEL_TURN_LEASE_MS;

    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      this._setHardDeleteAtInTransaction(request?.hardDeleteAtMs, now);
      const current = this._controlRow();
      if (
        Number(current.revoked_through_issued_at_ms) > 0 &&
        (sessionIssuedAtMs === null ||
          sessionIssuedAtMs <=
            Number(current.revoked_through_issued_at_ms))
      ) {
        return {
          acquired: false,
          leaseToken: null,
          epoch: Number(current.state_epoch) || 0,
          leaseExpiresAt: null,
          context: null,
          retryAfterSeconds: 0,
          reason: "session_revoked",
        };
      }
      if (
        Number(current.last_erased_at) > 0 &&
        requestStartedAt <= Number(current.last_erased_at)
      ) {
        return {
          acquired: false,
          leaseToken: null,
          epoch: Number(current.state_epoch) || 0,
          leaseExpiresAt: null,
          context: null,
          retryAfterSeconds: 0,
          reason: "memory_deleted",
        };
      }
      const activeLease = cleanLeaseToken(current.lease_token);
      if (activeLease && Number(current.lease_expires_at) > now) {
        return {
          acquired: false,
          leaseToken: null,
          epoch: Number(current.state_epoch) || 0,
          leaseExpiresAt: Number(current.lease_expires_at),
          context: null,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((Number(current.lease_expires_at) - now) / 1_000),
          ),
          reason: "turn_in_progress",
        };
      }

      const leaseToken = "lease_" + crypto.randomUUID().replaceAll("-", "");
      const epoch = (Number(current.state_epoch) || 0) + 1;
      this.ctx.storage.sql.exec(
        `UPDATE session_control
         SET state_epoch = ?,
             lease_token = ?,
             lease_epoch = ?,
             lease_expires_at = ?,
             updated_at = ?
         WHERE id = 1`,
        epoch,
        leaseToken,
        epoch,
        leaseExpiresAt,
        now,
      );

      return {
        acquired: true,
        leaseToken,
        epoch,
        leaseExpiresAt,
        context: this._readContextFromStorage(now),
      };
    });

    await this._syncAlarm();
    return result;
  }

  async commitModelTurn({
    leaseToken,
    epoch,
    exchange: exchangeInput,
    sessionIssuedAtMs: sessionIssuedAtMsInput,
    hardDeleteAtMs,
  } = {}) {
    const cleanToken = cleanLeaseToken(leaseToken);
    const cleanTurnEpoch = cleanEpoch(epoch);
    if (!cleanToken || cleanTurnEpoch === null) {
      return { committed: false, reason: "stale_turn" };
    }
    const exchange = cleanExchange(exchangeInput);
    const sessionIssuedAtMs = cleanSessionIssuedAtMs(sessionIssuedAtMsInput);
    const hardDeleteAt = this._hardDeleteAtForInput(hardDeleteAtMs);
    if (hardDeleteAt !== null) {
      await this._armAtOrBefore(hardDeleteAt);
    }
    await this._armAtOrBefore(Date.now() + SESSION_RETENTION_MS);
    const now = Date.now();

    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      this._setHardDeleteAtInTransaction(hardDeleteAtMs, now);
      const control = this._controlRow();
      if (
        Number(control.revoked_through_issued_at_ms) > 0 &&
        (sessionIssuedAtMs === null ||
          sessionIssuedAtMs <=
            Number(control.revoked_through_issued_at_ms))
      ) {
        return { committed: false, reason: "session_revoked" };
      }
      if (
        !this._hasExactLiveLease(
          control,
          cleanToken,
          cleanTurnEpoch,
          now,
        )
      ) {
        return { committed: false, reason: "stale_turn" };
      }

      const memory = this._writeExchangeInTransaction(exchange, now);
      this.ctx.storage.sql.exec(
        `UPDATE session_control
         SET expires_at = ?,
             lease_token = NULL,
             lease_epoch = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE id = 1`,
        now + SESSION_RETENTION_MS,
        now,
      );
      return {
        committed: true,
        stateEpoch: cleanTurnEpoch,
        ...memory,
      };
    });

    await this._syncAlarm();
    return result;
  }

  async releaseModelTurn({ leaseToken, epoch } = {}) {
    const cleanToken = cleanLeaseToken(leaseToken);
    const cleanTurnEpoch = cleanEpoch(epoch);
    if (!cleanToken || cleanTurnEpoch === null) return false;

    const now = Date.now();
    const released = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      if (
        !this._hasExactLiveLease(
          control,
          cleanToken,
          cleanTurnEpoch,
          now,
        )
      ) {
        return false;
      }

      this.ctx.storage.sql.exec(
        `UPDATE session_control
         SET lease_token = NULL,
             lease_epoch = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE id = 1`,
        now,
      );
      return true;
    });

    await this._syncAlarm();
    return released;
  }

  async _recordEpochInvalidatingExchange(
    exchangeInput,
    requestStartedAt,
    sessionIssuedAtMs,
    hardDeleteAtMs,
  ) {
    const exchange = cleanExchange(exchangeInput);
    const hardDeleteAt = this._hardDeleteAtForInput(hardDeleteAtMs);
    if (hardDeleteAt !== null) {
      await this._armAtOrBefore(hardDeleteAt);
    }
    await this._armAtOrBefore(Date.now() + SESSION_RETENTION_MS);
    const now = Date.now();

    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      this._setHardDeleteAtInTransaction(hardDeleteAtMs, now);
      const control = this._controlRow();
      if (
        Number(control.revoked_through_issued_at_ms) > 0 &&
        (sessionIssuedAtMs === null ||
          sessionIssuedAtMs <=
            Number(control.revoked_through_issued_at_ms))
      ) {
        return { recorded: false, reason: "session_revoked" };
      }
      if (
        Number(control.last_erased_at) > 0 &&
        requestStartedAt <= Number(control.last_erased_at)
      ) {
        return { recorded: false, reason: "memory_deleted" };
      }
      this._clearLeaseAndBumpEpochInTransaction(now);
      const memory = this._writeExchangeInTransaction(exchange, now);
      this.ctx.storage.sql.exec(
        `UPDATE session_control
         SET expires_at = ?, updated_at = ?
         WHERE id = 1`,
        now + SESSION_RETENTION_MS,
        now,
      );
      return {
        recorded: true,
        stateEpoch: Number(this._controlRow().state_epoch) || 0,
        ...memory,
      };
    });

    await this._syncAlarm();
    return result;
  }

  async recordFixedExchange(
    exchangeInput,
    requestStartedAt = Date.now(),
    sessionIssuedAtMsInput,
    hardDeleteAtMs,
  ) {
    const startedAt = Number(requestStartedAt);
    if (!Number.isFinite(startedAt)) {
      return { recorded: false, reason: "invalid_request_time" };
    }
    return this._recordEpochInvalidatingExchange(
      exchangeInput,
      Math.floor(startedAt),
      cleanSessionIssuedAtMs(sessionIssuedAtMsInput),
      hardDeleteAtMs,
    );
  }

  async recordLocalExchange(exchangeInput, sessionIssuedAtMsInput) {
    return this._recordEpochInvalidatingExchange(
      exchangeInput,
      Date.now(),
      cleanSessionIssuedAtMs(sessionIssuedAtMsInput),
    );
  }

  async recordExchange(exchangeInput) {
    const exchange = cleanExchange(exchangeInput);
    await this._armAtOrBefore(Date.now() + SESSION_RETENTION_MS);
    const now = Date.now();

    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      if (
        cleanLeaseToken(control.lease_token) ||
        Number(control.state_epoch) > 0
      ) {
        return { recorded: false, reason: "legacy_write_blocked" };
      }

      const memory = this._writeExchangeInTransaction(exchange, now);
      this.ctx.storage.sql.exec(
        `UPDATE session_control
         SET expires_at = ?, updated_at = ?
         WHERE id = 1`,
        now + SESSION_RETENTION_MS,
        now,
      );
      return { recorded: true, ...memory };
    });

    await this._syncAlarm();
    return result;
  }

  async getCompactionSnapshot() {
    const now = Date.now();
    const snapshot = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      if (cleanLeaseToken(control.lease_token)) return null;

      const state = this.ctx.storage.sql
        .exec(
          `SELECT summary, summary_version, updated_at
           FROM memory_state WHERE id = 1`,
        )
        .toArray()[0];
      if (!state) return null;

      const messages = this.ctx.storage.sql
        .exec(
          `SELECT sequence, role, content, created_at
           FROM recent_messages
           ORDER BY sequence ASC`,
        )
        .toArray()
        .map((message) => ({
          sequence: Number(message.sequence),
          role: message.role,
          content: boundedText(message.content, MAX_STORED_MESSAGE_CHARS),
          createdAt: validTimestamp(message.created_at),
        }));

      if (messages.length < 2) return null;

      return {
        summary: boundedText(state.summary, MAX_SUMMARY_CHARS),
        summaryUpdatedAt: validTimestamp(state.updated_at),
        summaryVersion: Number(state.summary_version) || 0,
        stateEpoch: Number(control.state_epoch) || 0,
        throughSequence: messages.at(-1).sequence,
        messages: messages.map(({ role, content, createdAt }) => ({
          role,
          content,
          createdAt,
        })),
      };
    });
    await this._syncAlarm();
    return snapshot;
  }

  async applySummary(summary, expectedVersion, throughSequence, expectedEpoch) {
    const cleanSummary = boundedText(summary, MAX_SUMMARY_CHARS);
    const version = Number(expectedVersion);
    const sequence = Number(throughSequence);
    const epoch = Number(expectedEpoch);
    if (
      !cleanSummary ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      !Number.isSafeInteger(epoch) ||
      epoch < 0
    ) {
      return false;
    }

    const now = Date.now();
    const applied = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      if (
        cleanLeaseToken(control.lease_token) ||
        Number(control.state_epoch) !== epoch
      ) {
        return false;
      }

      const state = this.ctx.storage.sql
        .exec("SELECT summary_version FROM memory_state WHERE id = 1")
        .toArray()[0];
      if (!state || Number(state.summary_version) !== version) return false;

      const boundary = this.ctx.storage.sql
        .exec(
          "SELECT 1 AS present FROM recent_messages WHERE sequence = ?",
          sequence,
        )
        .toArray()[0];
      if (!boundary) return false;

      this.ctx.storage.sql.exec(
        `UPDATE memory_state
         SET summary = ?, summary_version = summary_version + 1, updated_at = ?
         WHERE id = 1`,
        cleanSummary,
        now,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM recent_messages WHERE sequence <= ?",
        sequence,
      );
      return true;
    });

    await this._syncAlarm();
    return applied;
  }

  async eraseMemory(sessionIssuedAtMsInput, hardDeleteAtMs) {
    const sessionIssuedAtMs = cleanSessionIssuedAtMs(
      sessionIssuedAtMsInput,
    );
    const prearmedHardDeleteAt = this._hardDeleteAtForInput(hardDeleteAtMs);
    if (prearmedHardDeleteAt !== null) {
      await this._armAtOrBefore(prearmedHardDeleteAt);
    }
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      this._setHardDeleteAtInTransaction(hardDeleteAtMs, now);
      const control = this._controlRow();
      const revokedThrough =
        Number(control.revoked_through_issued_at_ms) || 0;
      if (
        sessionIssuedAtMs === null ||
        sessionIssuedAtMs <= revokedThrough
      ) {
        return { erased: false, reason: "session_revoked" };
      }
      const nextBoundary = Math.max(
        revokedThrough,
        now,
        sessionIssuedAtMs,
      );
      this._eraseLocalTextInTransaction();
      this._clearLeaseAndBumpEpochInTransaction(now);
      this.ctx.storage.sql.exec(
        `UPDATE session_control
         SET expires_at = NULL,
             last_erased_at = ?,
             revoked_through_issued_at_ms = ?,
             updated_at = ?
         WHERE id = 1`,
        now,
        nextBoundary,
        now,
      );
      return {
        erased: true,
        erasedAt: now,
        nextSessionIssuedAtMs: nextBoundary + 1,
      };
    });

    await this._syncAlarm();
    return result;
  }

  async validateSession(sessionIssuedAtMsInput) {
    const sessionIssuedAtMs = cleanSessionIssuedAtMs(
      sessionIssuedAtMsInput,
    );
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const revokedThrough =
        Number(this._controlRow().revoked_through_issued_at_ms) || null;
      return {
        allowed:
          revokedThrough === null ||
          (sessionIssuedAtMs !== null &&
            sessionIssuedAtMs > revokedThrough),
      };
    });
    await this._syncAlarm();
    return result;
  }

  async getLifecycleStatus() {
    const now = Date.now();
    const status = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      return {
        epoch: Number(control.state_epoch) || 0,
        hasLease: Boolean(cleanLeaseToken(control.lease_token)),
        expiresAt: Number(control.expires_at) || null,
        leaseExpiresAt: Number(control.lease_expires_at) || null,
      };
    });
    await this._syncAlarm();
    return status;
  }

  async alarm() {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
    });
    await this._syncAlarm();
  }
}

export class GuestSessionMemory extends SessionMemory {
  constructor(ctx, env) {
    super(ctx, env);
    this.hardDeleted = false;
  }

  _hardDeleteAtForInput(value) {
    const timestamp = Number(value);
    const now = Date.now();
    return (
      Number.isSafeInteger(timestamp) &&
      timestamp > now &&
      timestamp <= now + 366 * 24 * 60 * 60 * 1_000
    )
      ? timestamp
      : null;
  }

  _setHardDeleteAtInTransaction(value, now) {
    const control = this._controlRow();
    const existing = Number(control.hard_delete_at) || 0;
    const timestamp = Number(value);
    if (existing > now && (value === undefined || value === null)) return;
    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp <= now ||
      timestamp > now + 366 * 24 * 60 * 60 * 1_000
    ) {
      throw new HardDeleteDeadlineExpired();
    }
    const hardDeleteAt = existing > now
      ? Math.min(existing, timestamp)
      : timestamp;
    this.ctx.storage.sql.exec(
      `UPDATE session_control
       SET hard_delete_at = ?, updated_at = ?
       WHERE id = 1`,
      hardDeleteAt,
      now,
    );
  }

  async _deleteAllAndMark() {
    await this.ctx.storage.deleteAll();
    this.hardDeleted = true;
  }

  async _deleteIfHardExpired({ requireStoredDeadline = false } = {}) {
    if (this.hardDeleted) return true;
    let hardDeleteAt;
    try {
      hardDeleteAt = Number(this._controlRow().hard_delete_at) || 0;
    } catch (error) {
      if (!/no such table: session_control/i.test(String(error?.message || ""))) {
        throw error;
      }
      await this._deleteAllAndMark();
      return true;
    }
    if (!hardDeleteAt) {
      if (!requireStoredDeadline) return false;
      await this._deleteAllAndMark();
      return true;
    }
    if (hardDeleteAt > Date.now()) return false;
    await this._deleteAllAndMark();
    return true;
  }

  _requiredHardDeadlineStatus(value) {
    const timestamp = Number(value);
    const now = Date.now();
    if (Number.isSafeInteger(timestamp) && timestamp <= now) return "expired";
    if (this._hardDeleteAtForInput(value) !== null) return "valid";
    return Number(this._controlRow().hard_delete_at) > now
      ? "valid"
      : "missing";
  }

  async _expireNow(fallback) {
    await this._deleteAllAndMark();
    return fallback;
  }

  async _beforeHardExpiry(
    fallback,
    operation,
    { requireStoredDeadline = false } = {},
  ) {
    if (await this._deleteIfHardExpired({ requireStoredDeadline })) {
      return fallback;
    }
    try {
      return await operation();
    } catch (error) {
      const storageWasDeleted = /no such table: (?:session_control|memory_state|recent_messages)/i
        .test(String(error?.message || ""));
      if (!(error instanceof HardDeleteDeadlineExpired) && !storageWasDeleted) {
        throw error;
      }
      await this._deleteAllAndMark();
      return fallback;
    }
  }

  async _beforeEstablishedGuestState(fallback, operation) {
    return this._beforeHardExpiry(fallback, operation, {
      requireStoredDeadline: true,
    });
  }

  async readContext() {
    return this._beforeEstablishedGuestState(emptyContext(), () =>
      super.readContext(),
    );
  }

  async beginModelTurn(request = {}) {
    const fallback = { acquired: false, reason: "session_expired" };
    return this._beforeHardExpiry(fallback, async () => {
      const deadline = this._requiredHardDeadlineStatus(
        request?.hardDeleteAtMs,
      );
      if (deadline === "expired") return this._expireNow(fallback);
      if (deadline !== "valid") {
        return this._expireNow({
          acquired: false,
          reason: "invalid_storage_deadline",
        });
      }
      return super.beginModelTurn(request);
    });
  }

  async commitModelTurn(request = {}) {
    const fallback = { committed: false, reason: "session_expired" };
    return this._beforeHardExpiry(fallback, async () => {
      const deadline = this._requiredHardDeadlineStatus(
        request?.hardDeleteAtMs,
      );
      if (deadline === "expired") return this._expireNow(fallback);
      if (deadline !== "valid") {
        return this._expireNow({
          committed: false,
          reason: "invalid_storage_deadline",
        });
      }
      return super.commitModelTurn(request);
    });
  }

  async releaseModelTurn(request = {}) {
    return this._beforeEstablishedGuestState(false, () =>
      super.releaseModelTurn(request),
    );
  }

  async recordFixedExchange(
    exchange,
    requestStartedAt,
    sessionIssuedAtMs,
    hardDeleteAtMs,
  ) {
    const fallback = { recorded: false, reason: "session_expired" };
    return this._beforeHardExpiry(fallback, async () => {
      const deadline = this._requiredHardDeadlineStatus(hardDeleteAtMs);
      if (deadline === "expired") return this._expireNow(fallback);
      if (deadline !== "valid") {
        return this._expireNow({
          recorded: false,
          reason: "invalid_storage_deadline",
        });
      }
      return super.recordFixedExchange(
        exchange,
        requestStartedAt,
        sessionIssuedAtMs,
        hardDeleteAtMs,
      );
    });
  }

  async recordLocalExchange() {
    return this._beforeEstablishedGuestState(
      { recorded: false, reason: "guest_legacy_write_blocked" },
      () => ({ recorded: false, reason: "guest_legacy_write_blocked" }),
    );
  }

  async recordExchange() {
    return this._beforeEstablishedGuestState(
      { recorded: false, reason: "guest_legacy_write_blocked" },
      () => ({ recorded: false, reason: "guest_legacy_write_blocked" }),
    );
  }

  async getCompactionSnapshot() {
    return this._beforeEstablishedGuestState(null, () =>
      super.getCompactionSnapshot(),
    );
  }

  async applySummary(...args) {
    return this._beforeEstablishedGuestState(false, () =>
      super.applySummary(...args),
    );
  }

  async eraseMemory(sessionIssuedAtMs, hardDeleteAtMs) {
    const fallback = { erased: false, reason: "session_expired" };
    return this._beforeHardExpiry(fallback, async () => {
      const deadline = this._requiredHardDeadlineStatus(hardDeleteAtMs);
      if (deadline === "expired") return this._expireNow(fallback);
      if (deadline !== "valid") {
        return this._expireNow({
          erased: false,
          reason: "invalid_storage_deadline",
        });
      }
      return super.eraseMemory(sessionIssuedAtMs, hardDeleteAtMs);
    });
  }

  async validateSession(sessionIssuedAtMsInput) {
    return this._beforeEstablishedGuestState({ allowed: false }, () =>
      super.validateSession(sessionIssuedAtMsInput),
    );
  }

  async getLifecycleStatus() {
    const fallback = {
      epoch: 0,
      hasLease: false,
      expiresAt: null,
      leaseExpiresAt: null,
    };
    return this._beforeEstablishedGuestState(fallback, () =>
      super.getLifecycleStatus(),
    );
  }

  async alarm() {
    return this._beforeEstablishedGuestState(undefined, () => super.alarm());
  }
}

import { DurableObject } from "cloudflare:workers";

export const SESSION_RETENTION_DAYS = 30;

const SESSION_RETENTION_MS = SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
const PROVIDER_TURN_LEASE_MS = 90 * 1_000;
const PROVIDER_QUIET_PERIOD_MS = 2 * 60 * 1_000;
const MAX_PROVIDER_QUIET_PERIOD_MS = 24 * 60 * 60 * 1_000;
const PROVIDER_CLEANUP_RETRY_MIN_MS = 60 * 1_000;
const PROVIDER_CLEANUP_RETRY_MAX_MS = 24 * 60 * 60 * 1_000;
const PROVIDER_CLEANUP_PROGRESS_MS = 1 * 1_000;
const PROVIDER_REQUEST_TIMEOUT_MS = 20 * 1_000;
const MAX_PROVIDER_ITEMS_PER_ALARM = 20;
// One claim can include a list request, a full sequential item page, and a
// container deletion. It must not expire while that bounded work is live.
const PROVIDER_CLEANUP_CLAIM_MS =
  (MAX_PROVIDER_ITEMS_PER_ALARM + 2) * PROVIDER_REQUEST_TIMEOUT_MS + 30 * 1_000;
const MAX_RECENT_MESSAGES = 8;
const MAX_STORED_MESSAGE_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 1_000;
const OPENAI_CONVERSATIONS_URL = "https://api.openai.com/v1/conversations";
const CONVERSATION_ID_PATTERN = /^conv_[A-Za-z0-9_-]{1,120}$/;
const ITEM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const LEASE_TOKEN_PATTERN = /^lease_[A-Za-z0-9_-]{20,128}$/;

class ProviderCleanupError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProviderCleanupError";
    this.code = code;
  }
}

function boundedText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function cleanConversationId(value) {
  const text = String(value || "").trim();
  return CONVERSATION_ID_PATTERN.test(text) ? text : null;
}

function cleanLeaseToken(value) {
  const text = String(value || "").trim();
  return LEASE_TOKEN_PATTERN.test(text) ? text : null;
}

function cleanEpoch(value) {
  const epoch = Number(value);
  return Number.isSafeInteger(epoch) && epoch > 0 ? epoch : null;
}

function cleanQuarantineDelay(value) {
  const delay = Number(value);
  if (!Number.isFinite(delay)) return PROVIDER_QUIET_PERIOD_MS;
  return Math.max(
    PROVIDER_QUIET_PERIOD_MS,
    Math.min(Math.floor(delay), MAX_PROVIDER_QUIET_PERIOD_MS),
  );
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

function providerHeaders(apiKey) {
  return {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
  };
}

async function providerFetch(url, apiKey, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      headers: providerHeaders(apiKey),
      signal: controller.signal,
    });
  } catch {
    throw new ProviderCleanupError(
      controller.signal.aborted ? "provider_timeout" : "provider_connection",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function listConversationItems(apiKey, conversationId) {
  const response = await providerFetch(
    `${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/items?limit=${MAX_PROVIDER_ITEMS_PER_ALARM}&order=desc`,
    apiKey,
  );

  // A missing Conversation container does not prove that its separately
  // retained items are gone. Keep the tombstone for an operator/provider retry.
  if (response.status === 404) {
    throw new ProviderCleanupError("item_list_not_found");
  }
  if (!response.ok) {
    throw new ProviderCleanupError("item_list_http_error");
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ProviderCleanupError("item_list_malformed");
  }

  if (
    body?.object !== "list" ||
    !Array.isArray(body.data) ||
    typeof body.has_more !== "boolean" ||
    body.data.length > MAX_PROVIDER_ITEMS_PER_ALARM ||
    (body.data.length === 0 && body.has_more)
  ) {
    throw new ProviderCleanupError("item_list_malformed");
  }

  const itemIds = body.data.map((item) => {
    const itemId = String(item?.id || "").trim();
    if (!ITEM_ID_PATTERN.test(itemId)) {
      throw new ProviderCleanupError("item_list_malformed");
    }
    return itemId;
  });

  if (new Set(itemIds).size !== itemIds.length) {
    throw new ProviderCleanupError("item_list_malformed");
  }

  return itemIds;
}

async function deleteConversationItem(apiKey, conversationId, itemId) {
  const response = await providerFetch(
    `${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/items/${encodeURIComponent(itemId)}`,
    apiKey,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404) {
    throw new ProviderCleanupError("item_delete_http_error");
  }
}

async function deleteEmptyConversation(apiKey, conversationId) {
  const response = await providerFetch(
    `${OPENAI_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}`,
    apiKey,
    { method: "DELETE" },
  );

  // A 404 is accepted here only because this same attempt first proved, with a
  // valid list response, that the item collection was empty.
  if (response.status === 404) return;
  if (!response.ok) {
    throw new ProviderCleanupError("conversation_delete_http_error");
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ProviderCleanupError("conversation_delete_malformed");
  }
  if (
    body?.id !== conversationId ||
    body?.object !== "conversation.deleted" ||
    body?.deleted !== true
  ) {
    throw new ProviderCleanupError("conversation_delete_malformed");
  }
}

async function purgeOneConversationPage(apiKey, conversationId) {
  const itemIds = await listConversationItems(apiKey, conversationId);
  if (itemIds.length) {
    for (const itemId of itemIds) {
      await deleteConversationItem(apiKey, conversationId, itemId);
    }
    // Always re-list on a later alarm before deleting the container. This
    // proves emptiness even if the provider changed pagination concurrently.
    return { complete: false };
  }

  await deleteEmptyConversation(apiKey, conversationId);
  return { complete: true };
}

function cleanupBackoffMs(attemptCount) {
  const exponent = Math.max(0, Math.min(Number(attemptCount) - 1, 8));
  return Math.min(
    PROVIDER_CLEANUP_RETRY_MIN_MS * 2 ** exponent,
    PROVIDER_CLEANUP_RETRY_MAX_MS,
  );
}

function cleanupErrorCode(error) {
  if (error instanceof ProviderCleanupError) return error.code;
  return error instanceof Error ? error.name : "UnknownError";
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
          last_turn_token TEXT,
          last_turn_epoch INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS provider_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          openai_conversation_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS provider_cleanup (
          conversation_id TEXT PRIMARY KEY,
          not_before INTEGER NOT NULL,
          next_attempt_at INTEGER NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          claim_token TEXT,
          claim_expires_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS provider_cleanup_due
          ON provider_cleanup(next_attempt_at, not_before);
      `);

      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO session_control (
           id, state_epoch, created_at, updated_at
         ) VALUES (1, 0, ?, ?)`,
        now,
        now,
      );

      // Adopt the old rolling-memory deadline when upgrading an existing DO.
      // The epoch row is never deleted, which prevents summary-version ABA.
      const control = this._controlRow();
      if (!Number(control.expires_at)) {
        const memory = this.ctx.storage.sql
          .exec("SELECT updated_at FROM memory_state WHERE id = 1")
          .toArray()[0];
        const provider = this.ctx.storage.sql
          .exec("SELECT updated_at FROM provider_state WHERE id = 1")
          .toArray()[0];
        const lastActivity = Math.max(
          Number(memory?.updated_at) || 0,
          Number(provider?.updated_at) || 0,
        );
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
        this._enforceDeadlinesInTransaction(now);
      });
      await this._syncAlarm(now);
    });
  }

  _controlRow() {
    return this.ctx.storage.sql
      .exec(
        `SELECT state_epoch, expires_at, lease_token, lease_epoch,
                lease_expires_at, last_turn_token, last_turn_epoch
         FROM session_control WHERE id = 1`,
      )
      .one();
  }

  _providerConversationId() {
    const provider = this.ctx.storage.sql
      .exec(
        `SELECT openai_conversation_id
         FROM provider_state WHERE id = 1`,
      )
      .toArray()[0];
    return cleanConversationId(provider?.openai_conversation_id);
  }

  _queueCleanupInTransaction(conversationId, notBefore, now) {
    const cleanId = cleanConversationId(conversationId);
    if (!cleanId) return false;

    const safeNotBefore = Math.max(Number(notBefore) || now, now);
    this.ctx.storage.sql.exec(
      `INSERT INTO provider_cleanup (
         conversation_id, not_before, next_attempt_at, attempt_count,
         claim_token, claim_expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, 0, NULL, NULL, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         not_before = MAX(provider_cleanup.not_before, excluded.not_before),
         next_attempt_at = MAX(
           provider_cleanup.next_attempt_at,
           excluded.next_attempt_at,
           provider_cleanup.not_before,
           excluded.not_before
         ),
         updated_at = excluded.updated_at`,
      cleanId,
      safeNotBefore,
      safeNotBefore,
      now,
      now,
    );
    return true;
  }

  _retireActiveProviderInTransaction(now, notBefore) {
    const conversationId = this._providerConversationId();
    if (conversationId) {
      this._queueCleanupInTransaction(conversationId, notBefore, now);
    }
    this.ctx.storage.sql.exec("DELETE FROM provider_state WHERE id = 1");
    return Boolean(conversationId);
  }

  _clearTurnAndBumpEpochInTransaction(now) {
    this.ctx.storage.sql.exec(
      `UPDATE session_control
       SET state_epoch = state_epoch + 1,
           lease_token = NULL,
           lease_epoch = NULL,
           lease_expires_at = NULL,
           last_turn_token = NULL,
           last_turn_epoch = NULL,
           updated_at = ?
       WHERE id = 1`,
      now,
    );
  }

  _eraseLocalTextInTransaction() {
    this.ctx.storage.sql.exec("DELETE FROM recent_messages");
    this.ctx.storage.sql.exec("DELETE FROM memory_state");
  }

  _enforceDeadlinesInTransaction(now) {
    let control = this._controlRow();
    const retentionExpired =
      Number(control.expires_at) > 0 && Number(control.expires_at) <= now;

    if (retentionExpired) {
      const leaseActive = Boolean(cleanLeaseToken(control.lease_token));
      this._retireActiveProviderInTransaction(
        now,
        leaseActive ? now + PROVIDER_QUIET_PERIOD_MS : now,
      );
      this._eraseLocalTextInTransaction();
      this._clearTurnAndBumpEpochInTransaction(now);
      this.ctx.storage.sql.exec(
        "UPDATE session_control SET expires_at = NULL WHERE id = 1",
      );
      return { retentionExpired: true, leaseExpired: leaseActive };
    }

    const leaseExpired =
      cleanLeaseToken(control.lease_token) &&
      Number(control.lease_expires_at) > 0 &&
      Number(control.lease_expires_at) <= now;
    if (leaseExpired) {
      this._retireActiveProviderInTransaction(
        now,
        now + PROVIDER_QUIET_PERIOD_MS,
      );
      this._clearTurnAndBumpEpochInTransaction(now);
      control = this._controlRow();
    }

    return { retentionExpired: false, leaseExpired: Boolean(leaseExpired) };
  }

  _readContextFromStorage() {
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

  async _armAtOrBefore(timestamp) {
    const deadline = Number(timestamp);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || deadline < current) {
      await this.ctx.storage.setAlarm(deadline);
    }
  }

  _nextDeadline() {
    const control = this._controlRow();
    const cleanup = this.ctx.storage.sql
      .exec(
        `SELECT MIN(
           CASE
             WHEN next_attempt_at > not_before THEN next_attempt_at
             ELSE not_before
           END
         ) AS deadline
         FROM provider_cleanup`,
      )
      .one();

    const deadlines = [
      Number(control.expires_at) || 0,
      Number(control.lease_expires_at) || 0,
      Number(cleanup.deadline) || 0,
    ].filter((value) => value > 0);
    return deadlines.length ? Math.min(...deadlines) : null;
  }

  async _syncAlarm(now = Date.now()) {
    const deadline = this._nextDeadline();
    if (deadline === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(deadline, now + 1_000));
  }

  async readContext() {
    const now = Date.now();
    const context = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      return this._readContextFromStorage();
    });
    await this._syncAlarm(now);
    return context;
  }

  async beginProviderTurn() {
    const now = Date.now();
    const leaseExpiresAt = now + PROVIDER_TURN_LEASE_MS;
    await this._armAtOrBefore(leaseExpiresAt);

    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const current = this._controlRow();
      const activeLease = cleanLeaseToken(current.lease_token);
      if (
        activeLease &&
        Number(current.lease_expires_at) > now
      ) {
        return {
          acquired: false,
          leaseToken: null,
          epoch: Number(current.state_epoch) || 0,
          leaseExpiresAt: Number(current.lease_expires_at),
          conversationId: null,
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
        conversationId: this._providerConversationId(),
        context: this._readContextFromStorage(),
      };
    });

    await this._syncAlarm(now);
    return result;
  }

  async adoptProviderConversation(request) {
    const leaseToken = cleanLeaseToken(request?.leaseToken);
    const epoch = cleanEpoch(request?.epoch);
    const candidateId = cleanConversationId(request?.candidateId);
    if (!leaseToken || !epoch || !candidateId) {
      throw new Error("Invalid provider conversation adoption");
    }

    const now = Date.now();
    await this._armAtOrBefore(now + SESSION_RETENTION_MS);

    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      const activeId = this._providerConversationId();
      const exactLease =
        control.lease_token === leaseToken &&
        Number(control.lease_epoch) === epoch &&
        Number(control.state_epoch) === epoch &&
        Number(control.lease_expires_at) > now;

      if (!exactLease) {
        this._queueCleanupInTransaction(candidateId, now, now);
        return {
          accepted: false,
          adopted: false,
          conversationId: activeId,
          reason: "stale_turn",
        };
      }

      if (activeId) {
        if (activeId !== candidateId) {
          this._queueCleanupInTransaction(candidateId, now, now);
        }
        return {
          accepted: activeId === candidateId,
          adopted: false,
          conversationId: activeId,
          reason: activeId === candidateId ? undefined : "conversation_exists",
        };
      }

      this.ctx.storage.sql.exec(
        `INSERT INTO provider_state (
           id, openai_conversation_id, created_at, updated_at
         ) VALUES (1, ?, ?, ?)`,
        candidateId,
        now,
        now,
      );
      return {
        accepted: true,
        adopted: true,
        conversationId: candidateId,
      };
    });

    await this._syncAlarm(now);
    return result;
  }

  async commitProviderTurn(request) {
    const leaseToken = cleanLeaseToken(request?.leaseToken);
    const epoch = cleanEpoch(request?.epoch);
    const conversationId = cleanConversationId(request?.conversationId);
    const exchange = cleanExchange(request?.exchange);
    if (!leaseToken || !epoch || !conversationId) {
      throw new Error("Invalid provider turn commit");
    }

    const now = Date.now();
    await this._armAtOrBefore(now + SESSION_RETENTION_MS);

    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      const exactLease =
        control.lease_token === leaseToken &&
        Number(control.lease_epoch) === epoch &&
        Number(control.state_epoch) === epoch &&
        Number(control.lease_expires_at) > now;
      if (!exactLease) {
        return { committed: false, reason: "stale_turn" };
      }
      if (this._providerConversationId() !== conversationId) {
        return { committed: false, reason: "conversation_mismatch" };
      }

      const memory = this._writeExchangeInTransaction(exchange, now);
      this.ctx.storage.sql.exec(
        `UPDATE provider_state SET updated_at = ? WHERE id = 1`,
        now,
      );
      this.ctx.storage.sql.exec(
        `UPDATE session_control
         SET expires_at = ?,
             lease_token = NULL,
             lease_epoch = NULL,
             lease_expires_at = NULL,
             last_turn_token = ?,
             last_turn_epoch = ?,
             updated_at = ?
         WHERE id = 1`,
        now + SESSION_RETENTION_MS,
        leaseToken,
        epoch,
        now,
      );
      return { committed: true, ...memory };
    });

    await this._syncAlarm(now);
    return result;
  }

  async releaseProviderTurn(request) {
    const leaseToken = cleanLeaseToken(request?.leaseToken);
    const epoch = cleanEpoch(request?.epoch);
    if (!leaseToken || !epoch) return false;

    const now = Date.now();
    const released = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      if (
        control.lease_token !== leaseToken ||
        Number(control.lease_epoch) !== epoch ||
        Number(control.state_epoch) !== epoch
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

    await this._syncAlarm(now);
    return released;
  }

  async quarantineProviderTurn(request) {
    const leaseToken = cleanLeaseToken(request?.leaseToken);
    const epoch = cleanEpoch(request?.epoch);
    const suppliedConversationId = String(
      request?.conversationId || "",
    ).trim();
    const conversationId = suppliedConversationId
      ? cleanConversationId(suppliedConversationId)
      : null;
    if (!leaseToken || !epoch || (suppliedConversationId && !conversationId)) {
      return false;
    }

    const now = Date.now();
    const notBefore = now + cleanQuarantineDelay(request?.delayMs);
    const quarantined = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      const activeId = this._providerConversationId();
      const currentTurn =
        control.lease_token === leaseToken &&
        Number(control.lease_epoch) === epoch &&
        Number(control.state_epoch) === epoch;
      const justCompletedTurn =
        control.last_turn_token === leaseToken &&
        Number(control.last_turn_epoch) === epoch;

      if (currentTurn) {
        this._retireActiveProviderInTransaction(now, notBefore);
        if (conversationId && conversationId !== activeId) {
          this._queueCleanupInTransaction(conversationId, notBefore, now);
        }
        this._clearTurnAndBumpEpochInTransaction(now);
        return true;
      }

      if (justCompletedTurn && conversationId && activeId === conversationId) {
        this._retireActiveProviderInTransaction(now, notBefore);
        this._clearTurnAndBumpEpochInTransaction(now);
        return true;
      }

      return Boolean(
        conversationId &&
        this.ctx.storage.sql
          .exec(
            `SELECT 1 AS present
             FROM provider_cleanup WHERE conversation_id = ?`,
            conversationId,
          )
          .toArray()[0],
      );
    });

    await this._syncAlarm(now);
    return quarantined;
  }

  async retireMissingProviderConversation(request) {
    const leaseToken = cleanLeaseToken(request?.leaseToken);
    const epoch = cleanEpoch(request?.epoch);
    const conversationId = cleanConversationId(request?.conversationId);
    if (!leaseToken || !epoch || !conversationId) return false;

    const now = Date.now();
    const retired = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      const exactTurn =
        control.lease_token === leaseToken &&
        Number(control.lease_epoch) === epoch &&
        Number(control.state_epoch) === epoch;
      if (exactTurn && this._providerConversationId() === conversationId) {
        this._retireActiveProviderInTransaction(now, now);
        this._clearTurnAndBumpEpochInTransaction(now);
        return true;
      }
      return Boolean(
        this.ctx.storage.sql
          .exec(
            "SELECT 1 AS present FROM provider_cleanup WHERE conversation_id = ?",
            conversationId,
          )
          .toArray()[0],
      );
    });

    await this._syncAlarm(now);
    return retired;
  }

  async recordFixedExchange(exchangeInput) {
    const exchange = cleanExchange(exchangeInput);
    const now = Date.now();
    await this._armAtOrBefore(now + SESSION_RETENTION_MS);

    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      this._retireActiveProviderInTransaction(
        now,
        now + PROVIDER_QUIET_PERIOD_MS,
      );
      this._clearTurnAndBumpEpochInTransaction(now);
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

    await this._syncAlarm(now);
    return result;
  }

  async recordLocalExchange(exchangeInput) {
    const exchange = cleanExchange(exchangeInput);
    const now = Date.now();
    await this._armAtOrBefore(now + SESSION_RETENTION_MS);

    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      this._retireActiveProviderInTransaction(
        now,
        cleanLeaseToken(control.lease_token)
          ? now + PROVIDER_QUIET_PERIOD_MS
          : now,
      );
      this._clearTurnAndBumpEpochInTransaction(now);
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

    await this._syncAlarm(now);
    return result;
  }

  async recordExchange(exchangeInput) {
    const exchange = cleanExchange(exchangeInput);
    const now = Date.now();
    await this._armAtOrBefore(now + SESSION_RETENTION_MS);

    const result = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      if (
        cleanLeaseToken(control.lease_token) ||
        Number(control.state_epoch) > 0 ||
        this._providerConversationId()
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

    await this._syncAlarm(now);
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
        stateEpoch: Number(control.state_epoch) || 0,
        throughSequence: messages.at(-1).sequence,
        messages: messages.map(({ role, content }) => ({ role, content })),
      };
    });
    await this._syncAlarm(now);
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

    await this._syncAlarm(now);
    return applied;
  }

  async eraseMemory() {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      const control = this._controlRow();
      this._retireActiveProviderInTransaction(
        now,
        cleanLeaseToken(control.lease_token)
          ? now + PROVIDER_QUIET_PERIOD_MS
          : now,
      );
      this._eraseLocalTextInTransaction();
      this._clearTurnAndBumpEpochInTransaction(now);
      this.ctx.storage.sql.exec(
        "UPDATE session_control SET expires_at = NULL WHERE id = 1",
      );
    });

    await this._syncAlarm(now);
    return true;
  }

  async purgeUnusedOpenAIConversation(conversationId) {
    const cleanId = cleanConversationId(conversationId);
    if (!cleanId) return false;

    const now = Date.now();
    await this._armAtOrBefore(now + 1_000);
    const queued = this.ctx.storage.transactionSync(() => {
      if (this._providerConversationId() === cleanId) return false;
      this._queueCleanupInTransaction(cleanId, now, now);
      return true;
    });
    await this._syncAlarm(now);
    return queued;
  }

  async getLifecycleStatus() {
    const now = Date.now();
    const status = this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
      const control = this._controlRow();
      const cleanup = this.ctx.storage.sql
        .exec("SELECT COUNT(*) AS count FROM provider_cleanup")
        .one();
      return {
        epoch: Number(control.state_epoch) || 0,
        hasActiveConversation: Boolean(this._providerConversationId()),
        hasLease: Boolean(cleanLeaseToken(control.lease_token)),
        cleanupPending: Number(cleanup.count) || 0,
        expiresAt: Number(control.expires_at) || null,
        leaseExpiresAt: Number(control.lease_expires_at) || null,
      };
    });
    await this._syncAlarm(now);
    return status;
  }

  _claimDueCleanup(now) {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec(
          `SELECT conversation_id, attempt_count
           FROM provider_cleanup
           WHERE not_before <= ?
             AND next_attempt_at <= ?
             AND (claim_token IS NULL OR claim_expires_at <= ?)
           ORDER BY next_attempt_at ASC, created_at ASC
           LIMIT 1`,
          now,
          now,
          now,
        )
        .toArray()[0];
      if (!row) return null;

      const conversationId = cleanConversationId(row.conversation_id);
      if (!conversationId) {
        this.ctx.storage.sql.exec(
          "DELETE FROM provider_cleanup WHERE conversation_id = ?",
          row.conversation_id,
        );
        return null;
      }

      const claimToken = "lease_" + crypto.randomUUID().replaceAll("-", "");
      const attemptCount = (Number(row.attempt_count) || 0) + 1;
      this.ctx.storage.sql.exec(
        `UPDATE provider_cleanup
         SET attempt_count = ?,
             claim_token = ?,
             claim_expires_at = ?,
             next_attempt_at = ?,
             updated_at = ?
         WHERE conversation_id = ?`,
        attemptCount,
        claimToken,
        now + PROVIDER_CLEANUP_CLAIM_MS,
        now + PROVIDER_CLEANUP_CLAIM_MS,
        now,
        conversationId,
      );
      return { conversationId, claimToken, attemptCount };
    });
  }

  _finishCleanup(claim, result, now) {
    this.ctx.storage.transactionSync(() => {
      if (result.complete) {
        this.ctx.storage.sql.exec(
          `DELETE FROM provider_cleanup
           WHERE conversation_id = ? AND claim_token = ?`,
          claim.conversationId,
          claim.claimToken,
        );
        return;
      }

      this.ctx.storage.sql.exec(
        `UPDATE provider_cleanup
         SET claim_token = NULL,
             claim_expires_at = NULL,
             next_attempt_at = ?,
             updated_at = ?
         WHERE conversation_id = ? AND claim_token = ?`,
        now + PROVIDER_CLEANUP_PROGRESS_MS,
        now,
        claim.conversationId,
        claim.claimToken,
      );
    });
  }

  _failCleanup(claim, now) {
    const retryAt = now + cleanupBackoffMs(claim.attemptCount);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE provider_cleanup
         SET claim_token = NULL,
             claim_expires_at = NULL,
             next_attempt_at = MAX(not_before, ?),
             updated_at = ?
         WHERE conversation_id = ? AND claim_token = ?`,
        retryAt,
        now,
        claim.conversationId,
        claim.claimToken,
      );
    });
  }

  async alarm() {
    const now = Date.now();

    // Local retention is enforced and committed before any provider I/O. A
    // missing key, malformed response, or provider outage cannot retain text.
    this.ctx.storage.transactionSync(() => {
      this._enforceDeadlinesInTransaction(now);
    });

    const claim = this._claimDueCleanup(now);
    if (claim) {
      try {
        const apiKey = String(this.env.OPENAI_API_KEY || "").trim();
        if (!apiKey) throw new ProviderCleanupError("missing_provider_key");
        const result = await purgeOneConversationPage(
          apiKey,
          claim.conversationId,
        );
        this._finishCleanup(claim, result, Date.now());
      } catch (error) {
        this._failCleanup(claim, Date.now());
        console.error(
          JSON.stringify({
            event: "openai_conversation_cleanup_deferred",
            error: cleanupErrorCode(error),
          }),
        );
      }
    }

    await this._syncAlarm(Date.now());
  }
}

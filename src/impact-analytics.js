import { DurableObject } from "cloudflare:workers";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETENTION_DAYS = 180;
const MAX_EVENTS_PER_SESSION_HOUR = 80;
const NEXT_STEP_EVENT = "next_step_reported";
const NEXT_STEP_VALUES = new Set(["shown", "yes", "partly", "no"]);

function boundedInteger(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function boundedText(value, limit = 128) {
  return String(value || "").trim().slice(0, limit);
}

function timestamp(value, fallback = Date.now()) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.round(number);
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function countBy(rows, keyName = "event_value") {
  const counts = {};
  for (const row of rows) {
    const key = String(row[keyName] || "unknown");
    counts[key] = Number(row.count) || 0;
  }
  return counts;
}

function retentionMs(env) {
  const days = boundedInteger(
    env?.IMPACT_RETENTION_DAYS,
    30,
    730,
    DEFAULT_RETENTION_DAYS,
  );
  return days * DAY_MS;
}

export class ImpactAnalytics extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS chat_turns (
          turn_id TEXT PRIMARY KEY,
          occurred_at INTEGER NOT NULL,
          session_hash TEXT NOT NULL,
          browser_hash TEXT NOT NULL,
          account_type TEXT NOT NULL,
          route TEXT,
          status TEXT NOT NULL DEFAULT 'started',
          http_status INTEGER,
          total_response_ms INTEGER,
          model TEXT,
          estimated_cost_micros INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS chat_turns_occurred_at
          ON chat_turns (occurred_at);
        CREATE INDEX IF NOT EXISTS chat_turns_session
          ON chat_turns (session_hash, occurred_at);

        CREATE TABLE IF NOT EXISTS impact_events (
          event_id TEXT PRIMARY KEY,
          occurred_at INTEGER NOT NULL,
          session_hash TEXT NOT NULL,
          browser_hash TEXT NOT NULL,
          turn_id TEXT,
          event_type TEXT NOT NULL,
          event_value TEXT,
          response_type TEXT,
          prompt_version TEXT,
          first_token_ms INTEGER,
          total_response_ms INTEGER,
          verified_turn INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS impact_events_occurred_at
          ON impact_events (occurred_at);
        CREATE INDEX IF NOT EXISTS impact_events_turn
          ON impact_events (turn_id, event_type);
        CREATE INDEX IF NOT EXISTS impact_events_session
          ON impact_events (session_hash, occurred_at);
      `);
    });
  }

  async scheduleRetention(now = Date.now()) {
    const next = now + DAY_MS;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  async startChat(record) {
    const turnId = boundedText(record?.turnId, 64);
    const sessionHash = boundedText(record?.sessionHash, 128);
    const browserHash = boundedText(record?.browserHash, 128);
    if (!turnId || !sessionHash || !browserHash) return false;

    const occurredAt = timestamp(record?.occurredAt);
    this.ctx.storage.sql.exec(
      `INSERT INTO chat_turns (
         turn_id, occurred_at, session_hash, browser_hash,
         account_type, route, status, model, estimated_cost_micros
       ) VALUES (?, ?, ?, ?, ?, NULL, 'started', ?, ?)
       ON CONFLICT(turn_id) DO NOTHING`,
      turnId,
      occurredAt,
      sessionHash,
      browserHash,
      boundedText(record?.accountType, 24) || "guest",
      boundedText(record?.model, 128) || null,
      boundedInteger(record?.estimatedCostMicros, 0, 100_000_000, 0),
    );
    await this.scheduleRetention(occurredAt);
    return true;
  }

  async finishChat(record) {
    const turnId = boundedText(record?.turnId, 64);
    if (!turnId) return false;

    this.ctx.storage.sql.exec(
      `UPDATE chat_turns SET
         route = ?,
         status = ?,
         http_status = ?,
         total_response_ms = ?
       WHERE turn_id = ?`,
      boundedText(record?.route, 64) || "UNKNOWN",
      boundedText(record?.status, 24) || "completed",
      boundedInteger(record?.httpStatus, 0, 599, 0) || null,
      boundedInteger(record?.totalResponseMs, 0, 600_000, 0),
      turnId,
    );
    return true;
  }

  async recordEvent(record) {
    const eventId = boundedText(record?.eventId, 64);
    const eventType = boundedText(record?.eventType, 64);
    const eventValue = boundedText(record?.eventValue, 96);
    const sessionHash = boundedText(record?.sessionHash, 128);
    const browserHash = boundedText(record?.browserHash, 128);
    const turnId = boundedText(record?.turnId, 64);
    if (
      !eventId ||
      eventType !== NEXT_STEP_EVENT ||
      !NEXT_STEP_VALUES.has(eventValue) ||
      !sessionHash ||
      !browserHash ||
      !turnId
    ) {
      return { accepted: false, reason: "invalid" };
    }

    const occurredAt = timestamp(record?.occurredAt);
    const recentCount = Number(
      this.ctx.storage.sql
        .exec(
          `SELECT COUNT(*) AS count
           FROM impact_events
           WHERE session_hash = ? AND occurred_at >= ?`,
          sessionHash,
          occurredAt - 60 * 60 * 1_000,
        )
        .one().count,
    );
    if (recentCount >= MAX_EVENTS_PER_SESSION_HOUR) {
      return { accepted: false, reason: "rate" };
    }

    const chat = this.ctx.storage.sql
      .exec(
        `SELECT session_hash, browser_hash
         FROM chat_turns WHERE turn_id = ?`,
        turnId,
      )
      .toArray()[0];
    if (
      !chat ||
      chat.session_hash !== sessionHash ||
      chat.browser_hash !== browserHash
    ) {
      return { accepted: false, reason: "turn" };
    }

    const existing = this.ctx.storage.sql
      .exec(
        `SELECT event_id, event_value
         FROM impact_events
         WHERE turn_id = ? AND event_type = ?
         LIMIT 1`,
        turnId,
        NEXT_STEP_EVENT,
      )
      .toArray()[0];

    if (existing) {
      // One row holds the current state for an eligible response. A late
      // `shown` retry may not overwrite a user answer, and the first answer wins.
      if (existing.event_value !== "shown" || eventValue === "shown") {
        return { accepted: true, duplicate: true, verifiedTurn: true };
      }
      this.ctx.storage.sql.exec(
        `UPDATE impact_events SET
           occurred_at = ?, event_value = ?, prompt_version = ?
         WHERE event_id = ?`,
        occurredAt,
        eventValue,
        boundedText(record?.promptVersion, 32) || null,
        existing.event_id,
      );
      await this.scheduleRetention(occurredAt);
      return { accepted: true, updated: true, verifiedTurn: true };
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO impact_events (
         event_id, occurred_at, session_hash, browser_hash, turn_id,
         event_type, event_value, response_type, prompt_version,
         first_token_ms, total_response_ms, verified_turn
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 1)`,
      eventId,
      occurredAt,
      sessionHash,
      browserHash,
      turnId,
      NEXT_STEP_EVENT,
      eventValue,
      boundedText(record?.promptVersion, 32) || null,
    );
    await this.scheduleRetention(occurredAt);
    return { accepted: true, verifiedTurn: true };
  }

  async summary(options = {}) {
    const now = timestamp(options?.now);
    const since = Math.max(
      now - 90 * DAY_MS,
      timestamp(options?.since, now - 30 * DAY_MS),
    );

    const outcomeStates = countBy(
      this.ctx.storage.sql
        .exec(
          `SELECT event_value, COUNT(*) AS count
           FROM impact_events
           WHERE occurred_at >= ?
             AND verified_turn = 1
             AND event_type = ?
           GROUP BY event_value`,
          since,
          NEXT_STEP_EVENT,
        )
        .toArray(),
    );
    const prompts = Object.values(outcomeStates).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    );
    const responses = ["yes", "partly", "no"].reduce(
      (sum, key) => sum + Number(outcomeStates[key] || 0),
      0,
    );
    const resolved = Number(outcomeStates.yes || 0);

    const reach = this.ctx.storage.sql
      .exec(
        `SELECT COUNT(DISTINCT session_hash) AS sessions,
                COUNT(DISTINCT browser_hash) AS browsers
         FROM impact_events
         WHERE occurred_at >= ?
           AND event_type = ?
           AND verified_turn = 1`,
        since,
        NEXT_STEP_EVENT,
      )
      .one();

    const chatCounts = this.ctx.storage.sql
      .exec(
        `SELECT status, COUNT(*) AS count,
                COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros
         FROM chat_turns
         WHERE occurred_at >= ?
         GROUP BY status`,
        since,
      )
      .toArray();
    const chats = chatCounts.reduce(
      (sum, row) => sum + Number(row.count || 0),
      0,
    );
    const completedChats = chatCounts
      .filter((row) => row.status === "completed")
      .reduce((sum, row) => sum + Number(row.count || 0), 0);
    const estimatedCostMicros = chatCounts.reduce(
      (sum, row) => sum + Number(row.estimated_cost_micros || 0),
      0,
    );

    return {
      since,
      now,
      prompts,
      responses,
      resolved,
      outcomeStates,
      responseRate: rate(responses, prompts),
      reportedResolutionRate: rate(resolved, responses),
      sessions: Number(reach.sessions || 0),
      browsers: Number(reach.browsers || 0),
      chats,
      completedChats,
      chatCompletionRate: rate(completedChats, chats),
      estimatedCostMicros,
      estimatedCostPerResolutionMicros:
        resolved > 0 && estimatedCostMicros > 0
          ? Math.round(estimatedCostMicros / resolved)
          : null,
    };
  }

  async alarm() {
    const cutoff = Date.now() - retentionMs(this.env);
    this.ctx.storage.sql.exec(
      "DELETE FROM impact_events WHERE occurred_at < ?",
      cutoff,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM chat_turns WHERE occurred_at < ?",
      cutoff,
    );

    const remaining = Number(
      this.ctx.storage.sql
        .exec(
          `SELECT
             (SELECT COUNT(*) FROM impact_events) +
             (SELECT COUNT(*) FROM chat_turns) AS count`,
        )
        .one().count,
    );
    if (remaining > 0) await this.scheduleRetention();
  }
}

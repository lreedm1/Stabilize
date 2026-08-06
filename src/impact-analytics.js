import { DurableObject } from "cloudflare:workers";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETENTION_DAYS = 180;
const MAX_EVENTS_PER_SESSION_HOUR = 80;
const NEXT_STEP_EVENT = "next_step_reported";
const NEXT_STEP_VALUES = new Set(["shown", "yes", "partly", "no"]);
const MESSAGE_FEEDBACK_RATINGS = new Set(["shown", "up", "down"]);
const MESSAGE_FEEDBACK_REASONS = new Set([
  "clear_answer",
  "useful_next_step",
  "felt_relevant",
  "helped_me_decide",
  "helped_me_feel_steadier",
  "did_not_answer",
  "misunderstood_me",
  "too_generic",
  "too_long",
  "inaccurate",
  "repetitive",
  "unsafe_or_concerning",
  "technical_problem",
  "other",
]);
const MAX_COMMENT_CHARS = 500;

function boundedInteger(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function boundedText(value, limit = 128) {
  return String(value || "").trim().slice(0, limit);
}

function cleanComment(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_COMMENT_CHARS);
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
        CREATE INDEX IF NOT EXISTS chat_turns_browser
          ON chat_turns (browser_hash, occurred_at);

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

        CREATE TABLE IF NOT EXISTS message_feedback (
          turn_id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          session_hash TEXT NOT NULL,
          browser_hash TEXT NOT NULL,
          rating TEXT NOT NULL,
          reason TEXT,
          comment TEXT
        );

        CREATE INDEX IF NOT EXISTS message_feedback_occurred_at
          ON message_feedback (occurred_at);
        CREATE INDEX IF NOT EXISTS message_feedback_session
          ON message_feedback (session_hash, occurred_at);
        CREATE INDEX IF NOT EXISTS message_feedback_rating
          ON message_feedback (rating, occurred_at);
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

  recentSessionEventCount(sessionHash, occurredAt) {
    return Number(
      this.ctx.storage.sql
        .exec(
          `SELECT
             (SELECT COUNT(*) FROM impact_events
              WHERE session_hash = ? AND occurred_at >= ?) +
             (SELECT COUNT(*) FROM message_feedback
              WHERE session_hash = ? AND occurred_at >= ?) AS count`,
          sessionHash,
          occurredAt - 60 * 60 * 1_000,
          sessionHash,
          occurredAt - 60 * 60 * 1_000,
        )
        .one().count,
    );
  }

  verifiedChat(turnId, sessionHash, browserHash) {
    const chat = this.ctx.storage.sql
      .exec(
        `SELECT session_hash, browser_hash
         FROM chat_turns WHERE turn_id = ?`,
        turnId,
      )
      .toArray()[0];
    return Boolean(
      chat &&
        chat.session_hash === sessionHash &&
        chat.browser_hash === browserHash,
    );
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
    if (this.recentSessionEventCount(sessionHash, occurredAt) >= MAX_EVENTS_PER_SESSION_HOUR) {
      return { accepted: false, reason: "rate" };
    }

    if (!this.verifiedChat(turnId, sessionHash, browserHash)) {
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

  async recordMessageFeedback(record) {
    const eventId = boundedText(record?.eventId, 64);
    const sessionHash = boundedText(record?.sessionHash, 128);
    const browserHash = boundedText(record?.browserHash, 128);
    const turnId = boundedText(record?.turnId, 64);
    const rating = boundedText(record?.rating, 16);
    const reason = boundedText(record?.reason, 64);
    const comment = cleanComment(record?.comment);

    if (
      !eventId ||
      !sessionHash ||
      !browserHash ||
      !turnId ||
      !MESSAGE_FEEDBACK_RATINGS.has(rating) ||
      (reason && !MESSAGE_FEEDBACK_REASONS.has(reason)) ||
      (rating === "shown" && (reason || comment))
    ) {
      return { accepted: false, reason: "invalid" };
    }

    const occurredAt = timestamp(record?.occurredAt);
    if (this.recentSessionEventCount(sessionHash, occurredAt) >= MAX_EVENTS_PER_SESSION_HOUR) {
      return { accepted: false, reason: "rate" };
    }
    if (!this.verifiedChat(turnId, sessionHash, browserHash)) {
      return { accepted: false, reason: "turn" };
    }

    const existing = this.ctx.storage.sql
      .exec(
        `SELECT event_id, rating, reason, comment
         FROM message_feedback WHERE turn_id = ?`,
        turnId,
      )
      .toArray()[0];

    if (existing) {
      if (rating === "shown" && existing.rating !== "shown") {
        return { accepted: true, duplicate: true, verifiedTurn: true };
      }

      const nextRating = rating === "shown" ? existing.rating : rating;
      const ratingChanged = nextRating !== existing.rating;
      const nextReason = reason || (ratingChanged ? null : existing.reason);
      const nextComment = comment || existing.comment;
      const unchanged =
        nextRating === existing.rating &&
        (nextReason || null) === (existing.reason || null) &&
        (nextComment || null) === (existing.comment || null);
      if (unchanged) {
        return { accepted: true, duplicate: true, verifiedTurn: true };
      }

      this.ctx.storage.sql.exec(
        `UPDATE message_feedback SET
           event_id = ?, occurred_at = ?, rating = ?, reason = ?, comment = ?
         WHERE turn_id = ?`,
        eventId,
        occurredAt,
        nextRating,
        nextReason || null,
        nextComment || null,
        turnId,
      );
      await this.scheduleRetention(occurredAt);
      return { accepted: true, updated: true, verifiedTurn: true };
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO message_feedback (
         turn_id, event_id, occurred_at, session_hash, browser_hash,
         rating, reason, comment
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      turnId,
      eventId,
      occurredAt,
      sessionHash,
      browserHash,
      rating,
      reason || null,
      comment || null,
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

    const feedbackStates = countBy(
      this.ctx.storage.sql
        .exec(
          `SELECT rating, COUNT(*) AS count
           FROM message_feedback
           WHERE occurred_at >= ?
           GROUP BY rating`,
          since,
        )
        .toArray(),
      "rating",
    );
    const feedbackShown = Object.values(feedbackStates).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    );
    const feedbackResponses = Number(feedbackStates.up || 0) + Number(feedbackStates.down || 0);
    const helpfulResponses = Number(feedbackStates.up || 0);
    const unhelpfulResponses = Number(feedbackStates.down || 0);
    const feedbackReasons = countBy(
      this.ctx.storage.sql
        .exec(
          `SELECT reason, COUNT(*) AS count
           FROM message_feedback
           WHERE occurred_at >= ? AND reason IS NOT NULL
           GROUP BY reason`,
          since,
        )
        .toArray(),
      "reason",
    );
    const feedbackComments = Number(
      this.ctx.storage.sql
        .exec(
          `SELECT COUNT(*) AS count
           FROM message_feedback
           WHERE occurred_at >= ? AND comment IS NOT NULL AND comment <> ''`,
          since,
        )
        .one().count,
    );

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

    const chatSessionRows = this.ctx.storage.sql
      .exec(
        `SELECT session_hash, COUNT(*) AS count
         FROM chat_turns
         WHERE occurred_at >= ?
         GROUP BY session_hash`,
        since,
      )
      .toArray();
    const chatSessions = chatSessionRows.length;
    const multiTurnSessions = chatSessionRows.filter(
      (row) => Number(row.count || 0) >= 2,
    ).length;

    const chatBrowserRows = this.ctx.storage.sql
      .exec(
        `SELECT browser_hash,
                COUNT(DISTINCT CAST(occurred_at / ? AS INTEGER)) AS active_days
         FROM chat_turns
         WHERE occurred_at >= ?
         GROUP BY browser_hash`,
        DAY_MS,
        since,
      )
      .toArray();
    const chatBrowsers = chatBrowserRows.length;
    const returningBrowsers = chatBrowserRows.filter(
      (row) => Number(row.active_days || 0) >= 2,
    ).length;

    const chatCounts = this.ctx.storage.sql
      .exec(
        `SELECT status, COUNT(*) AS count,
                COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros,
                COALESCE(SUM(total_response_ms), 0) AS response_ms_total,
                SUM(CASE WHEN total_response_ms IS NOT NULL THEN 1 ELSE 0 END) AS timed_chats
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
    const failedChats = chatCounts
      .filter((row) => row.status === "error")
      .reduce((sum, row) => sum + Number(row.count || 0), 0);
    const estimatedCostMicros = chatCounts.reduce(
      (sum, row) => sum + Number(row.estimated_cost_micros || 0),
      0,
    );
    const responseMsTotal = chatCounts.reduce(
      (sum, row) => sum + Number(row.response_ms_total || 0),
      0,
    );
    const timedChats = chatCounts.reduce(
      (sum, row) => sum + Number(row.timed_chats || 0),
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
      feedbackShown,
      feedbackResponses,
      helpfulResponses,
      unhelpfulResponses,
      feedbackStates,
      feedbackReasons,
      feedbackComments,
      feedbackResponseRate: rate(feedbackResponses, feedbackShown),
      helpfulResponseRate: rate(helpfulResponses, feedbackResponses),
      chats,
      completedChats,
      failedChats,
      chatCompletionRate: rate(completedChats, chats),
      chatSessions,
      multiTurnSessions,
      secondMessageRate: rate(multiTurnSessions, chatSessions),
      chatBrowsers,
      returningBrowsers,
      returningBrowserRate: rate(returningBrowsers, chatBrowsers),
      responseMsTotal,
      timedChats,
      averageResponseMs: timedChats > 0 ? Math.round(responseMsTotal / timedChats) : null,
      estimatedCostMicros,
      estimatedCostPerResolutionMicros:
        resolved > 0 && estimatedCostMicros > 0
          ? Math.round(estimatedCostMicros / resolved)
          : null,
      estimatedCostPerHelpfulMicros:
        helpfulResponses > 0 && estimatedCostMicros > 0
          ? Math.round(estimatedCostMicros / helpfulResponses)
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
      "DELETE FROM message_feedback WHERE occurred_at < ?",
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
             (SELECT COUNT(*) FROM message_feedback) +
             (SELECT COUNT(*) FROM chat_turns) AS count`,
        )
        .one().count,
    );
    if (remaining > 0) await this.scheduleRetention();
  }
}

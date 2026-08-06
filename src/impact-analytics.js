import { DurableObject } from "cloudflare:workers";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETENTION_DAYS = 180;
const MAX_EVENTS_PER_SESSION_HOUR = 80;
export const IMPACT_LATENCY_BUCKETS_MS = Object.freeze([
  50, 100, 150, 250, 400, 600, 800, 1_000, 1_500, 2_000, 3_000,
  5_000, 8_000, 12_000, 20_000, 30_000, 45_000, 60_000, 90_000,
  120_000, 180_000, 300_000, 600_000,
]);
const SINGLE_EVENT_TYPES = new Set([
  "outcome_prompt_shown",
  "clarity_answered",
  "outcome_selected",
  "proportionality_answered",
  "response_completed",
]);

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

function latencyHistogram(values) {
  const counts = Array(IMPACT_LATENCY_BUCKETS_MS.length).fill(0);
  for (const value of values) {
    const index = IMPACT_LATENCY_BUCKETS_MS.findIndex((bound) => value <= bound);
    counts[index < 0 ? counts.length - 1 : index] += 1;
  }
  return counts;
}

export function percentileFromHistogram(counts, fraction) {
  const total = Array.isArray(counts)
    ? counts.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
    : 0;
  if (total < 1) return null;
  const target = Math.max(1, Math.ceil(total * fraction));
  let cumulative = 0;
  for (let index = 0; index < IMPACT_LATENCY_BUCKETS_MS.length; index += 1) {
    cumulative += Math.max(0, Number(counts[index]) || 0);
    if (cumulative >= target) return IMPACT_LATENCY_BUCKETS_MS[index];
  }
  return IMPACT_LATENCY_BUCKETS_MS.at(-1);
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
    const sessionHash = boundedText(record?.sessionHash, 128);
    const browserHash = boundedText(record?.browserHash, 128);
    const turnId = boundedText(record?.turnId, 64) || null;
    if (!eventId || !eventType || !sessionHash || !browserHash) {
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

    let verifiedTurn = 0;
    if (turnId) {
      const chat = this.ctx.storage.sql
        .exec(
          `SELECT session_hash, browser_hash
           FROM chat_turns WHERE turn_id = ?`,
          turnId,
        )
        .toArray()[0];
      if (
        chat &&
        chat.session_hash === sessionHash &&
        chat.browser_hash === browserHash
      ) {
        verifiedTurn = 1;
      } else {
        return { accepted: false, reason: "turn" };
      }
    }

    if (turnId && SINGLE_EVENT_TYPES.has(eventType)) {
      const existing = this.ctx.storage.sql
        .exec(
          `SELECT 1 AS found
           FROM impact_events
           WHERE turn_id = ? AND event_type = ?
           LIMIT 1`,
          turnId,
          eventType,
        )
        .toArray()[0];
      if (existing) return { accepted: true, duplicate: true };
    }

    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO impact_events (
         event_id, occurred_at, session_hash, browser_hash, turn_id,
         event_type, event_value, response_type, prompt_version,
         first_token_ms, total_response_ms, verified_turn
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      eventId,
      occurredAt,
      sessionHash,
      browserHash,
      turnId,
      eventType,
      boundedText(record?.eventValue, 96) || null,
      boundedText(record?.responseType, 32) || null,
      boundedText(record?.promptVersion, 32) || null,
      boundedInteger(record?.firstTokenMs, 0, 600_000, 0) || null,
      boundedInteger(record?.totalResponseMs, 0, 600_000, 0) || null,
      verifiedTurn,
    );
    await this.scheduleRetention(occurredAt);
    return { accepted: true, verifiedTurn: verifiedTurn === 1 };
  }

  async summary(options = {}) {
    const now = timestamp(options?.now);
    const since = Math.max(
      now - 90 * DAY_MS,
      timestamp(options?.since, now - 30 * DAY_MS),
    );

    const groupedEvents = this.ctx.storage.sql
      .exec(
        `SELECT event_type, COALESCE(event_value, '') AS event_value,
                COUNT(*) AS count
         FROM impact_events
         WHERE occurred_at >= ? AND verified_turn = 1
         GROUP BY event_type, event_value`,
        since,
      )
      .toArray();

    const groupedByType = new Map();
    for (const row of groupedEvents) {
      const type = String(row.event_type);
      if (!groupedByType.has(type)) groupedByType.set(type, []);
      groupedByType.get(type).push(row);
    }

    const prompts = Number(
      groupedByType.get("outcome_prompt_shown")?.[0]?.count || 0,
    );
    const clarity = countBy(groupedByType.get("clarity_answered") || []);
    const clarityAnswers = Object.values(clarity).reduce(
      (sum, value) => sum + value,
      0,
    );
    const outcomes = countBy(groupedByType.get("outcome_selected") || []);
    const outcomeAnswers = Object.values(outcomes).reduce(
      (sum, value) => sum + value,
      0,
    );
    const resolved = ["answer", "action", "contact", "pause"].reduce(
      (sum, key) => sum + Number(outcomes[key] || 0),
      0,
    );
    const proportionality = countBy(
      groupedByType.get("proportionality_answered") || [],
    );
    const revisions = countBy(
      groupedByType.get("revision_requested") || [],
    );

    const reach = this.ctx.storage.sql
      .exec(
        `SELECT COUNT(DISTINCT session_hash) AS sessions,
                COUNT(DISTINCT browser_hash) AS browsers
         FROM impact_events
         WHERE occurred_at >= ?
           AND event_type = 'outcome_prompt_shown'
           AND verified_turn = 1`,
        since,
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

    const routes = this.ctx.storage.sql
      .exec(
        `SELECT COALESCE(route, 'UNKNOWN') AS route, COUNT(*) AS count
         FROM chat_turns
         WHERE occurred_at >= ?
         GROUP BY route
         ORDER BY count DESC`,
        since,
      )
      .toArray()
      .map((row) => ({ route: String(row.route), count: Number(row.count) }));

    const latencyRows = this.ctx.storage.sql
      .exec(
        `SELECT first_token_ms, total_response_ms
         FROM impact_events
         WHERE occurred_at >= ?
           AND event_type = 'response_completed'
           AND verified_turn = 1`,
        since,
      )
      .toArray();
    const firstTokenValues = latencyRows
      .filter((row) => row.first_token_ms !== null)
      .map((row) => Number(row.first_token_ms))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const totalValues = latencyRows
      .filter((row) => row.total_response_ms !== null)
      .map((row) => Number(row.total_response_ms))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const firstTokenHistogram = latencyHistogram(firstTokenValues);
    const totalHistogram = latencyHistogram(totalValues);

    const dailyRows = this.ctx.storage.sql
      .exec(
        `SELECT CAST(occurred_at / ? AS INTEGER) AS day_number,
                event_type,
                COALESCE(event_value, '') AS event_value,
                COUNT(*) AS count
         FROM impact_events
         WHERE occurred_at >= ?
           AND verified_turn = 1
           AND event_type IN ('outcome_prompt_shown', 'outcome_selected')
         GROUP BY day_number, event_type, event_value
         ORDER BY day_number ASC`,
        DAY_MS,
        Math.max(since, now - 14 * DAY_MS),
      )
      .toArray();

    const trendMap = new Map();
    for (const row of dailyRows) {
      const dayNumber = Number(row.day_number);
      if (!trendMap.has(dayNumber)) {
        trendMap.set(dayNumber, { prompts: 0, resolved: 0 });
      }
      const day = trendMap.get(dayNumber);
      if (row.event_type === "outcome_prompt_shown") {
        day.prompts += Number(row.count) || 0;
      }
      if (
        row.event_type === "outcome_selected" &&
        ["answer", "action", "contact", "pause"].includes(row.event_value)
      ) {
        day.resolved += Number(row.count) || 0;
      }
    }
    const trend = [...trendMap.entries()].map(([dayNumber, day]) => ({
      date: new Date(dayNumber * DAY_MS).toISOString().slice(0, 10),
      prompts: day.prompts,
      resolved: day.resolved,
      lowerBound: rate(day.resolved, day.prompts),
    }));

    const totalChats = chatCounts.reduce(
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
      clarityAnswers,
      clarity,
      reportedClarityRate: rate(
        Number(clarity.yes || 0) + Number(clarity.partly || 0),
        clarityAnswers,
      ),
      promptResponseRate: rate(clarityAnswers, prompts),
      outcomeAnswers,
      outcomes,
      resolved,
      reportedResolutionRate: rate(resolved, outcomeAnswers),
      resolutionLowerBound: rate(resolved, prompts),
      proportionality,
      proportionalResponseRate: rate(
        Number(proportionality.about_right || 0),
        Object.values(proportionality).reduce(
          (sum, value) => sum + value,
          0,
        ),
      ),
      revisions,
      sessions: Number(reach.sessions || 0),
      browsers: Number(reach.browsers || 0),
      chats: totalChats,
      completedChats,
      chatCompletionRate: rate(completedChats, totalChats),
      estimatedCostMicros,
      estimatedCostPerResolutionMicros:
        resolved > 0 && estimatedCostMicros > 0
          ? Math.round(estimatedCostMicros / resolved)
          : null,
      latency: {
        samples: latencyRows.length,
        firstTokenHistogram,
        totalHistogram,
        firstTokenP50Ms: percentileFromHistogram(firstTokenHistogram, 0.5),
        firstTokenP95Ms: percentileFromHistogram(firstTokenHistogram, 0.95),
        totalP50Ms: percentileFromHistogram(totalHistogram, 0.5),
        totalP95Ms: percentileFromHistogram(totalHistogram, 0.95),
      },
      routes,
      trend,
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

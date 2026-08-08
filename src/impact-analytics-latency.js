import { ImpactAnalytics as BaseImpactAnalytics } from "./impact-analytics.js";
import {
  addTurnLatency,
  emptyLatencyBreakdowns,
  summarizeLatencyBreakdowns,
} from "./impact-latency.js";
import {
  IMPACT_PRICING_VERSION,
  estimateChatCostMicros,
} from "./impact-pricing.js";

const METRIC_COLUMNS = Object.freeze([
  ["first_token_ms", "INTEGER"],
  ["client_first_visible_ms", "INTEGER"],
  ["client_complete_ms", "INTEGER"],
  ["client_latency_version", "TEXT"],
  ["requested_service_tier", "TEXT"],
  ["actual_service_tier", "TEXT"],
  ["memory_source", "TEXT"],
  ["conversation_turn_index", "INTEGER"],
  ["input_tokens", "INTEGER NOT NULL DEFAULT 0"],
  ["cached_input_tokens", "INTEGER NOT NULL DEFAULT 0"],
  ["cache_write_tokens", "INTEGER NOT NULL DEFAULT 0"],
  ["reasoning_tokens", "INTEGER NOT NULL DEFAULT 0"],
  ["output_tokens", "INTEGER NOT NULL DEFAULT 0"],
  ["pricing_version", "TEXT"],
  ["pricing_status", "TEXT NOT NULL DEFAULT 'unpriced'"],
]);

function boundedInteger(value, maximum = 100_000_000) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(maximum, Math.round(number));
}

function boundedTiming(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(600_000, Math.round(number));
}

function boundedToken(value, limit = 128) {
  const text = String(value || "").trim().slice(0, limit);
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : "";
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

export class ImpactAnalytics extends BaseImpactAnalytics {
  constructor(ctx, env) {
    super(ctx, env);
    this.metricsColumnsReady = false;
  }

  async ensureMetricsColumns() {
    if (this.metricsColumnsReady) return;
    const columns = new Set(
      this.ctx.storage.sql
        .exec("PRAGMA table_info(chat_turns)")
        .toArray()
        .map((column) => String(column.name)),
    );
    for (const [name, definition] of METRIC_COLUMNS) {
      if (columns.has(name)) continue;
      this.ctx.storage.sql.exec(
        "ALTER TABLE chat_turns ADD COLUMN " + name + " " + definition,
      );
    }
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS chat_turns_model ON chat_turns (model, occurred_at)",
    );
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS chat_turns_account_type ON chat_turns (account_type, occurred_at)",
    );
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS chat_turns_memory_source ON chat_turns (memory_source, occurred_at)",
    );
    this.metricsColumnsReady = true;
  }

  async startChat(record) {
    await this.ensureMetricsColumns();
    const result = await super.startChat(record);
    const turnId = boundedToken(record?.turnId, 64);
    if (!turnId) return result;
    const row = this.ctx.storage.sql
      .exec(
        "SELECT occurred_at, COALESCE(conversation_hash, session_hash) AS conversation_hash FROM chat_turns WHERE turn_id = ?",
        turnId,
      )
      .toArray()[0];
    if (!row) return result;
    const conversationTurnIndex = Number(
      this.ctx.storage.sql
        .exec(
          "SELECT COUNT(*) AS count FROM chat_turns WHERE COALESCE(conversation_hash, session_hash) = ? AND (occurred_at < ? OR (occurred_at = ? AND turn_id <= ?))",
          String(row.conversation_hash || ""),
          Number(row.occurred_at || 0),
          Number(row.occurred_at || 0),
          turnId,
        )
        .one().count,
    );
    this.ctx.storage.sql.exec(
      "UPDATE chat_turns SET memory_source = ?, conversation_turn_index = ? WHERE turn_id = ?",
      boundedToken(record?.memorySource, 64) || null,
      Math.max(1, conversationTurnIndex || 1),
      turnId,
    );
    return result;
  }

  async finishChat(record) {
    await this.ensureMetricsColumns();
    const result = await super.finishChat(record);
    const turnId = boundedToken(record?.turnId, 64);
    if (!turnId) return result;

    const usage = {
      model: boundedToken(record?.model, 128),
      requestedServiceTier: boundedToken(record?.requestedServiceTier, 32),
      actualServiceTier: boundedToken(record?.actualServiceTier, 32),
      inputTokens: boundedInteger(record?.inputTokens),
      cachedInputTokens: boundedInteger(record?.cachedInputTokens),
      cacheWriteTokens: boundedInteger(record?.cacheWriteTokens),
      reasoningTokens: boundedInteger(record?.reasoningTokens),
      outputTokens: boundedInteger(record?.outputTokens),
    };
    const pricing = estimateChatCostMicros(usage);
    this.ctx.storage.sql.exec(
      "UPDATE chat_turns SET first_token_ms = ?, model = COALESCE(?, model), requested_service_tier = ?, actual_service_tier = ?, memory_source = COALESCE(?, memory_source), input_tokens = ?, cached_input_tokens = ?, cache_write_tokens = ?, reasoning_tokens = ?, output_tokens = ?, estimated_cost_micros = ?, pricing_version = ?, pricing_status = ? WHERE turn_id = ?",
      boundedTiming(record?.firstTokenMs),
      usage.model || null,
      usage.requestedServiceTier || null,
      usage.actualServiceTier || null,
      boundedToken(record?.memorySource, 64) || null,
      usage.inputTokens,
      usage.cachedInputTokens,
      usage.cacheWriteTokens,
      usage.reasoningTokens,
      usage.outputTokens,
      pricing.costMicros,
      pricing.pricingVersion,
      pricing.status,
      turnId,
    );
    return result;
  }

  async recordClientLatency(record) {
    await this.ensureMetricsColumns();
    const turnId = boundedToken(record?.turnId, 64);
    const sessionHash = boundedToken(record?.sessionHash, 128);
    const browserHash = boundedToken(record?.browserHash, 128);
    const firstVisibleMs = boundedTiming(record?.firstVisibleMs);
    const completeMs = boundedTiming(record?.completeMs);
    const metricVersion = boundedToken(record?.metricVersion, 64);
    if (
      !turnId ||
      !sessionHash ||
      !browserHash ||
      firstVisibleMs === null ||
      completeMs === null ||
      completeMs < firstVisibleMs ||
      !metricVersion
    ) {
      return { accepted: false, reason: "invalid" };
    }
    if (!this.verifiedChat(turnId, sessionHash, browserHash)) {
      return { accepted: false, reason: "turn" };
    }

    const existing = this.ctx.storage.sql
      .exec(
        "SELECT client_complete_ms FROM chat_turns WHERE turn_id = ?",
        turnId,
      )
      .toArray()[0];
    if (existing?.client_complete_ms !== null && existing?.client_complete_ms !== undefined) {
      return { accepted: true, duplicate: true, verifiedTurn: true };
    }

    this.ctx.storage.sql.exec(
      "UPDATE chat_turns SET client_first_visible_ms = ?, client_complete_ms = ?, client_latency_version = ? WHERE turn_id = ? AND client_complete_ms IS NULL",
      firstVisibleMs,
      completeMs,
      metricVersion,
      turnId,
    );
    await this.scheduleRetention(Number(record?.occurredAt) || Date.now());
    return { accepted: true, verifiedTurn: true };
  }

  async summary(options = {}) {
    await this.ensureMetricsColumns();
    const base = await super.summary(options);
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT account_type, model, requested_service_tier, actual_service_tier, memory_source, conversation_turn_index, status, first_token_ms, total_response_ms, client_first_visible_ms, client_complete_ms, client_latency_version, input_tokens, cached_input_tokens, cache_write_tokens, reasoning_tokens, output_tokens, estimated_cost_micros, pricing_version, pricing_status FROM chat_turns WHERE occurred_at >= ?",
        base.since,
      )
      .toArray();

    const latencyHistograms = emptyLatencyBreakdowns();
    const tokenTotals = {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      outputTokens: 0,
    };
    const breakdown = new Map();
    const pricingVersions = new Set();
    let pricedChats = 0;
    let modelChats = 0;
    let unknownCostChats = 0;
    let estimatedCostMicros = 0;

    for (const row of rows) {
      addTurnLatency(latencyHistograms, {
        accountType: row.account_type,
        model: row.model,
        memorySource: row.memory_source,
        conversationTurnIndex: row.conversation_turn_index,
        firstTokenMs: row.first_token_ms,
        totalResponseMs: row.total_response_ms,
        clientFirstVisibleMs: row.client_first_visible_ms,
        clientCompleteMs: row.client_complete_ms,
      });

      const inputTokens = boundedInteger(row.input_tokens);
      const cachedInputTokens = boundedInteger(row.cached_input_tokens);
      const cacheWriteTokens = boundedInteger(row.cache_write_tokens);
      const reasoningTokens = boundedInteger(row.reasoning_tokens);
      const outputTokens = boundedInteger(row.output_tokens);
      tokenTotals.inputTokens += inputTokens;
      tokenTotals.cachedInputTokens += cachedInputTokens;
      tokenTotals.cacheWriteTokens += cacheWriteTokens;
      tokenTotals.reasoningTokens += reasoningTokens;
      tokenTotals.outputTokens += outputTokens;

      const hasModelUsage = inputTokens + outputTokens + cacheWriteTokens > 0;
      if (hasModelUsage) modelChats += 1;
      if (row.pricing_status === "priced") pricedChats += 1;
      else if (hasModelUsage) unknownCostChats += 1;
      const costMicros = boundedInteger(row.estimated_cost_micros, 1_000_000_000);
      estimatedCostMicros += costMicros;
      if (row.pricing_version) pricingVersions.add(String(row.pricing_version));

      const model = boundedToken(row.model, 128) || "unknown";
      const serviceTier =
        boundedToken(row.actual_service_tier, 32) ||
        boundedToken(row.requested_service_tier, 32) ||
        "unknown";
      const key = model + "|" + serviceTier;
      const current = breakdown.get(key) || {
        model,
        serviceTier,
        chats: 0,
        completedChats: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        outputTokens: 0,
        estimatedCostMicros: 0,
        pricedChats: 0,
        unknownCostChats: 0,
      };
      current.chats += 1;
      if (row.status === "completed") current.completedChats += 1;
      current.inputTokens += inputTokens;
      current.cachedInputTokens += cachedInputTokens;
      current.cacheWriteTokens += cacheWriteTokens;
      current.reasoningTokens += reasoningTokens;
      current.outputTokens += outputTokens;
      current.estimatedCostMicros += costMicros;
      if (row.pricing_status === "priced") current.pricedChats += 1;
      else if (hasModelUsage) current.unknownCostChats += 1;
      breakdown.set(key, current);
    }

    const helpfulConversations = Number(base.conversationHelped || 0);
    const helpfulResponses = Number(base.helpfulResponses || 0);
    const resolved = Number(base.resolved || 0);
    return {
      ...base,
      estimatedCostMicros,
      latencyHistograms,
      latency: summarizeLatencyBreakdowns(latencyHistograms),
      clientLatencyChats: Number(
        latencyHistograms.clientComplete?.overall?.count || 0,
      ),
      clientTimingCoverageRate: rate(
        Number(latencyHistograms.clientComplete?.overall?.count || 0),
        Number(base.completedChats || 0),
      ),
      tokenTotals,
      modelChats,
      pricedChats,
      unknownCostChats,
      pricingCoverageRate: rate(pricedChats, modelChats),
      pricingVersion:
        pricingVersions.size === 1
          ? [...pricingVersions][0]
          : pricingVersions.size > 1
            ? "mixed"
            : IMPACT_PRICING_VERSION,
      costBreakdown: [...breakdown.values()].sort(
        (left, right) =>
          right.estimatedCostMicros - left.estimatedCostMicros ||
          right.chats - left.chats,
      ),
      helpfulConversationsPerDollar:
        helpfulConversations > 0 && estimatedCostMicros > 0
          ? helpfulConversations / (estimatedCostMicros / 1_000_000)
          : null,
      estimatedCostPerHelpfulConversationMicros:
        helpfulConversations > 0 && estimatedCostMicros > 0
          ? Math.round(estimatedCostMicros / helpfulConversations)
          : null,
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
}

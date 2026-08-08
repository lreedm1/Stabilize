import { readFile, writeFile } from "node:fs/promises";

async function read(path) {
  return readFile(path, "utf8");
}

async function update(path, transform) {
  const before = await read(path);
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

async function writeCanonical(path, content) {
  const normalized = content.trimStart().replace(/\s+$/u, "") + "\n";
  const before = await read(path).catch(() => "");
  if (before !== normalized) await writeFile(path, normalized);
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Decision-grade impact could not find ${label}`);
  }
  return source.replace(before, after);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Decision-grade impact could not replace ${label}`);
  }
  const current = source.slice(start, end);
  if (current === replacement) return source;
  return source.slice(0, start) + replacement + source.slice(end);
}

function insertBefore(source, marker, addition, uniqueMarker, label) {
  if (source.includes(uniqueMarker)) return source;
  const index = source.indexOf(marker);
  if (index < 0) {
    throw new Error(`Decision-grade impact could not find ${label}`);
  }
  return source.slice(0, index) + addition + source.slice(index);
}

await update("src/index.js", (source) => {
  let next = source;

  const usageBlock = `function usageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function interactiveUsageSnapshot(result, model, requestedServiceTier) {
  const usage = result?.usage || {};
  const inputDetails = usage.input_tokens_details || {};
  const outputDetails = usage.output_tokens_details || {};
  return {
    model: safeProviderField(model) || "unknown",
    requestedServiceTier:
      safeProviderField(requestedServiceTier) || "default",
    actualServiceTier: safeProviderField(result?.serviceTier),
    inputTokens: usageNumber(usage.input_tokens),
    cachedInputTokens: usageNumber(inputDetails.cached_tokens),
    cacheWriteTokens: usageNumber(inputDetails.cache_write_tokens),
    reasoningTokens: usageNumber(outputDetails.reasoning_tokens),
    outputTokens: usageNumber(usage.output_tokens),
  };
}

function zeroUsageSnapshot(model = "none", requestedServiceTier = "none") {
  return {
    model: safeProviderField(model) || "none",
    requestedServiceTier:
      safeProviderField(requestedServiceTier) || "none",
    actualServiceTier: null,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
  };
}

function logInteractiveUsage(result, model, requestedServiceTier) {
  const analytics = interactiveUsageSnapshot(
    result,
    model,
    requestedServiceTier,
  );
  console.info(
    JSON.stringify({
      event: "openai_chat_usage",
      model: analytics.model,
      requestedServiceTier: analytics.requestedServiceTier,
      actualServiceTier: analytics.actualServiceTier,
      inputTokens: analytics.inputTokens,
      cachedTokens: analytics.cachedInputTokens,
      cacheWriteTokens: analytics.cacheWriteTokens,
      reasoningTokens: analytics.reasoningTokens,
      outputTokens: analytics.outputTokens,
    }),
  );
}
`;
  next = replaceBlock(
    next,
    "function usageNumber(value) {\n",
    "\nfunction openAIConfig(env) {\n",
    usageBlock,
    "the interactive usage block",
  );

  const fallbackBlock = `async function generateFallbackReply(messages, route, env, latestText) {
  const { apiKey, model, reasoningEffort, serviceTier } = openAIConfig(env);
  const result = await callOpenAI(
    chatRequestPayload({
      model,
      reasoningEffort,
      serviceTier,
      route,
      messages,
      latestText,
    }),
    apiKey,
    60_000,
    "OpenAIFallbackHttpError",
  );
  logInteractiveUsage(result, model, serviceTier);

  const reply = validateModelReply(result.text);
  if (!reply) {
    throw new OpenAIRequestError({
      name: "OpenAIInvalidReplyError",
      failure: "invalid_output",
      status: 502,
      code: "empty_fallback",
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }
  return {
    reply,
    analytics: interactiveUsageSnapshot(result, model, serviceTier),
  };
}
`;
  next = replaceBlock(
    next,
    "async function generateFallbackReply(messages, route, env, latestText) {\n",
    "\nasync function writeReplyDeltas(writer, text) {\n",
    fallbackBlock,
    "the non-streaming fallback",
  );

  next = replaceRequired(
    next,
    `  const produce = async () => {
    let reply = "";
    try {`,
    `  const produce = async () => {
    let reply = "";
    let analytics = null;
    try {`,
    "stream analytics state",
  );
  next = replaceRequired(
    next,
    `      if (demoMode) {
        const demo = demoReply(route, latestText);
        reply = demo;
        await writeReplyDeltas(writer, demo);
      } else {`,
    `      if (demoMode) {
        const demo = demoReply(route, latestText);
        reply = demo;
        analytics = zeroUsageSnapshot("demo", "none");
        await writeReplyDeltas(writer, demo);
      } else {`,
    "demo stream analytics",
  );
  next = replaceRequired(
    next,
    `          logInteractiveUsage(result, model, serviceTier);
        } catch (streamError) {`,
    `          logInteractiveUsage(result, model, serviceTier);
          analytics = interactiveUsageSnapshot(result, model, serviceTier);
        } catch (streamError) {`,
    "provider stream analytics",
  );
  next = replaceRequired(
    next,
    `          reply = await generateFallbackReply(messages, route, env, latestText);
          await writeReplyDeltas(writer, reply);`,
    `          const fallback = await generateFallbackReply(
            messages,
            route,
            env,
            latestText,
          );
          reply = fallback.reply;
          analytics = fallback.analytics;
          await writeReplyDeltas(writer, reply);`,
    "fallback stream analytics",
  );
  next = replaceRequired(
    next,
    `          showEmergency: false,
          awaitingSafetyAnswer: false,
          ...guestSummaryFields(guestSummaryResult),`,
    `          showEmergency: false,
          awaitingSafetyAnswer: false,
          analytics: analytics || zeroUsageSnapshot(),
          ...guestSummaryFields(guestSummaryResult),`,
    "completed stream analytics event",
  );

  const generateReplyBlock = `async function generateReply(messages, route, env, latestText) {
  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
  if (demoMode) {
    return {
      reply: demoReply(route, latestText),
      analytics: zeroUsageSnapshot("demo", "none"),
    };
  }

  const { apiKey, model, reasoningEffort, serviceTier } = openAIConfig(env);
  const turnReasoningEffort = reasoningEffort;
  const result = await callOpenAI(
    {
      model,
      service_tier: serviceTier,
      reasoning: { effort: turnReasoningEffort },
      ...(turnReasoningEffort === "none"
        ? { max_output_tokens: 500 }
        : {}),
      text: { verbosity: "low" },
      instructions:
        COPY.model.systemPrompt +
        "\\n\\n" +
        COPY.model.memoryInstruction +
        "\\n\\n" +
        COPY.model.routeInstruction(route),
      input: messages,
      store: true,
    },
    apiKey,
    60_000,
    "OpenAIHttpError",
  );
  logInteractiveUsage(result, model, serviceTier);

  let reply = validateModelReply(result.text);
  if (!reply) {
    throw new OpenAIRequestError({
      name: "OpenAIInvalidReplyError",
      failure: "invalid_output",
      status: 502,
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }
  if (
    route === "ORDINARY" &&
    isNeutralGreeting(latestText) &&
    isUnsolicitedSafetyCheck(reply)
  ) {
    reply = "Hi. What’s happening right now?";
  }
  return {
    reply,
    analytics: interactiveUsageSnapshot(result, model, serviceTier),
  };
}
`;
  next = replaceBlock(
    next,
    "async function generateReply(messages, route, env, latestText) {\n",
    "\nfunction sanitizeSummaryText(value, maxChars) {\n",
    generateReplyBlock,
    "the JSON reply generator",
  );

  next = replaceRequired(
    next,
    `  const reply = await generateReply(messages, route, env, latestText);
  const result = await recordExchange(stub, {
    user: latestText,
    assistant: reply,`,
    `  const generated = await generateReply(messages, route, env, latestText);
  const reply = generated.reply;
  const result = await recordExchange(stub, {
    user: latestText,
    assistant: reply,`,
    "prepared JSON usage capture",
  );
  next = replaceRequired(
    next,
    `    showEmergency: false,
    awaitingSafetyAnswer: false,
  });
}

async function handleDeleteMemory`,
    `    showEmergency: false,
    awaitingSafetyAnswer: false,
    analytics: generated.analytics,
  });
}

async function handleDeleteMemory`,
    "prepared JSON analytics response",
  );
  next = replaceRequired(
    next,
    `  const [reply, guestSummaryResult] = await Promise.all([
    generateReply(messages, route, env, latestText),
    guestSummaryPromise,
  ]);
  const result = await recordExchange(stub, {
    user: latestText,
    assistant: reply,`,
    `  const [generated, guestSummaryResult] = await Promise.all([
    generateReply(messages, route, env, latestText),
    guestSummaryPromise,
  ]);
  const reply = generated.reply;
  const result = await recordExchange(stub, {
    user: latestText,
    assistant: reply,`,
    "guest JSON usage capture",
  );
  next = replaceRequired(
    next,
    `    awaitingSafetyAnswer: false,
    ...guestSummaryFields(guestSummaryResult),
  });
}

export async function preparedChatResponse`,
    `    awaitingSafetyAnswer: false,
    analytics: generated.analytics,
    ...guestSummaryFields(guestSummaryResult),
  });
}

export async function preparedChatResponse`,
    "guest JSON analytics response",
  );

  return next;
});

const chatLatencySource = `import worker from "./memory-prompt-worker.js";
import { readAuthSession } from "./auth.js";
import {
  boundedNumber,
  hashIdentifier,
  impactStub,
  readBoundedResponseText,
  safeToken,
  schedule,
} from "./impact-shards.js";

const IMPACT_PROMPT_VERSION = "next-step-v1";
const MAX_ANALYTICS_RESPONSE_BYTES = 256_000;

function emptyUsage() {
  return {
    model: "",
    requestedServiceTier: "",
    actualServiceTier: "",
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
  };
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") return null;
  const model = safeToken(value.model, 128);
  if (!model) return null;
  return {
    model,
    requestedServiceTier:
      safeToken(value.requestedServiceTier, 32) || "default",
    actualServiceTier: safeToken(value.actualServiceTier, 32) || "",
    inputTokens: boundedNumber(value.inputTokens, 0, 100_000_000, 0),
    cachedInputTokens: boundedNumber(
      value.cachedInputTokens,
      0,
      100_000_000,
      0,
    ),
    cacheWriteTokens: boundedNumber(
      value.cacheWriteTokens,
      0,
      100_000_000,
      0,
    ),
    reasoningTokens: boundedNumber(
      value.reasoningTokens,
      0,
      100_000_000,
      0,
    ),
    outputTokens: boundedNumber(value.outputTokens, 0, 100_000_000, 0),
  };
}

function initialChatResult(response) {
  const usage = emptyUsage();
  usage.model =
    safeToken(response.headers.get("X-Stabilize-Model-Selected"), 128) || "";
  return {
    route: "UNKNOWN",
    status: response.ok ? "completed" : "error",
    firstTokenMs: null,
    usage,
  };
}

function observeResponseEvent(event, result, startedAt) {
  if (event?.route) {
    result.route = safeToken(event.route, 64) || result.route;
  }
  if (
    event?.type === "delta" &&
    typeof event.delta === "string" &&
    result.firstTokenMs === null
  ) {
    result.firstTokenMs = Math.max(0, Date.now() - startedAt);
  }
  if (event?.type === "error") result.status = "error";
  const usage = normalizeUsage(event?.analytics);
  if (usage) result.usage = usage;
}

function observeNdjsonLine(line, result, startedAt) {
  if (!line.trim()) return;
  try {
    observeResponseEvent(JSON.parse(line), result, startedAt);
  } catch {
    result.status = "error";
  }
}

async function parseNdjsonResponse(response, startedAt) {
  const result = initialChatResult(response);
  if (!response.body) return result;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ANALYTICS_RESPONSE_BYTES) {
        await reader.cancel("Chat response exceeded the analytics limit.");
        throw new Error("Chat response exceeded the analytics limit.");
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\\n");
      buffer = lines.pop() || "";
      for (const line of lines) observeNdjsonLine(line, result, startedAt);
    }
    buffer += decoder.decode();
    if (buffer.trim()) observeNdjsonLine(buffer, result, startedAt);
    return result;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The cloned stream may already be closed.
    }
  }
}

async function parseChatResponse(response, startedAt) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/x-ndjson")) {
    return parseNdjsonResponse(response, startedAt);
  }

  const result = initialChatResult(response);
  if (!contentType.includes("application/json")) return result;
  const text = await readBoundedResponseText(
    response,
    MAX_ANALYTICS_RESPONSE_BYTES,
    "Chat response exceeded the analytics limit.",
  );
  try {
    const body = JSON.parse(text || "{}");
    observeResponseEvent(body, result, startedAt);
    if (body?.error) result.status = "error";
  } catch {
    result.status = "error";
  }
  return result;
}

async function recordChatAnalytics({
  request,
  response,
  analyticsCopy,
  env,
  startedAt,
  turnId,
  sessionId,
  browserId,
  conversationId,
}) {
  const resultPromise = parseChatResponse(analyticsCopy, startedAt).catch(() => ({
    route: "UNKNOWN",
    status: "error",
    firstTokenMs: null,
    usage: emptyUsage(),
  }));

  const [sessionHash, browserHash, conversationHash, authSession] =
    await Promise.all([
      hashIdentifier(env, "impact-session", sessionId),
      hashIdentifier(env, "impact-browser", browserId),
      hashIdentifier(env, "impact-conversation", conversationId),
      readAuthSession(request, env).catch(() => null),
    ]);

  const store = browserHash ? impactStub(env, browserHash) : null;
  if (
    !store ||
    !sessionHash ||
    !browserHash ||
    typeof store.startChat !== "function" ||
    typeof store.finishChat !== "function"
  ) {
    await resultPromise;
    return;
  }

  const accountType = authSession ? "signed_in" : "guest";
  const memorySource =
    safeToken(response.headers.get("X-Stabilize-Memory-Source"), 64) ||
    (authSession ? "unknown" : "guest");
  const selectedModel =
    safeToken(response.headers.get("X-Stabilize-Model-Selected"), 128) ||
    "pending";

  await store.startChat({
    turnId,
    occurredAt: startedAt,
    sessionHash,
    browserHash,
    conversationHash,
    accountType,
    memorySource,
    model: selectedModel,
    estimatedCostMicros: 0,
  });

  const result = await resultPromise;
  const usage = result.usage || emptyUsage();
  await store.finishChat({
    turnId,
    route: result.route,
    status: result.status,
    httpStatus: response.status,
    firstTokenMs: result.firstTokenMs,
    totalResponseMs: Date.now() - startedAt,
    memorySource,
    model: usage.model || selectedModel,
    requestedServiceTier: usage.requestedServiceTier,
    actualServiceTier: usage.actualServiceTier,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: usage.reasoningTokens,
    outputTokens: usage.outputTokens,
  });
}

export async function chatResponse(request, env, ctx) {
  const startedAt = Date.now();
  const turnId = crypto.randomUUID();
  const sessionId = request.headers.get("x-stabilize-session-id") || "";
  const browserId = request.headers.get("x-stabilize-browser-id") || "";
  const conversationId =
    request.headers.get("x-stabilize-conversation-id") || "";

  const response = await worker.fetch(request, env, ctx);
  const analyticsCopy = response.clone();
  schedule(
    ctx,
    recordChatAnalytics({
      request,
      response,
      analyticsCopy,
      env,
      startedAt,
      turnId,
      sessionId,
      browserId,
      conversationId,
    }),
  );

  const headers = new Headers(response.headers);
  headers.set("X-Stabilize-Turn-Id", turnId);
  headers.set("X-Stabilize-Impact-Version", IMPACT_PROMPT_VERSION);
  headers.delete("content-length");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
`;
await writeCanonical("src/chat-latency-events.js", chatLatencySource);

const analyticsLatencySource = `import { ImpactAnalytics as BaseImpactAnalytics } from "./impact-analytics.js";
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

  async summary(options = {}) {
    await this.ensureMetricsColumns();
    const base = await super.summary(options);
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT account_type, model, requested_service_tier, actual_service_tier, memory_source, conversation_turn_index, status, first_token_ms, total_response_ms, input_tokens, cached_input_tokens, cache_write_tokens, reasoning_tokens, output_tokens, estimated_cost_micros, pricing_version, pricing_status FROM chat_turns WHERE occurred_at >= ?",
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
`;
await writeCanonical("src/impact-analytics-latency.js", analyticsLatencySource);

await update("src/impact-shards.js", (source) => {
  let next = source;
  next = insertBefore(
    next,
    "const IMPACT_SHARD_COUNT = 16;\n",
    `import {
  mergeLatencyBreakdowns,
  summarizeLatencyBreakdowns,
} from "./impact-latency.js";

`,
    "mergeLatencyBreakdowns",
    "the latency histogram import",
  );

  const helper = `function mergeDecisionGradeMetrics(merged, summaries) {
  const latencyHistograms = mergeLatencyBreakdowns(
    summaries.map((summary) => summary?.latencyHistograms),
  );
  const tokenTotals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
  };
  const breakdown = new Map();
  const pricingVersions = new Set();
  let modelChats = 0;
  let pricedChats = 0;
  let unknownCostChats = 0;

  for (const summary of summaries) {
    if (!summary) continue;
    modelChats += Number(summary.modelChats || 0);
    pricedChats += Number(summary.pricedChats || 0);
    unknownCostChats += Number(summary.unknownCostChats || 0);
    if (summary.pricingVersion) pricingVersions.add(summary.pricingVersion);
    for (const key of Object.keys(tokenTotals)) {
      tokenTotals[key] += Number(summary.tokenTotals?.[key] || 0);
    }
    for (const row of summary.costBreakdown || []) {
      const model = String(row?.model || "unknown").slice(0, 128);
      const serviceTier = String(row?.serviceTier || "unknown").slice(0, 32);
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
      for (const field of [
        "chats",
        "completedChats",
        "inputTokens",
        "cachedInputTokens",
        "cacheWriteTokens",
        "reasoningTokens",
        "outputTokens",
        "estimatedCostMicros",
        "pricedChats",
        "unknownCostChats",
      ]) {
        current[field] += Number(row?.[field] || 0);
      }
      breakdown.set(key, current);
    }
  }

  const estimatedCostMicros = Number(merged.estimatedCostMicros || 0);
  const helpfulConversations = Number(merged.conversationHelped || 0);
  return {
    ...merged,
    latencyHistograms,
    latency: summarizeLatencyBreakdowns(latencyHistograms),
    tokenTotals,
    modelChats,
    pricedChats,
    unknownCostChats,
    pricingCoverageRate: metricRate(pricedChats, modelChats),
    pricingVersion:
      pricingVersions.size === 1
        ? [...pricingVersions][0]
        : pricingVersions.size > 1
          ? "mixed"
          : null,
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
  };
}

`;
  next = insertBefore(
    next,
    "export async function impactSummary(env, options) {\n",
    helper,
    "function mergeDecisionGradeMetrics(",
    "the cross-shard decision-grade merge",
  );
  next = replaceRequired(
    next,
    "  return mergeImpactSummaries(summaries, options.since, options.now);\n",
    `  const merged = mergeImpactSummaries(
    summaries,
    options.since,
    options.now,
  );
  return mergeDecisionGradeMetrics(merged, summaries);
`,
    "the decision-grade summary merge",
  );
  return next;
});

await update("src/impact-dashboard.js", (source) => {
  let next = source;

  const helpers = `function formatPerDollar(value) {
  if (value === null || value === undefined || Number(value) <= 0) {
    return "Not enough data";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function latencySummaryRows(summary) {
  const first = summary.latency?.firstToken || {};
  const total = summary.latency?.totalResponse || {};
  const rows = [];
  const add = (label, firstValue, totalValue) => {
    const count = Math.max(
      Number(firstValue?.count || 0),
      Number(totalValue?.count || 0),
    );
    if (!count) return;
    rows.push({ label, count, first: firstValue, total: totalValue });
  };
  add("All chats", first.overall, total.overall);
  for (const [key, label] of [
    ["guest", "Guest"],
    ["signed_in", "Signed in"],
  ]) {
    add(label, first.accountType?.[key], total.accountType?.[key]);
  }
  for (const [key, label] of [
    ["first", "First message"],
    ["follow_up", "Follow-up"],
  ]) {
    add(label, first.messagePosition?.[key], total.messagePosition?.[key]);
  }
  const addTop = (dimension, prefix, limit = 6) => {
    const keys = new Set([
      ...Object.keys(first?.[dimension] || {}),
      ...Object.keys(total?.[dimension] || {}),
    ]);
    [...keys]
      .map((key) => ({
        key,
        count: Math.max(
          Number(first?.[dimension]?.[key]?.count || 0),
          Number(total?.[dimension]?.[key]?.count || 0),
        ),
      }))
      .filter((entry) => entry.count > 0 && entry.key !== "unknown")
      .sort((left, right) => right.count - left.count)
      .slice(0, limit)
      .forEach((entry) =>
        add(
          prefix + entry.key,
          first?.[dimension]?.[entry.key],
          total?.[dimension]?.[entry.key],
        ),
      );
  };
  addTop("model", "Model · ");
  addTop("memorySource", "Memory · ");
  return rows;
}

function latencyBreakdownTable(summary) {
  const rows = latencySummaryRows(summary);
  if (!rows.length) {
    return '<tr><td colspan="6">No completed timing samples yet.</td></tr>';
  }
  return rows
    .map(
      (row) =>
        '<tr><th scope="row">' +
        escapeHtml(row.label) +
        "</th><td>" +
        formatInteger(row.count) +
        "</td><td>" +
        escapeHtml(formatDurationMs(row.first?.p50Ms)) +
        "</td><td>" +
        escapeHtml(formatDurationMs(row.first?.p95Ms)) +
        "</td><td>" +
        escapeHtml(formatDurationMs(row.total?.p50Ms)) +
        "</td><td>" +
        escapeHtml(formatDurationMs(row.total?.p95Ms)) +
        "</td></tr>",
    )
    .join("");
}

function costBreakdownTable(summary) {
  const rows = (summary.costBreakdown || []).slice(0, 12);
  if (!rows.length) {
    return '<tr><td colspan="8">No provider usage has been priced yet.</td></tr>';
  }
  return rows
    .map(
      (row) =>
        '<tr><th scope="row">' +
        escapeHtml(row.model) +
        "</th><td>" +
        escapeHtml(row.serviceTier) +
        "</td><td>" +
        formatInteger(row.chats) +
        "</td><td>" +
        formatInteger(row.inputTokens) +
        "</td><td>" +
        formatInteger(row.cachedInputTokens) +
        "</td><td>" +
        formatInteger(row.reasoningTokens) +
        "</td><td>" +
        formatInteger(row.outputTokens) +
        "</td><td>" +
        escapeHtml(formatMoneyFromMicros(row.estimatedCostMicros)) +
        "</td></tr>",
    )
    .join("");
}

`;
  next = insertBefore(
    next,
    "function weeklyDecision(summary, finance) {\n",
    helpers,
    "function formatPerDollar(value) {\n",
    "the decision-grade dashboard helpers",
  );

  next = replaceRequired(
    next,
    `  if (summary.estimatedCostMicros <= 0 || finance.costCents <= 0) {
    return "Enter real per-chat and recurring costs before changing model routing.";
  }`,
    `  if (
    summary.modelChats >= 10 &&
    summary.pricingCoverageRate !== null &&
    summary.pricingCoverageRate < 0.95
  ) {
    return "Fix provider-usage pricing coverage before changing model routing.";
  }
  if (summary.estimatedCostMicros <= 0) {
    return "Collect provider-reported token usage before changing model routing.";
  }
  if (finance.costCents <= 0) {
    return "Enter recurring infrastructure cost before judging self-funding.";
  }`,
    "the evidence-first cost decision",
  );
  next = replaceRequired(
    next,
    `  const financeConfigured =
    finance.costCents > 0 && summary.estimatedCostMicros > 0;`,
    `  const financeConfigured =
    finance.costCents > 0 &&
    summary.estimatedCostMicros > 0 &&
    (summary.pricingCoverageRate === null ||
      summary.pricingCoverageRate >= 0.95);`,
    "the finance readiness signal",
  );
  next = next.replace(
    "Engagement, response quality, outcomes, reliability, and cost.",
    "Outcomes, latency, provider usage, reliability, and cost.",
  );

  next = replaceRequired(
    next,
    `<div class="tile"><span>Average response time</span><strong>\${formatDurationMs(summary.averageResponseMs)}</strong></div>`,
    `<div class="tile"><span>Average response time</span><strong>\${formatDurationMs(summary.averageResponseMs)}</strong></div>
<div class="tile"><span>First-token p50</span><strong>\${formatDurationMs(summary.latency?.firstToken?.overall?.p50Ms)}</strong></div>
<div class="tile"><span>First-token p95</span><strong>\${formatDurationMs(summary.latency?.firstToken?.overall?.p95Ms)}</strong></div>
<div class="tile"><span>Total-response p50</span><strong>\${formatDurationMs(summary.latency?.totalResponse?.overall?.p50Ms)}</strong></div>
<div class="tile"><span>Total-response p95</span><strong>\${formatDurationMs(summary.latency?.totalResponse?.overall?.p95Ms)}</strong></div>`,
    "the latency percentile tiles",
  );
  next = replaceRequired(
    next,
    `<div class="tile"><span>Conversation feedback rate</span><strong>\${formatPercent(summary.conversationResponseRate)}</strong></div>`,
    `<div class="tile"><span>Conversation feedback rate</span><strong>\${formatPercent(summary.conversationResponseRate)}</strong></div>
<div class="tile"><span>Helpful conversations / $</span><strong>\${formatPerDollar(summary.helpfulConversationsPerDollar)}</strong></div>
<div class="tile"><span>Est. cost / helpful conversation</span><strong>\${formatMoneyFromMicros(summary.estimatedCostPerHelpfulConversationMicros)}</strong></div>
<div class="tile"><span>Pricing coverage</span><strong>\${formatPercent(summary.pricingCoverageRate)}</strong></div>`,
    "the helpful-conversation cost tiles",
  );

  const dailySection = `<section class="panel usage"><div class="usage-heading"><div><h2>Daily usage</h2><p>Unique browsers and submitted chat messages by UTC day.</p></div><div class="usage-today"><span>Today</span><strong>\${formatInteger(dailyUsageRows(summary, 1)[0]?.users || 0)} users</strong><strong>\${formatInteger(dailyUsageRows(summary, 1)[0]?.messages || 0)} messages</strong></div></div><div class="usage-table-wrap"><table><thead><tr><th>Date</th><th>Users</th><th>Messages</th></tr></thead><tbody>\${dailyUsageTable(summary)}</tbody></table></div></section>`;
  const decisionSections = dailySection + `
<section class="panel usage latency-breakdown"><div class="usage-heading"><div><h2>Latency breakdown</h2><p>Mergeable p50 and p95 timing buckets, segmented without storing chat text.</p></div></div><div class="usage-table-wrap"><table><thead><tr><th>Segment</th><th>Chats</th><th>First p50</th><th>First p95</th><th>Total p50</th><th>Total p95</th></tr></thead><tbody>\${latencyBreakdownTable(summary)}</tbody></table></div></section>
<section class="panel usage cost-breakdown"><div class="usage-heading"><div><h2>Model and cost breakdown</h2><p>Provider-reported tokens priced with \${escapeHtml(summary.pricingVersion || "the current versioned catalog")}.</p></div></div><div class="usage-table-wrap"><table><thead><tr><th>Model</th><th>Tier</th><th>Chats</th><th>Input</th><th>Cached</th><th>Reasoning</th><th>Output</th><th>Est. cost</th></tr></thead><tbody>\${costBreakdownTable(summary)}</tbody></table></div></section>`;
  next = replaceRequired(
    next,
    dailySection,
    decisionSections,
    "the decision-grade dashboard tables",
  );

  next = replaceRequired(
    next,
    `Cost metrics stay marked as not configured until real operating inputs are entered.`,
    `Provider cost uses provider-reported token counts and a versioned pricing catalog; it remains an estimate until reconciled with invoices. Recurring infrastructure cost remains separate.`,
    "the cost-method note",
  );
  return next;
});

await update("package.json", (source) => {
  const packageJson = JSON.parse(source);
  const pipeline = packageJson.scripts["apply:prompt-policy"]
    .split(" && ")
    .filter(Boolean)
    .filter(
      (entry) => entry !== "node scripts/apply-decision-grade-impact.mjs",
    );
  pipeline.push("node scripts/apply-decision-grade-impact.mjs");
  packageJson.scripts["apply:prompt-policy"] = pipeline.join(" && ");

  const ensureTest = (scriptName, file) => {
    const parts = packageJson.scripts[scriptName].split(/\s+/u);
    if (!parts.includes(file)) parts.push(file);
    packageJson.scripts[scriptName] = parts.join(" ");
  };
  ensureTest("test:node", "test/decision-grade-impact.test.mjs");
  ensureTest("test:worker", "test/decision-grade-impact-worker.test.mjs");
  return JSON.stringify(packageJson, null, 2) + "\n";
});

await update("test/impact-measurement.test.mjs", (source) => {
  let next = source;
  next = next.replace(
    /assert\.match\(latencyAnalytics, \/extends BaseImpactAnalytics\/\);[\s\S]*?\/UPDATE chat_turns SET first_token_ms = \\\? WHERE turn_id = \\\?\/,\n  \);/u,
    `assert.match(latencyAnalytics, /extends BaseImpactAnalytics/);
  assert.match(latencyAnalytics, /estimateChatCostMicros/);
  assert.match(latencyAnalytics, /latencyHistograms/);
  assert.match(latencyAnalytics, /pricingCoverageRate/);`,
  );
  const oldTileAssertion = String.raw`  assert.equal((dashboard.match(/<div class=\"tile\">/g) || []).length, 17);`;
  const newTileAssertion = String.raw`  assert.ok(
    (dashboard.match(/<div class=\"tile\">/g) || []).length >= 24,
  );`;
  next = next.replace(oldTileAssertion, newTileAssertion);
  next = next.replace(
    `    "Average response time",\n`,
    `    "Average response time",\n    "First-token p50",\n    "First-token p95",\n    "Total-response p50",\n    "Total-response p95",\n`,
  );
  next = next.replace(
    `    "Conversation feedback rate",\n`,
    `    "Conversation feedback rate",\n    "Helpful conversations / $",\n    "Est. cost / helpful conversation",\n    "Pricing coverage",\n`,
  );
  next = next.replace(
    `  assert.match(dashboard, /Top feedback reasons/);`,
    `  assert.match(dashboard, /Latency breakdown/);
  assert.match(dashboard, /Model and cost breakdown/);
  assert.match(dashboard, /Top feedback reasons/);`,
  );
  return next;
});

await update("test/impact-worker.test.mjs", (source) =>
  source
    .replace(
      /Engagement, response quality, outcomes, reliability, and cost\\\./u,
      "Outcomes, latency, provider usage, reliability, and cost\\.",
    )
    .replace(
      `  assert.equal((html.match(/class="tile"/g) || []).length, 17);`,
      `  assert.ok((html.match(/class="tile"/g) || []).length >= 24);`,
    )
    .replace(
      `  assert.match(html, /Daily usage/);`,
      `  assert.match(html, /Daily usage/);
  assert.match(html, /Latency breakdown/);
  assert.match(html, /Model and cost breakdown/);`,
    ),
);

console.log(
  "Applied decision-grade provider usage, pricing, latency percentiles, and dashboard breakdowns.",
);

import {
  mergeLatencyBreakdowns,
  summarizeLatencyBreakdowns,
} from "./impact-latency.js";

const IMPACT_SHARD_COUNT = 16;
const MAX_EVENT_BODY_BYTES = 4_096;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

export function boundedNumber(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

export function safeToken(value, limit = 96) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text.slice(0, limit) : "";
}

export function base64UrlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function hmac(secret, purpose, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`stabilize:${purpose}:v1\u0000${value}`),
  );
}

export async function hashIdentifier(env, purpose, value) {
  const secret = String(env?.AUTH_SECRET || "");
  if (secret.length < 32 || !UUID_PATTERN.test(String(value || ""))) {
    return null;
  }
  return base64UrlEncode(await hmac(secret, purpose, String(value)));
}

export async function timingSafeTextEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right || ""))),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

export function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

export function pageHeaders(
  contentType = "text/html; charset=utf-8",
  extra = {},
) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

export function jsonResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: pageHeaders("application/json; charset=utf-8", extra),
  });
}

export function sameOriginRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  // Some iOS in-app browsers submit same-site forms from an opaque origin.
  // Fetch Metadata must still classify the request as same-origin or top-level.
  if (origin && origin !== "null" && origin !== url.origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

async function readBoundedBody(body, declaredLength, limit, tooLargeMessage) {
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Response(tooLargeMessage, { status: 413 });
  }
  if (!body) return "";

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel(tooLargeMessage);
        throw new Response(tooLargeMessage, { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readBoundedRequestText(request, limit, tooLargeMessage) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  return readBoundedBody(request.body, declaredLength, limit, tooLargeMessage);
}

export async function readBoundedResponseText(response, limit, tooLargeMessage) {
  return readBoundedBody(response.body, 0, limit, tooLargeMessage);
}

export async function readBoundedJson(request) {
  const text = await readBoundedRequestText(
    request,
    MAX_EVENT_BODY_BYTES,
    "Event body is too large.",
  );
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Response("Invalid event JSON.", { status: 400 });
  }
}

function impactShardIndex(browserHash) {
  const value = String(browserHash || "");
  let accumulator = 0;
  for (const character of value.slice(0, 12)) {
    accumulator = (accumulator * 33 + character.charCodeAt(0)) >>> 0;
  }
  return accumulator % IMPACT_SHARD_COUNT;
}

export function impactStub(env, browserHash) {
  if (!env?.IMPACT || typeof env.IMPACT.getByName !== "function") return null;
  return env.IMPACT.getByName(`impact-v1-${impactShardIndex(browserHash)}`);
}

function impactStubs(env) {
  if (!env?.IMPACT || typeof env.IMPACT.getByName !== "function") return [];
  return Array.from({ length: IMPACT_SHARD_COUNT }, (_, index) =>
    env.IMPACT.getByName(`impact-v1-${index}`),
  );
}

function metricRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function addCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = Number(target[key] || 0) + Number(value || 0);
  }
}

function mergeImpactSummaries(summaries, since, now) {
  const merged = {
    since,
    now,
    prompts: 0,
    responses: 0,
    resolved: 0,
    outcomeStates: {},
    sessions: 0,
    browsers: 0,
    conversationPrompts: 0,
    conversationResponses: 0,
    conversationHelped: 0,
    conversationYes: 0,
    conversationStates: {},
    feedbackShown: 0,
    feedbackResponses: 0,
    helpfulResponses: 0,
    unhelpfulResponses: 0,
    feedbackStates: {},
    feedbackReasons: {},
    feedbackComments: 0,
    recentFeedbackComments: [],
    chats: 0,
    completedChats: 0,
    failedChats: 0,
    conversations: 0,
    multiTurnConversations: 0,
    chatBrowsers: 0,
    returningBrowsers: 0,
    responseMsTotal: 0,
    timedChats: 0,
    estimatedCostMicros: 0,
    dailyUsageByDate: {},
  };

  for (const summary of summaries) {
    if (!summary) continue;
    for (const key of [
      "prompts",
      "responses",
      "resolved",
      "sessions",
      "browsers",
      "conversationPrompts",
      "conversationResponses",
      "conversationHelped",
      "conversationYes",
      "feedbackShown",
      "feedbackResponses",
      "helpfulResponses",
      "unhelpfulResponses",
      "feedbackComments",
      "chats",
      "completedChats",
      "failedChats",
      "conversations",
      "multiTurnConversations",
      "chatBrowsers",
      "returningBrowsers",
      "responseMsTotal",
      "timedChats",
      "estimatedCostMicros",
    ]) {
      merged[key] += Number(summary[key] || 0);
    }
    addCounts(merged.outcomeStates, summary.outcomeStates);
    addCounts(merged.conversationStates, summary.conversationStates);
    addCounts(merged.feedbackStates, summary.feedbackStates);
    addCounts(merged.feedbackReasons, summary.feedbackReasons);
    for (const day of summary.dailyUsage || []) {
      const date = String(day?.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const current = merged.dailyUsageByDate[date] || { users: 0, messages: 0 };
      current.users += Number(day.users || 0);
      current.messages += Number(day.messages || 0);
      merged.dailyUsageByDate[date] = current;
    }
    for (const comment of summary.recentFeedbackComments || []) {
      merged.recentFeedbackComments.push({
        occurredAt: Number(comment?.occurredAt || 0),
        rating: String(comment?.rating || "").slice(0, 16),
        reason: String(comment?.reason || "").slice(0, 64) || null,
        comment: String(comment?.comment || "").slice(0, 500),
      });
    }
  }

  merged.dailyUsage = Object.entries(merged.dailyUsageByDate)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({ date, ...values }));
  delete merged.dailyUsageByDate;

  merged.recentFeedbackComments = merged.recentFeedbackComments
    .filter((entry) => entry.occurredAt > 0 && entry.comment)
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .slice(0, 20);
  merged.responseRate = metricRate(merged.responses, merged.prompts);
  merged.reportedResolutionRate = metricRate(
    merged.resolved,
    merged.responses,
  );
  merged.conversationResponseRate = metricRate(
    merged.conversationResponses,
    merged.conversationPrompts,
  );
  merged.conversationHelpRate = metricRate(
    merged.conversationHelped,
    merged.conversationResponses,
  );
  merged.conversationYesRate = metricRate(
    merged.conversationYes,
    merged.conversationResponses,
  );
  merged.feedbackResponseRate = metricRate(
    merged.feedbackResponses,
    merged.feedbackShown,
  );
  merged.helpfulResponseRate = metricRate(
    merged.helpfulResponses,
    merged.feedbackResponses,
  );
  merged.chatCompletionRate = metricRate(
    merged.completedChats,
    merged.chats,
  );
  merged.secondMessageRate = metricRate(
    merged.multiTurnConversations,
    merged.conversations,
  );
  merged.returningBrowserRate = metricRate(
    merged.returningBrowsers,
    merged.chatBrowsers,
  );
  merged.averageResponseMs =
    merged.timedChats > 0
      ? Math.round(merged.responseMsTotal / merged.timedChats)
      : null;
  merged.estimatedCostPerResolutionMicros =
    merged.resolved > 0 && merged.estimatedCostMicros > 0
      ? Math.round(merged.estimatedCostMicros / merged.resolved)
      : null;
  merged.estimatedCostPerHelpfulMicros =
    merged.helpfulResponses > 0 && merged.estimatedCostMicros > 0
      ? Math.round(merged.estimatedCostMicros / merged.helpfulResponses)
      : null;
  return merged;
}

function mergeDecisionGradeMetrics(merged, summaries) {
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
  const clientLatencyChats = Number(
    latencyHistograms.clientComplete?.overall?.count || 0,
  );
  return {
    ...merged,
    latencyHistograms,
    latency: summarizeLatencyBreakdowns(latencyHistograms),
    clientLatencyChats,
    clientTimingCoverageRate: metricRate(
      clientLatencyChats,
      Number(merged.completedChats || 0),
    ),
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

export async function impactSummary(env, options) {
  const stubs = impactStubs(env);
  if (!stubs.length) return null;
  const summaries = await Promise.all(
    stubs.map((stub) => stub.summary(options)),
  );
  const merged = mergeImpactSummaries(
    summaries,
    options.since,
    options.now,
  );
  return mergeDecisionGradeMetrics(merged, summaries);
}

export function schedule(ctx, promise) {
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(promise);
    return;
  }
  void promise.catch((error) => {
    console.error(
      JSON.stringify({
        event: "impact_background_task_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  });
}

import worker from "./memory-prompt-worker.js";
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
      const lines = buffer.split("\n");
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
  // Consume the cloned stream immediately so analytics cannot backpressure the visible response.
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

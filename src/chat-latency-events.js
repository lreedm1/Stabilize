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

function initialChatResult(response) {
  return {
    route: "UNKNOWN",
    status: response.ok ? "completed" : "error",
    firstTokenMs: null,
  };
}

function observeNdjsonLine(line, result, startedAt) {
  if (!line.trim()) return;
  try {
    const event = JSON.parse(line);
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
      // The provider or browser may already have closed the cloned stream.
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
    result.route = safeToken(body?.route, 64) || result.route;
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
  // Consume the cloned stream immediately so analytics never backpressures the
  // user-facing response. Identity hashing and auth verification run beside it.
  const resultPromise = parseChatResponse(analyticsCopy, startedAt).catch(() => ({
    route: "UNKNOWN",
    status: "error",
    firstTokenMs: null,
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

  await store.startChat({
    turnId,
    occurredAt: startedAt,
    sessionHash,
    browserHash,
    conversationHash,
    accountType: authSession ? "signed_in" : "guest",
    model: safeToken(env?.OPENAI_MODEL, 128) || "unknown",
    estimatedCostMicros: boundedNumber(
      env?.IMPACT_ESTIMATED_CHAT_COST_MICROS,
      0,
      100_000_000,
      0,
    ),
  });

  const result = await resultPromise;
  await store.finishChat({
    turnId,
    route: result.route,
    status: result.status,
    httpStatus: response.status,
    firstTokenMs: result.firstTokenMs,
    totalResponseMs: Date.now() - startedAt,
  });
}

export async function chatResponse(request, env, ctx) {
  const startedAt = Date.now();
  const turnId = crypto.randomUUID();
  const sessionId = request.headers.get("x-stabilize-session-id") || "";
  const browserId = request.headers.get("x-stabilize-browser-id") || "";
  const conversationId =
    request.headers.get("x-stabilize-conversation-id") || "";

  // Nothing analytics-related is awaited before the actual chat Worker opens
  // its response stream.
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

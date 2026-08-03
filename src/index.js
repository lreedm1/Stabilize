import { COPY } from "./copy.js";
import {
  AUTH_COOKIE_NAME,
  GoogleAuthConfigurationError,
  LEGACY_SESSION_COOKIE_NAME,
  MEMORY_DELETION_COOKIE_NAME,
  beginGoogleSignIn,
  clearAuthCookie,
  clearLegacySessionCookie,
  clearMemoryDeletionCookie,
  completeGoogleSignIn,
  createMemoryDeletionReceiptCookie,
  googleAuthConfigured,
  readAuthSession,
  readMemoryDeletionReceipt,
  refreshLegacyAuthSession,
  rotateAuthSession,
  signOut,
} from "./auth.js";
import { renderPage } from "./page.js";
import { classifyInput, fixedReplyForRoute } from "./safety.js";
import { SessionMemory } from "./session-memory.js";

export { SessionMemory };

const MAX_BODY_BYTES = 32_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_MESSAGES = 12;
const MAX_SUMMARY_CHARS = 1_000;
const MAX_SUMMARY_OUTPUT_TOKENS = 320;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_CONVERSATIONS_URL = "https://api.openai.com/v1/conversations";
const OPENAI_REASONING_EFFORTS = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const OPENAI_ACCOUNT_LIMIT_CODES = new Set([
  "credit_balance_exhausted",
  "insufficient_quota",
  "organization_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "project_spend_limit_exceeded",
]);
const PROVIDER_FIELD_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CONVERSATION_ID_PATTERN = /^conv_[A-Za-z0-9_-]{1,120}$/;
const CONTINUITY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const FIXED_ROUTE_MEMORY = {
  MEDICAL_EMERGENCY:
    "[A possible medical emergency triggered an urgent fixed response.]",
  IMMEDIATE_DANGER:
    "[An immediate safety concern triggered an urgent fixed response.]",
  SAFETY_UNCLEAR:
    "[The user expressed uncertainty about immediate safety and was asked one direct safety question.]",
  UNSAFE_SHELTER:
    "[An urgent shelter or personal-safety concern triggered a fixed response.]",
  MEDICATION_CHANGE:
    "[The user asked about changing medication and was directed to a pharmacist or prescriber.]",
  MEDICATION_ACCESS:
    "[The user reported a medication-access problem and was directed to a pharmacy, prescriber, clinic, or support staff.]",
};

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

class OpenAIRequestError extends Error {
  constructor({
    name,
    failure,
    status = 0,
    code = null,
    type = null,
    param = null,
    providerRequestId = null,
    clientRequestId,
    retryAfterSeconds = null,
  }) {
    super("OpenAI request failed");
    this.name = name;
    this.failure = failure;
    this.status = status;
    this.code = code;
    this.type = type;
    this.param = param;
    this.providerRequestId = providerRequestId;
    this.clientRequestId = clientRequestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function apiHeaders(extra = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

function pageHeaders(contentType = "text/html; charset=utf-8", extra = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
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

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: apiHeaders(extraHeaders),
  });
}

function readCookie(request, name) {
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

function emptyMemoryContext() {
  return {
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
  };
}

function accountMemoryStub(env, accountKey) {
  if (!accountKey) return null;
  if (!env?.SESSIONS || typeof env.SESSIONS.getByName !== "function") return null;
  return env.SESSIONS.getByName("google:" + accountKey);
}

async function readMemoryContext(stub) {
  if (!stub || typeof stub.readContext !== "function") {
    return emptyMemoryContext();
  }

  try {
    const context = await stub.readContext();
    return {
      summary: String(context?.summary || "").trim().slice(0, MAX_SUMMARY_CHARS),
      recent: normalizeMessages(context?.recent),
      awaitingSafetyAnswer: context?.awaitingSafetyAnswer === true,
      turnCount: Number(context?.turnCount) || 0,
      updatedAt: Number(context?.updatedAt) || null,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "session_memory_read_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return emptyMemoryContext();
  }
}

async function readBoundedJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, COPY.api.bodyTooLarge);
  }

  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel(COPY.api.bodyTooLarge);
        throw new HttpError(413, COPY.api.bodyTooLarge);
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

  try {
    return JSON.parse(new TextDecoder().decode(bytes) || "{}");
  } catch {
    throw new HttpError(400, COPY.api.invalidJson);
  }
}

async function readBoundedForm(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, COPY.api.bodyTooLarge);
  }

  const contentType = String(request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new HttpError(400, COPY.api.invalidConversation);
  }

  if (!request.body) return new URLSearchParams();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel(COPY.api.bodyTooLarge);
        throw new HttpError(413, COPY.api.bodyTooLarge);
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
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  const cleaned = messages
    .filter((message) => message && ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      text: String(message.content || "").trim().slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.text)
    .slice(-MAX_MESSAGES);

  const alternating = [];
  for (const message of cleaned) {
    const previous = alternating.at(-1);
    if (previous?.role === message.role) {
      previous.text = (previous.text + "\n" + message.text).slice(
        0,
        MAX_MESSAGE_CHARS,
      );
    } else {
      alternating.push({ ...message });
    }
  }

  return alternating.map((message) => ({
    role: message.role,
    content: message.text,
  }));
}

function latestUserText(body) {
  const direct = String(body?.message || "").trim();
  if (direct) return direct;

  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  const latestUser = [...rawMessages]
    .reverse()
    .find((message) => message?.role === "user");
  return String(latestUser?.content || "").trim();
}

function modelInput(memory, latestText) {
  const messages = [];
  if (memory.summary) {
    messages.push({
      role: "user",
      content: COPY.model.memoryPrefix + "\n" + memory.summary,
    });
  }
  messages.push(...memory.recent);
  messages.push({ role: "user", content: latestText });
  return normalizeMessages(messages);
}

function conversationSeed(memory) {
  const messages = [];
  if (memory.summary) {
    messages.push({
      role: "user",
      content: COPY.model.memoryPrefix + "\n" + memory.summary,
    });
  }
  messages.push(...memory.recent);
  return normalizeMessages(messages).slice(-20);
}

function cleanOpenAIConversationId(value) {
  const text = String(value || "").trim();
  return CONVERSATION_ID_PATTERN.test(text) ? text : null;
}

function demoReply(route, latestText) {
  const text = latestText.toLowerCase();

  if (route === "LOW_SLEEP_URGENCY") {
    return COPY.demo.LOW_SLEEP_URGENCY;
  }
  if (route === "FLOOR_FOOD") {
    return COPY.demo.FLOOR_FOOD;
  }
  if (route === "FLOOR_REST") {
    return COPY.demo.FLOOR_REST;
  }
  if (/\b(?:alone|lonely|nobody|no one)\b/.test(text)) {
    return COPY.demo.loneliness;
  }
  return COPY.demo.default;
}

function validateModelReply(reply) {
  const text = String(reply || "").trim();
  if (!text) return null;

  const unsafeMedication =
    /\b(?:stop taking|double (?:your|the) dose|take \d+(?:\.\d+)? ?mg|increase (?:your|the) dose|reduce (?:your|the) dose)\b/i;
  const falseAssurance =
    /\b(?:i can keep you safe|you are definitely safe|you don't need human help)\b/i;

  if (unsafeMedication.test(text) || falseAssurance.test(text)) return null;
  return text;
}

function effectiveReasoningEffort(model, requestedEffort) {
  if (requestedEffort === "max") {
    if (/^gpt-5\.6(?:-|$)/.test(model)) return "max";
    if (/^gpt-5\.(?:2|3|4|5)(?:-|$)/.test(model)) return "xhigh";
    return "high";
  }
  if (
    requestedEffort === "xhigh" &&
    !/^gpt-5\.(?:2|3|4|5|6)(?:-|$)/.test(model)
  ) {
    return "high";
  }
  return requestedEffort;
}

function openAIConfig(env) {
  const apiKey = String(env.OPENAI_API_KEY || "");
  if (!apiKey) {
    const error = new Error("OpenAI is not configured");
    error.name = "MissingOpenAIKey";
    throw error;
  }

  const model = String(env.OPENAI_MODEL || "gpt-5.6-sol");
  const requestedReasoningEffort = String(
    env.OPENAI_REASONING_EFFORT || "max",
  );
  if (
    !/^[A-Za-z0-9._:-]+$/.test(model) ||
    !OPENAI_REASONING_EFFORTS.has(requestedReasoningEffort)
  ) {
    const error = new Error("OpenAI configuration is invalid");
    error.name = "InvalidOpenAIConfiguration";
    throw error;
  }

  const reasoningEffort = effectiveReasoningEffort(
    model,
    requestedReasoningEffort,
  );
  return { apiKey, model, reasoningEffort };
}

function responseText(responseBody) {
  const output = Array.isArray(responseBody?.output) ? responseBody.output : [];
  return output
    .filter((item) => item?.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter(
      (block) =>
        block?.type === "output_text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function safeProviderField(value) {
  const text = String(value || "").trim();
  return PROVIDER_FIELD_PATTERN.test(text) ? text : null;
}

function retryAfterSeconds(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const numeric = Number(text);
  const seconds = Number.isFinite(numeric)
    ? Math.ceil(numeric)
    : Math.ceil((Date.parse(text) - Date.now()) / 1_000);
  if (!Number.isFinite(seconds) || seconds < 1) return null;
  return Math.min(seconds, 300);
}

function providerErrorFields(responseBody) {
  const providerError = responseBody?.error;
  if (!providerError || typeof providerError !== "object") {
    return { code: null, type: null, param: null };
  }
  return {
    code: safeProviderField(providerError.code),
    type: safeProviderField(providerError.type),
    param: safeProviderField(providerError.param),
  };
}

function errorReference(clientRequestId) {
  const compact = String(clientRequestId || "").replaceAll("-", "");
  return "STB-" + compact.slice(0, 12).toUpperCase();
}

function publicOpenAIError(error) {
  if (error.failure === "timeout" || error.status === 408) {
    return { status: 504, message: COPY.api.aiTimeout };
  }
  if (error.failure === "connection") {
    return { status: 503, message: COPY.api.aiConnection };
  }
  if (error.failure === "invalid_output") {
    return { status: 502, message: COPY.api.unreliableReply };
  }
  if (
    OPENAI_ACCOUNT_LIMIT_CODES.has(error.code) ||
    error.type === "insufficient_quota"
  ) {
    return { status: 503, message: COPY.api.aiServiceLimit };
  }
  if (error.status === 429) {
    const waitSeconds = error.retryAfterSeconds || 20;
    return {
      status: 429,
      message: COPY.api.aiBusy(waitSeconds),
      retryAfterSeconds: waitSeconds,
    };
  }
  if ([401, 403, 404].includes(error.status)) {
    return { status: 503, message: COPY.api.aiConfiguration };
  }
  if ([400, 413, 422].includes(error.status)) {
    return { status: 422, message: COPY.api.aiRequestRejected };
  }
  return { status: 503, message: COPY.api.temporarilyUnavailable };
}

async function callOpenAI(
  url,
  payload,
  apiKey,
  timeoutMs,
  errorName,
  method = "POST",
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const clientRequestId = crypto.randomUUID();

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "X-Client-Request-Id": clientRequestId,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    throw new OpenAIRequestError({
      name: errorName,
      failure: controller.signal.aborted ? "timeout" : "connection",
      clientRequestId,
    });
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await response.json().catch(() => ({}));
  const providerRequestId = safeProviderField(
    response.headers.get("x-request-id"),
  );
  if (!response.ok) {
    const fields = providerErrorFields(responseBody);
    throw new OpenAIRequestError({
      name: errorName,
      failure: "http",
      status: response.status,
      code: fields.code,
      type: fields.type,
      param: fields.param,
      providerRequestId,
      clientRequestId,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    });
  }

  return {
    body: responseBody,
    text: responseText(responseBody),
    providerRequestId,
    clientRequestId,
  };
}

async function createOpenAIConversation(env) {
  const { apiKey } = openAIConfig(env);
  const payload = {
    metadata: {
      application: "stabilize",
      retention: "30_days",
    },
  };

  const result = await callOpenAI(
    OPENAI_CONVERSATIONS_URL,
    payload,
    apiKey,
    25_000,
    "OpenAIConversationCreateError",
  );
  const conversationId = cleanOpenAIConversationId(result.body?.id);
  if (!conversationId) {
    throw new OpenAIRequestError({
      name: "OpenAIConversationInvalidReplyError",
      failure: "invalid_output",
      status: 502,
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }
  return conversationId;
}

async function generateReply(
  messages,
  route,
  env,
  latestText,
  conversationId = null,
  seedItems = [],
) {
  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
  if (demoMode) return demoReply(route, latestText);

  const { apiKey, model, reasoningEffort } = openAIConfig(env);
  const result = await callOpenAI(
    OPENAI_RESPONSES_URL,
    {
      model,
      reasoning: { effort: reasoningEffort, context: "current_turn" },
      text: { verbosity: "low" },
      instructions:
        COPY.model.systemPrompt +
        "\n\n" +
        COPY.model.memoryInstruction +
        "\n\n" +
        COPY.model.routeInstruction(route),
      input: conversationId
        ? [
            ...normalizeMessages(seedItems).slice(-19),
            { role: "user", content: latestText },
          ]
        : messages,
      // Conversation items provide continuity and have an explicit item-first
      // deletion path. Do not also retain a separately addressable Response.
      store: false,
      ...(conversationId
        ? { conversation: conversationId, truncation: "auto" }
        : {}),
    },
    apiKey,
    60_000,
    "OpenAIHttpError",
  );

  const reply = validateModelReply(result.text);
  if (!reply) {
    throw new OpenAIRequestError({
      name: "OpenAIInvalidReplyError",
      failure: "invalid_output",
      status: 502,
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }
  return reply;
}

function sanitizeSummary(value) {
  return String(value || "")
    .trim()
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email omitted]")
    .replace(/https?:\/\/\S+/gi, "[link omitted]")
    .replace(/\b(?:\d[\s().-]?){10,}\b/g, "[number omitted]")
    .slice(0, MAX_SUMMARY_CHARS)
    .trim();
}

async function generateSummary(snapshot, env) {
  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
  if (demoMode || !String(env.OPENAI_API_KEY || "")) return null;

  const { apiKey, model } = openAIConfig(env);
  const input = JSON.stringify({
    existing_summary: snapshot.summary || null,
    recent_messages: snapshot.messages,
  });
  const result = await callOpenAI(
    OPENAI_RESPONSES_URL,
    {
      model,
      reasoning: { effort: "low", context: "current_turn" },
      instructions: COPY.model.summaryPrompt,
      input: [{ role: "user", content: input }],
      max_output_tokens: MAX_SUMMARY_OUTPUT_TOKENS,
      store: false,
    },
    apiKey,
    25_000,
    "OpenAISummaryHttpError",
  );

  return sanitizeSummary(result.text) || null;
}

async function compactSession(stub, env) {
  try {
    const snapshot = await stub.getCompactionSnapshot();
    if (!snapshot) return;
    const summary = await generateSummary(snapshot, env);
    if (!summary) return;
    await stub.applySummary(
      summary,
      snapshot.summaryVersion,
      snapshot.throughSequence,
      snapshot.stateEpoch,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "session_memory_compaction_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

async function recordExchange(stub, exchange) {
  if (!stub) return null;
  const write =
    typeof stub.recordLocalExchange === "function"
      ? stub.recordLocalExchange.bind(stub)
      : typeof stub.recordExchange === "function"
        ? stub.recordExchange.bind(stub)
        : null;
  if (!write) return null;
  try {
    return await write(exchange);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "session_memory_write_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return null;
  }
}

function schedule(ctx, promise) {
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(promise);
    return true;
  }
  return false;
}

async function recordFixedRoute(
  stub,
  route,
  fixed,
) {
  const exchange = {
    user:
      FIXED_ROUTE_MEMORY[route] ||
      "[A deterministic support route triggered a fixed response.]",
    assistant: fixed.reply,
    awaitingSafetyAnswer: fixed.awaitingSafetyAnswer === true,
  };
  if (!stub) return true;
  try {
    if (typeof stub.recordFixedExchange === "function") {
      await stub.recordFixedExchange(exchange);
    } else {
      const result = await recordExchange(stub, exchange);
      if (!result) return false;
    }
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "session_memory_fixed_write_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return false;
  }
}

async function quarantineProviderTurnSafely(stub, request) {
  if (!stub || typeof stub.quarantineProviderTurn !== "function") return false;
  try {
    return await stub.quarantineProviderTurn(request);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "provider_turn_quarantine_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return false;
  }
}

function continuityForSession(authSession) {
  const token = String(authSession?.continuityToken || "");
  return authSession && CONTINUITY_TOKEN_PATTERN.test(token)
    ? { mode: "account", token }
    : { mode: "guest", token: null };
}

function requestedContinuity(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, "continuity")) {
    // Cached clients from before continuity binding must remain stateless.
    return { mode: "guest", token: null };
  }

  const continuity = body?.continuity;
  if (
    continuity?.mode === "guest" &&
    (continuity.token === undefined || continuity.token === null)
  ) {
    return { mode: "guest", token: null };
  }
  if (
    continuity?.mode === "account" &&
    CONTINUITY_TOKEN_PATTERN.test(String(continuity.token || ""))
  ) {
    return { mode: "account", token: String(continuity.token) };
  }
  throw new HttpError(400, COPY.api.invalidConversation);
}

function resolveContinuity(body, authSession) {
  const requested = requestedContinuity(body);
  const current = continuityForSession(authSession);
  if (requested.mode === "guest") {
    return { continuity: requested, accountKey: null };
  }
  if (
    current.mode !== "account" ||
    requested.token !== current.token ||
    !authSession?.accountKey
  ) {
    throw new HttpError(
      409,
      COPY.api.sessionChanged || "Your sign-in changed. Reload and try again.",
      { reload: true, continuity: current },
    );
  }
  return { continuity: requested, accountKey: authSession.accountKey };
}

function confirmedConversationMissing(error) {
  return (
    error instanceof OpenAIRequestError &&
    error.status === 404 &&
    ["conversation_not_found", "not_found"].includes(error.code) &&
    ["conversation", "conversation_id"].includes(error.param)
  );
}

function uncertainProviderOutcome(error) {
  return (
    error instanceof OpenAIRequestError &&
    (["timeout", "connection", "invalid_output"].includes(error.failure) ||
      error.status === 408 ||
      error.status >= 500)
  );
}

async function purgeUnusedConversation(stub, conversationId) {
  const cleanId = cleanOpenAIConversationId(conversationId);
  if (!cleanId || typeof stub?.purgeUnusedOpenAIConversation !== "function") {
    return false;
  }
  try {
    return await stub.purgeUnusedOpenAIConversation(cleanId);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "openai_conversation_cleanup_queue_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return false;
  }
}

async function providerBackedReply(
  stub,
  route,
  env,
  latestText,
  clientAwaiting,
) {
  for (let recoveryAttempt = 0; recoveryAttempt < 2; recoveryAttempt += 1) {
    const turn = await stub.beginProviderTurn();
    if (!turn?.acquired) {
      throw new HttpError(
        409,
        COPY.api.responseInProgress ||
          "Another response is already in progress. Try again shortly.",
        { retryAfterSeconds: Number(turn?.retryAfterSeconds) || 1 },
      );
    }

    const lease = {
      leaseToken: turn.leaseToken,
      epoch: turn.epoch,
    };
    const memory = {
      ...emptyMemoryContext(),
      ...(turn.context || {}),
      recent: normalizeMessages(turn.context?.recent),
    };
    const currentRoute = classifyInput(latestText, {
      awaitingSafetyAnswer:
        clientAwaiting === true || memory.awaitingSafetyAnswer === true,
    });
    const currentFixed = fixedReplyForRoute(currentRoute);
    if (currentFixed) {
      const recorded = await recordFixedRoute(stub, currentRoute, currentFixed);
      if (!recorded) {
        await quarantineProviderTurnSafely(stub, {
          ...lease,
          conversationId: cleanOpenAIConversationId(turn.conversationId),
        });
      }
      return { fixed: currentFixed, route: currentRoute };
    }
    let conversationId = cleanOpenAIConversationId(turn.conversationId);
    let candidateId = null;
    let seedItems = [];
    let createdForTurn = false;
    let providerMayHaveAppended = false;

    try {
      if (!conversationId) {
        candidateId = await createOpenAIConversation(env);
        let adoption;
        try {
          adoption = await stub.adoptProviderConversation({
            ...lease,
            candidateId,
          });
        } catch (error) {
          await purgeUnusedConversation(stub, candidateId);
          throw error;
        }

        conversationId = cleanOpenAIConversationId(adoption?.conversationId);
        if (!adoption?.accepted || !conversationId) {
          await purgeUnusedConversation(stub, candidateId);
          throw new HttpError(
            409,
            COPY.api.sessionChanged || "Conversation state changed. Try again.",
            { reload: true },
          );
        }
        if (conversationId !== candidateId) {
          await purgeUnusedConversation(stub, candidateId);
        } else {
          createdForTurn = true;
          seedItems = conversationSeed(memory);
        }
      }

      const messages = modelInput(memory, latestText);
      const reply = await generateReply(
        messages,
        currentRoute || route,
        env,
        latestText,
        conversationId,
        seedItems,
      );
      providerMayHaveAppended = true;
      const result = await stub.commitProviderTurn({
        ...lease,
        conversationId,
        exchange: {
          user: latestText,
          assistant: reply,
          awaitingSafetyAnswer: false,
        },
      });
      if (!result?.committed) {
        throw new HttpError(
          409,
          COPY.api.sessionChanged || "Conversation state changed. Try again.",
          { reload: true },
        );
      }
      return { reply, result, memory, route: currentRoute || route };
    } catch (error) {
      if (confirmedConversationMissing(error) && conversationId) {
        if (typeof stub.retireMissingProviderConversation === "function") {
          await stub.retireMissingProviderConversation({
            ...lease,
            conversationId,
          });
        } else {
          await stub.quarantineProviderTurn({
            ...lease,
            conversationId,
            delayMs: 0,
          });
        }
        if (recoveryAttempt === 0) continue;
        throw error;
      }

      if (
        createdForTurn ||
        providerMayHaveAppended ||
        uncertainProviderOutcome(error)
      ) {
        await quarantineProviderTurnSafely(stub, {
          ...lease,
          conversationId,
        });
      } else {
        await stub.releaseProviderTurn(lease);
      }
      throw error;
    }
  }

  throw new HttpError(503, COPY.api.temporarilyUnavailable);
}

async function handleChat(request, env, ctx, authSession) {
  const body = await readBoundedJson(request);
  const latestText = latestUserText(body);
  if (!latestText) throw new HttpError(400, COPY.api.messageRequired);
  if (latestText.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, COPY.api.messageTooLong);
  }

  const resolved = resolveContinuity(body, authSession);
  const { continuity } = resolved;
  const stub = accountMemoryStub(env, resolved.accountKey);
  const clientAwaiting = body?.awaitingSafetyAnswer === true;
  let route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting,
  });
  let fixed = fixedReplyForRoute(route);

  if (fixed) {
    await recordFixedRoute(stub, route, fixed);
    return jsonResponse({ route, ...fixed, continuity });
  }

  const memory = await readMemoryContext(stub);

  route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting || memory.awaitingSafetyAnswer,
  });
  fixed = fixedReplyForRoute(route);

  if (fixed) {
    await recordFixedRoute(stub, route, fixed);
    return jsonResponse({ route, ...fixed, continuity });
  }

  const messages = modelInput(memory, latestText);
  if (!messages.length) throw new HttpError(400, COPY.api.invalidConversation);

  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
  let reply;
  let result;
  if (!demoMode && stub && typeof stub.beginProviderTurn === "function") {
    const providerResult = await providerBackedReply(
      stub,
      route,
      env,
      latestText,
      clientAwaiting,
    );
    if (providerResult.fixed) {
      return jsonResponse({
        route: providerResult.route,
        ...providerResult.fixed,
        continuity,
      });
    }
    ({ reply, result, route } = providerResult);
  } else {
    reply = await generateReply(messages, route, env, latestText);
    result = await recordExchange(stub, {
      user: latestText,
      assistant: reply,
      awaitingSafetyAnswer: false,
    });
  }

  if (result?.shouldCompact && stub && ctx) {
    schedule(ctx, compactSession(stub, env));
  }

  return jsonResponse({
    route,
    reply,
    showEmergency: false,
    awaitingSafetyAnswer: false,
    continuity,
  });
}

function authNotice(code, memoryCode, signedIn, memoryDeletionConfirmed) {
  if (signedIn && memoryDeletionConfirmed) {
    return COPY.page.auth.memoryDeleted;
  }
  if (signedIn && memoryCode === "session-changed") {
    return COPY.page.auth.memorySessionChanged;
  }
  if (code === "cancelled") return COPY.page.auth.cancelled;
  if (code === "failed") return COPY.page.auth.failed;
  return "";
}

function appendRetiredCookieCleanup(headers, request, authSession) {
  if (readCookie(request, LEGACY_SESSION_COOKIE_NAME)) {
    headers.append("Set-Cookie", clearLegacySessionCookie(request));
  }
  if (!authSession && readCookie(request, AUTH_COOKIE_NAME)) {
    headers.append("Set-Cookie", clearAuthCookie(request));
  }
}

function sameOriginOrNonBrowser(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (!["GET", "HEAD"].includes(request.method)) {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }

        let authSession = await readAuthSession(request, env);
        const refreshedSession = await refreshLegacyAuthSession(
          request,
          env,
          authSession,
        );
        if (refreshedSession) authSession = refreshedSession.session;
        const memoryDeletionConfirmed = await readMemoryDeletionReceipt(
          request,
          authSession,
          env,
        );
        const headers = pageHeaders();
        appendRetiredCookieCleanup(headers, request, authSession);
        if (refreshedSession) {
          headers.append("Set-Cookie", refreshedSession.setCookie);
        }
        if (readCookie(request, MEMORY_DELETION_COOKIE_NAME)) {
          headers.append("Set-Cookie", clearMemoryDeletionCookie(request));
        }
        return new Response(
          request.method === "HEAD"
            ? null
            : renderPage({
                signedIn: Boolean(authSession),
                continuity: continuityForSession(authSession),
                memoryDeletionConfirmed,
                googleSignInAvailable: googleAuthConfigured(env),
                authNotice: authNotice(
                  url.searchParams.get("auth"),
                  url.searchParams.get("memory"),
                  Boolean(authSession),
                  memoryDeletionConfirmed,
                ),
              }),
          {
            headers,
          },
        );
      }

      if (url.pathname === "/auth/google") {
        if (request.method !== "GET") {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        try {
          return await beginGoogleSignIn(request, env);
        } catch (error) {
          if (error instanceof GoogleAuthConfigurationError) {
            return new Response(COPY.api.googleSignInUnavailable, {
              status: 503,
              headers: pageHeaders("text/plain; charset=utf-8"),
            });
          }
          throw error;
        }
      }

      if (url.pathname === "/auth/google/callback") {
        if (request.method !== "GET") {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        return await completeGoogleSignIn(request, env);
      }

      if (url.pathname === "/auth/logout") {
        if (request.method !== "POST") {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        if (!sameOriginOrNonBrowser(request)) {
          return new Response(COPY.api.crossOriginRequest, {
            status: 403,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        return signOut(request, env);
      }

      if (url.pathname === "/api/auth") {
        if (request.method !== "GET") {
          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
        }
        let authSession = await readAuthSession(request, env);
        const refreshedSession = await refreshLegacyAuthSession(
          request,
          env,
          authSession,
        );
        if (refreshedSession) authSession = refreshedSession.session;
        return jsonResponse(
          {
            signedIn: Boolean(authSession),
            memory: Boolean(authSession && env.SESSIONS),
            google: googleAuthConfigured(env),
            continuity: continuityForSession(authSession),
          },
          200,
          refreshedSession ? { "Set-Cookie": refreshedSession.setCookie } : {},
        );
      }

      if (url.pathname === "/api/health") {
        if (request.method !== "GET") {
          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
        }
        const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
        const configured = demoMode || Boolean(String(env.OPENAI_API_KEY || ""));
        return jsonResponse(
          {
            ok: configured,
            mode: demoMode ? "demo" : "openai",
            model: demoMode ? null : String(env.OPENAI_MODEL || "gpt-5.6-sol"),
            aiFeature: demoMode ? null : "conversations",
            reasoningEffort: demoMode
              ? null
              : String(env.OPENAI_REASONING_EFFORT || "max"),
            verbosity: demoMode ? null : "low",
            memory: Boolean(env.SESSIONS),
            authentication: googleAuthConfigured(env),
          },
          configured ? 200 : 503,
        );
      }

      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") {
          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
        }
        if (!sameOriginOrNonBrowser(request)) {
          return jsonResponse({ error: COPY.api.crossOriginRequest }, 403);
        }
        const authSession = await readAuthSession(request, env);
        return await handleChat(request, env, ctx, authSession);
      }

      if (url.pathname === "/account/memory/delete") {
        if (request.method !== "POST") {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        if (!sameOriginOrNonBrowser(request)) {
          return new Response(COPY.api.crossOriginRequest, {
            status: 403,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        const authSession = await readAuthSession(request, env);
        if (!authSession) {
          return new Response(null, {
            status: 303,
            headers: pageHeaders("text/plain; charset=utf-8", {
              Location: "/auth/google",
            }),
          });
        }
        const form = await readBoundedForm(request);
        const suppliedContinuity = form.getAll("continuity");
        if (
          suppliedContinuity.length !== 1 ||
          suppliedContinuity[0] !== authSession.continuityToken
        ) {
          return new Response(null, {
            status: 303,
            headers: pageHeaders("text/plain; charset=utf-8", {
              Location: "/?memory=session-changed",
            }),
          });
        }
        const stub = accountMemoryStub(env, authSession.accountKey);
        if (!stub || typeof stub.eraseMemory !== "function") {
          return new Response(COPY.api.temporarilyUnavailable, {
            status: 503,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        await stub.eraseMemory();
        const rotatedSession = await rotateAuthSession(request, env, authSession);
        const receiptCookie = await createMemoryDeletionReceiptCookie(
          request,
          rotatedSession.session,
          env,
        );
        const headers = pageHeaders("text/plain; charset=utf-8", {
          Location: "/",
        });
        headers.append("Set-Cookie", rotatedSession.setCookie);
        headers.append("Set-Cookie", receiptCookie);
        return new Response(null, {
          status: 303,
          headers,
        });
      }

      if (url.pathname.startsWith("/api/")) {
        return jsonResponse({ error: COPY.api.notFound }, 404);
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(
          { error: error.message, ...(error.details || {}) },
          error.status,
        );
      }

      if (error instanceof OpenAIRequestError) {
        const publicError = publicOpenAIError(error);
        const reference = errorReference(error.clientRequestId);
        console.error(
          JSON.stringify({
            event: "openai_request_failed",
            error: error.name,
            failure: error.failure,
            status: error.status || null,
            code: error.code,
            type: error.type,
            param: error.param,
            providerRequestId: error.providerRequestId,
            clientRequestId: error.clientRequestId,
            retryAfterSeconds: error.retryAfterSeconds,
            reference,
            path: url.pathname,
          }),
        );

        const headers = publicError.retryAfterSeconds
          ? { "Retry-After": String(publicError.retryAfterSeconds) }
          : {};
        return jsonResponse(
          { error: publicError.message, reference },
          publicError.status,
          headers,
        );
      }

      const clientRequestId = crypto.randomUUID();
      const reference = errorReference(clientRequestId);
      console.error(
        JSON.stringify({
          event: "request_failed",
          error: error instanceof Error ? error.name : "UnknownError",
          clientRequestId,
          reference,
          path: url.pathname,
        }),
      );

      const publicMessage = [
        "MissingOpenAIKey",
        "InvalidOpenAIConfiguration",
      ].includes(error instanceof Error ? error.name : "")
        ? COPY.api.aiConfiguration
        : COPY.api.temporarilyUnavailable;
      return jsonResponse({ error: publicMessage, reference }, 503);
    }
  },
};

export default worker;

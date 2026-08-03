import { COPY } from "./copy.js";
import {
  GoogleAuthConfigurationError,
  LEGACY_SESSION_COOKIE_NAME,
  beginGoogleSignIn,
  clearLegacySessionCookie,
  completeGoogleSignIn,
  createGuestSession,
  createGuestResetGrant,
  createMemoryDeletionReceiptCookie,
  googleAuthConfigured,
  guestSessionConfigured,
  readAuthSession,
  readGuestSession,
  readGuestResetGrant,
  readMemoryDeletionReceipt,
  rotateAuthSession,
  signOut,
} from "./auth.js";
import { captureRequestStartedAt } from "./request-timing.js";
import {
  ACCOUNT_STATE_HEADER,
  accountSessionAllowed,
  readAuthorizedAuthSession,
} from "./account-session.js";
import { renderPage } from "./page.js";
import { classifyInput, fixedReplyForRoute } from "./safety.js";
import {
  GuestSessionMemory,
  SessionMemory,
} from "./session-memory.js";

export { GuestSessionMemory, SessionMemory };

const MAX_BODY_BYTES = 32_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_MESSAGES = 12;
const MAX_SUMMARY_CHARS = 1_000;
const MAX_SUMMARY_OUTPUT_TOKENS = 320;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
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

function sessionMemoryStub(env, kind, key) {
  if (!key || !["google", "guest"].includes(kind)) return null;
  const binding = kind === "google" ? env?.SESSIONS : env?.GUEST_SESSIONS;
  if (!binding || typeof binding.getByName !== "function") return null;
  return binding.getByName(`${kind}:${key}`);
}

function accountMemoryStub(env, accountKey) {
  return sessionMemoryStub(env, "google", accountKey);
}

function guestMemoryStub(env, guestKey) {
  return sessionMemoryStub(env, "guest", guestKey);
}

async function resolveGuestSession(
  request,
  env,
  { createIfMissing = false } = {},
) {
  if (
    !guestSessionConfigured(env) ||
    !env?.GUEST_SESSIONS ||
    typeof env.GUEST_SESSIONS.getByName !== "function"
  ) {
    return { session: null, setCookie: null };
  }

  const session = await readGuestSession(request, env);
  if (!session && createIfMissing) {
    return createGuestSession(request, env);
  }
  return { session, setCookie: null };
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
  const contentType = String(request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(400, COPY.api.invalidJson);
  }
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

function validatedLatestUserText(body) {
  const latestText = latestUserText(body);
  if (!latestText) throw new HttpError(400, COPY.api.messageRequired);
  if (latestText.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, COPY.api.messageTooLong);
  }
  return latestText;
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

function isNeutralGreeting(value) {
  return /^(?:hi|hello|hey|hiya|good morning|good afternoon|good evening)[!.? ]*$/i.test(
    String(value || "").trim(),
  );
}

function isUnsolicitedSafetyCheck(value) {
  return /(?:hurt yourself|kill yourself|safe right now|immediate danger|next few hours)/i.test(
    String(value || ""),
  );
}

async function generateReply(
  messages,
  route,
  env,
  latestText,
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
      input: messages,
      store: true,
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
  if (
    route === "ORDINARY" &&
    isNeutralGreeting(latestText) &&
    isUnsolicitedSafetyCheck(reply)
  ) {
    return "Hi. What’s happening right now?";
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
      store: true,
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
  requestStartedAt,
  sessionIssuedAtMs,
  hardDeleteAtMs,
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
      const result = await stub.recordFixedExchange(
        exchange,
        requestStartedAt,
        sessionIssuedAtMs,
        hardDeleteAtMs,
      );
      if (!result?.recorded) return false;
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

function continuityForSessions(authSession, guestSession) {
  const accountToken = String(authSession?.continuityToken || "");
  if (authSession && CONTINUITY_TOKEN_PATTERN.test(accountToken)) {
    return { mode: "account", token: accountToken };
  }
  const guestToken = String(guestSession?.continuityToken || "");
  return guestSession && CONTINUITY_TOKEN_PATTERN.test(guestToken)
    ? { mode: "guest", token: guestToken }
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
    (continuity.token === undefined ||
      continuity.token === null ||
      CONTINUITY_TOKEN_PATTERN.test(String(continuity.token || "")))
  ) {
    return {
      mode: "guest",
      token:
        continuity.token === undefined || continuity.token === null
          ? null
          : String(continuity.token),
    };
  }
  if (
    continuity?.mode === "account" &&
    CONTINUITY_TOKEN_PATTERN.test(String(continuity.token || ""))
  ) {
    return { mode: "account", token: String(continuity.token) };
  }
  throw new HttpError(400, COPY.api.invalidConversation);
}

function resolveContinuity(body, authSession, guestSession) {
  const requested = requestedContinuity(body);
  const current = continuityForSessions(authSession, guestSession);
  if (requested.mode === "guest") {
    if (authSession?.accountKey) {
      throw new HttpError(
        409,
        COPY.api.sessionChanged || "Your conversation changed. Reload and try again.",
        { reload: true, continuity: current },
      );
    }
    if (requested.token === null) {
      // Cached clients from before anonymous continuity remain stateless until
      // they reload and receive a server-bound guest session.
      return {
        continuity: requested,
        memoryKind: null,
        memoryKey: null,
        sessionIssuedAtMs: null,
        hardDeleteAtMs: null,
      };
    }
    if (
      !guestSession?.guestKey ||
      requested.token !== guestSession.continuityToken
    ) {
      throw new HttpError(
        409,
        COPY.api.sessionChanged || "Your conversation changed. Reload and try again.",
        { reload: true, continuity: current },
      );
    }
    return {
      continuity: requested,
      memoryKind: "guest",
      memoryKey: guestSession.guestKey,
      sessionIssuedAtMs: guestSession.issuedAtMs,
      hardDeleteAtMs: guestSession.expiresAt * 1_000,
    };
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
  return {
    continuity: requested,
    memoryKind: "google",
    memoryKey: authSession.accountKey,
    sessionIssuedAtMs: authSession.issuedAtMs,
    hardDeleteAtMs: null,
  };
}

async function modelBackedReply(
  stub,
  route,
  env,
  latestText,
  clientAwaiting,
  ctx,
  requestStartedAt,
  sessionIssuedAtMs,
  memoryKind,
  hardDeleteAtMs,
  guestResetSession,
) {
  const turn = await stub.beginModelTurn({
    requestStartedAt,
    sessionIssuedAtMs,
    hardDeleteAtMs,
  });
  if (!turn?.acquired) {
    if (
      [
        "memory_deleted",
        "session_revoked",
        "session_expired",
        "invalid_storage_deadline",
      ].includes(turn?.reason)
    ) {
      const details = {
        reload: true,
      };
      if (memoryKind === "guest" && guestResetSession) {
        details.resetGuest = true;
        details.guestResetGrant = await createGuestResetGrant(
          guestResetSession,
          env,
        );
      }
      throw new HttpError(
        409,
        COPY.api.sessionChanged || "Your conversation changed. Reload and try again.",
        details,
      );
    }
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
    const task = recordFixedRoute(
      stub,
      currentRoute,
      currentFixed,
      requestStartedAt,
      sessionIssuedAtMs,
      hardDeleteAtMs,
    );
    if (!schedule(ctx, task)) void task;
    return { fixed: currentFixed, route: currentRoute };
  }

  try {
    const messages = modelInput(memory, latestText);
    const reply = await generateReply(
      messages,
      currentRoute || route,
      env,
      latestText,
    );
    const result = await stub.commitModelTurn({
      ...lease,
      sessionIssuedAtMs,
      hardDeleteAtMs,
      exchange: {
        user: latestText,
        assistant: reply,
        awaitingSafetyAnswer: false,
      },
    });
    if (!result?.committed) {
      const terminalGuestFailure = [
        "memory_deleted",
        "session_revoked",
        "session_expired",
        "invalid_storage_deadline",
      ].includes(result?.reason);
      const details = { reload: true };
      if (memoryKind === "guest" && terminalGuestFailure && guestResetSession) {
        details.resetGuest = true;
        details.guestResetGrant = await createGuestResetGrant(
          guestResetSession,
          env,
        );
      }
      throw new HttpError(
        409,
        COPY.api.sessionChanged || "Conversation state changed. Try again.",
        details,
      );
    }
    return { reply, result, memory, route: currentRoute || route };
  } catch (error) {
    const task = stub.releaseModelTurn(lease).catch((releaseError) => {
      console.error(
        JSON.stringify({
          event: "model_turn_release_failed",
          error:
            releaseError instanceof Error ? releaseError.name : "UnknownError",
        }),
      );
    });
    if (!schedule(ctx, task)) void task;
    throw error;
  }
}

async function recordDirectFixedRoute(
  request,
  body,
  route,
  fixed,
  env,
  requestStartedAt,
) {
  try {
    const authSession = await readAuthorizedAuthSession(request, env);
    const guestSession = await readGuestSession(request, env);
    const resolved = resolveContinuity(body, authSession, guestSession);
    const stub = sessionMemoryStub(
      env,
      resolved.memoryKind,
      resolved.memoryKey,
    );
    return await recordFixedRoute(
      stub,
      route,
      fixed,
      requestStartedAt,
      resolved.sessionIssuedAtMs,
      resolved.hardDeleteAtMs,
    );
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error(
        JSON.stringify({
          event: "fixed_route_session_validation_failed",
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }
    return false;
  }
}

async function handleChat(
  request,
  env,
  ctx,
  authSession,
  guestSession,
  parsedBody = null,
) {
  const requestStartedAt = captureRequestStartedAt(request);
  const body = parsedBody || (await readBoundedJson(request));
  const latestText = validatedLatestUserText(body);

  const resolved = resolveContinuity(body, authSession, guestSession);
  const { continuity } = resolved;
  const stub = sessionMemoryStub(
    env,
    resolved.memoryKind,
    resolved.memoryKey,
  );
  const sessionIssuedAtMs = resolved.sessionIssuedAtMs;
  const clientAwaiting = body?.awaitingSafetyAnswer === true;
  let route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting,
  });
  let fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(
      stub,
      route,
      fixed,
      requestStartedAt,
      sessionIssuedAtMs,
      resolved.hardDeleteAtMs,
    );
    if (!schedule(ctx, task)) void task;
    return jsonResponse({ route, ...fixed, continuity });
  }

  let reply;
  let result;
  if (stub && typeof stub.beginModelTurn === "function") {
    const modelResult = await modelBackedReply(
      stub,
      route,
      env,
      latestText,
      clientAwaiting,
      ctx,
      requestStartedAt,
      sessionIssuedAtMs,
      resolved.memoryKind,
      resolved.hardDeleteAtMs,
      resolved.memoryKind === "guest" ? guestSession : null,
    );
    if (modelResult.fixed) {
      return jsonResponse({
        route: modelResult.route,
        ...modelResult.fixed,
        continuity,
      });
    }
    ({ reply, result, route } = modelResult);
  } else {
    const memory = await readMemoryContext(stub);
    route = classifyInput(latestText, {
      awaitingSafetyAnswer: clientAwaiting || memory.awaitingSafetyAnswer,
    });
    fixed = fixedReplyForRoute(route);

    if (fixed) {
      const task = recordFixedRoute(
        stub,
        route,
        fixed,
        requestStartedAt,
        sessionIssuedAtMs,
        resolved.hardDeleteAtMs,
      );
      if (!schedule(ctx, task)) void task;
      return jsonResponse({ route, ...fixed, continuity });
    }

    const messages = modelInput(memory, latestText);
    if (!messages.length) {
      throw new HttpError(400, COPY.api.invalidConversation);
    }
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

function authNotice(code, memoryCode, signedIn, memoryDeletionConfirmation) {
  if (memoryDeletionConfirmation?.confirmed === true) {
    return COPY.page.auth.memoryDeleted;
  }
  if (memoryCode === "session-changed") {
    return COPY.page.auth.memorySessionChanged;
  }
  if (code === "cancelled") return COPY.page.auth.cancelled;
  if (code === "failed") return COPY.page.auth.failed;
  return "";
}

function appendRetiredCookieCleanup(
  headers,
  request,
) {
  if (readCookie(request, LEGACY_SESSION_COOKIE_NAME)) {
    headers.append("Set-Cookie", clearLegacySessionCookie(request));
  }
}

function sameOriginOrNonBrowser(request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return false;
  }
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function sameOriginBrowserRequest(request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    origin === new URL(request.url).origin &&
    (!fetchSite || fetchSite === "same-origin")
  );
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const requestStartedAt = captureRequestStartedAt(request);

    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (!["GET", "HEAD"].includes(request.method)) {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }

        // Legacy cookies keep their fixed sunset. Passive GET responses must
        // never mint a randomized replacement that could arrive after a newer
        // login or deletion rotation and overwrite that winning cookie.
        const authSession = await readAuthorizedAuthSession(request, env);
        const guestResolution = await resolveGuestSession(request, env, {
          createIfMissing: !authSession,
        });
        const guestSession = guestResolution.session;
        const memorySession = authSession || guestSession;
        const memoryDeletionConfirmation = await readMemoryDeletionReceipt(
          request,
          memorySession,
          env,
        );
        const headers = pageHeaders();
        headers.set(
          ACCOUNT_STATE_HEADER,
          authSession ? "account" : "guest",
        );
        appendRetiredCookieCleanup(headers, request);
        if (guestResolution.setCookie) {
          headers.append("Set-Cookie", guestResolution.setCookie);
        }
        return new Response(
          request.method === "HEAD"
            ? null
            : renderPage({
                signedIn: Boolean(authSession),
                continuity: continuityForSessions(authSession, guestSession),
                memoryDeletionConfirmation,
                googleSignInAvailable: googleAuthConfigured(env),
                authNotice: authNotice(
                  url.searchParams.get("auth"),
                  url.searchParams.get("memory"),
                  Boolean(authSession),
                  memoryDeletionConfirmation,
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
        // Status checks are read-only for the same response-order reason as
        // the root page: cookie changes belong to explicit user actions.
        const authSession = await readAuthorizedAuthSession(request, env);
        const guestResolution = await resolveGuestSession(request, env, {
          createIfMissing: false,
        });
        const guestSession = guestResolution.session;
        const selectedContinuity = continuityForSessions(
          authSession,
          guestSession,
        );
        const response = jsonResponse(
          {
            signedIn: Boolean(authSession),
            memory: Boolean(
              selectedContinuity.token &&
                (selectedContinuity.mode === "account"
                  ? env.SESSIONS
                  : env.GUEST_SESSIONS),
            ),
            google: googleAuthConfigured(env),
            continuity: selectedContinuity,
          },
          200,
        );
        if (guestResolution.setCookie) {
          response.headers.append("Set-Cookie", guestResolution.setCookie);
        }
        return response;
      }

      if (url.pathname === "/api/health") {
        if (request.method !== "GET") {
          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
        }
        const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
        const modelConfigured =
          demoMode || Boolean(String(env.OPENAI_API_KEY || ""));
        const memoryConfigured = Boolean(
          env?.SESSIONS &&
            typeof env.SESSIONS.getByName === "function" &&
            env?.GUEST_SESSIONS &&
            typeof env.GUEST_SESSIONS.getByName === "function" &&
            guestSessionConfigured(env),
        );
        const configured = modelConfigured && memoryConfigured;
        return jsonResponse(
          {
            ok: configured,
            mode: demoMode ? "demo" : "openai",
            model: demoMode ? null : String(env.OPENAI_MODEL || "gpt-5.6-sol"),
            aiFeature: demoMode ? null : "responses",
            reasoningEffort: demoMode
              ? null
              : String(env.OPENAI_REASONING_EFFORT || "max"),
            verbosity: demoMode ? null : "low",
            memory: memoryConfigured,
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
        const cryptographicAuthSession = await readAuthSession(request, env);
        if (!cryptographicAuthSession && !sameOriginBrowserRequest(request)) {
          return jsonResponse({ error: COPY.api.crossOriginRequest }, 403);
        }
        const body = await readBoundedJson(request);
        const latestText = validatedLatestUserText(body);
        const directRoute = classifyInput(latestText, {
          awaitingSafetyAnswer: body?.awaitingSafetyAnswer === true,
        });
        const directFixed = fixedReplyForRoute(directRoute);
        if (directFixed) {
          const continuity = requestedContinuity(body);
          const task = recordDirectFixedRoute(
            request,
            body,
            directRoute,
            directFixed,
            env,
            requestStartedAt,
          );
          if (!schedule(ctx, task)) void task;
          return jsonResponse({
            route: directRoute,
            ...directFixed,
            continuity,
          });
        }
        const authSession =
          cryptographicAuthSession &&
          (await accountSessionAllowed(env, cryptographicAuthSession))
            ? cryptographicAuthSession
            : null;
        const guestSession = await readGuestSession(request, env);
        return await handleChat(
          request,
          env,
          ctx,
          authSession,
          guestSession,
          body,
        );
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
        const stub = accountMemoryStub(env, authSession.accountKey);
        if (!(await accountSessionAllowed(env, authSession))) {
          return new Response(null, {
            status: 303,
            headers: pageHeaders("text/plain; charset=utf-8", {
              Location: "/?memory=session-changed",
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
        if (!stub || typeof stub.eraseMemory !== "function") {
          return new Response(COPY.api.temporarilyUnavailable, {
            status: 503,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        const deletion = await stub.eraseMemory(authSession.issuedAtMs);
        if (deletion?.erased === false && deletion.reason === "session_revoked") {
          return new Response(null, {
            status: 303,
            headers: pageHeaders("text/plain; charset=utf-8", {
              Location: "/?memory=session-changed",
            }),
          });
        }
        const nextSessionIssuedAtMs = Number(
          deletion?.nextSessionIssuedAtMs,
        );
        if (
          !deletion?.erased ||
          !Number.isSafeInteger(nextSessionIssuedAtMs)
        ) {
          throw new Error("InvalidMemoryDeletionResult");
        }
        const rotatedSession = await rotateAuthSession(
          request,
          env,
          authSession,
          nextSessionIssuedAtMs,
        );
        const receiptCookie = await createMemoryDeletionReceiptCookie(
          request,
          rotatedSession.session,
          env,
          Date.now(),
          authSession.continuityToken,
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

      if (url.pathname === "/guest/session/reset") {
        if (request.method !== "POST") {
          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
        }
        if (!sameOriginBrowserRequest(request)) {
          return jsonResponse({ error: COPY.api.crossOriginRequest }, 403);
        }
        if (await readAuthorizedAuthSession(request, env)) {
          return new Response(null, { status: 204, headers: apiHeaders() });
        }
        const guestSession = await readGuestSession(request, env);
        const form = await readBoundedForm(request);
        const suppliedContinuity = form.getAll("continuity");
        const suppliedGrant = form.getAll("grant");
        if (
          !guestSession ||
          suppliedContinuity.length !== 1 ||
          suppliedContinuity[0] !== guestSession.continuityToken ||
          suppliedGrant.length !== 1 ||
          !(await readGuestResetGrant(
            suppliedGrant[0],
            guestSession,
            env,
          ))
        ) {
          return new Response(null, { status: 204, headers: apiHeaders() });
        }
        const replacement = await createGuestSession(request, env);
        return new Response(null, {
          status: 204,
          headers: apiHeaders({ "Set-Cookie": replacement.setCookie }),
        });
      }

      if (url.pathname === "/guest/memory/delete") {
        if (request.method !== "POST") {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        if (!sameOriginBrowserRequest(request)) {
          return new Response(COPY.api.crossOriginRequest, {
            status: 403,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        if (await readAuthorizedAuthSession(request, env)) {
          return new Response(null, {
            status: 303,
            headers: pageHeaders("text/plain; charset=utf-8", {
              Location: "/?memory=session-changed",
            }),
          });
        }
        const guestSession = await readGuestSession(request, env);
        if (!guestSession) {
          return new Response(null, {
            status: 303,
            headers: pageHeaders("text/plain; charset=utf-8", {
              Location: "/?memory=session-changed",
            }),
          });
        }
        const stub = guestMemoryStub(env, guestSession.guestKey);
        const form = await readBoundedForm(request);
        const suppliedContinuity = form.getAll("continuity");
        if (
          suppliedContinuity.length !== 1 ||
          suppliedContinuity[0] !== guestSession.continuityToken
        ) {
          return new Response(null, {
            status: 303,
            headers: pageHeaders("text/plain; charset=utf-8", {
              Location: "/?memory=session-changed",
            }),
          });
        }
        if (!stub || typeof stub.eraseMemory !== "function") {
          return new Response(COPY.api.temporarilyUnavailable, {
            status: 503,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }
        const deletion = await stub.eraseMemory(
          guestSession.issuedAtMs,
          guestSession.expiresAt * 1_000,
        );
        const deletionConfirmed =
          deletion?.erased === true ||
          ["session_revoked", "session_expired"].includes(deletion?.reason);
        if (!deletionConfirmed) {
          throw new Error("InvalidGuestMemoryDeletionResult");
        }
        const replacement = await createGuestSession(request, env);
        const receiptCookie = await createMemoryDeletionReceiptCookie(
          request,
          replacement.session,
          env,
          Date.now(),
          guestSession.continuityToken,
        );
        const headers = pageHeaders("text/plain; charset=utf-8", {
          Location: "/",
        });
        headers.append("Set-Cookie", replacement.setCookie);
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
        const details = { ...(error.details || {}) };
        delete details.clearAuth;
        return jsonResponse(
          { error: error.message, ...details },
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

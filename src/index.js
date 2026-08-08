import { COPY } from "./copy.js";
import {
  AUTH_COOKIE_NAME,
  GoogleAuthConfigurationError,
  LEGACY_SESSION_COOKIE_NAME,
  beginGoogleSignIn,
  clearAuthCookie,
  clearLegacySessionCookie,
  completeGoogleSignIn,
  googleAuthConfigured,
  readAuthSession,
  signOut,
} from "./auth.js";
import { renderPage } from "./page.js";
import { classifyInput, fixedReplyForRoute } from "./safety.js";
import { selectReasoningEffort } from "./reasoning-policy.js";
import { SessionMemory } from "./session-memory.js";

export { SessionMemory };

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
const OPENAI_SERVICE_TIERS = new Set(["default", "priority", "fast"]);
const PROMPT_CACHE_KEY = "stabilize-floor-first-v1";
const ORDINARY_OUTPUT_TOKEN_LIMIT = 360;
const LONG_FORM_OUTPUT_TOKEN_LIMIT = 900;
const LONG_FORM_REQUEST_PATTERN =
  /\b(?:draft|write|rewrite|compose|email|letter|memo|report|speech|proposal|brief|document|essay|code|script|full version|detailed|comprehensive)\b/i;
const OPENAI_ACCOUNT_LIMIT_CODES = new Set([
  "credit_balance_exhausted",
  "insufficient_quota",
  "organization_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "project_spend_limit_exceeded",
]);
const PROVIDER_FIELD_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const FAVICON_CONTENT_TYPES = new Map([
  ["/favicon.ico", "image/x-icon"],
  ["/favicon.svg", "image/svg+xml; charset=utf-8"],
  ["/favicon-16x16.png", "image/png"],
  ["/favicon-32x32.png", "image/png"],
  ["/apple-touch-icon.png", "image/png"],
  ["/stabilize-tab-20260805.ico", "image/x-icon"],
  ["/stabilize-tab-20260805-16.png", "image/png"],
  ["/stabilize-tab-20260805-32.png", "image/png"],
  ["/stabilize-app-20260805-180.png", "image/png"],
  ["/safari-pinned-tab.svg", "image/svg+xml; charset=utf-8"],
  ["/site.webmanifest", "application/manifest+json; charset=utf-8"],
]);

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
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

class OpenAIRequestError extends Error {
  constructor({
    name,
    failure,
    status = 0,
    code = null,
    type = null,
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

async function faviconAssetResponse(request, env, contentType) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response(COPY.api.methodNotAllowed, {
      status: 405,
      headers: pageHeaders("text/plain; charset=utf-8"),
    });
  }

  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok) return asset;

  const headers = new Headers(asset.headers);
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(request.method === "HEAD" ? null : asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
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

export function emptyMemoryContext() {
  return {
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
  };
}

export function accountMemoryStub(env, accountKey) {
  if (!accountKey) return null;
  if (!env?.SESSIONS || typeof env.SESSIONS.getByName !== "function") return null;
  return env.SESSIONS.getByName("google:" + accountKey);
}

export async function readMemoryContext(stub) {
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

export async function readBoundedJson(request) {
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

function privateModelInput(messages, latestText) {
  const normalized = normalizeMessages(messages);
  const latest = normalized.at(-1);
  if (
    latest?.role === "user" &&
    latest.content === latestText
  ) {
    return normalized;
  }
  return normalizeMessages([
    ...normalized,
    { role: "user", content: latestText },
  ]);
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

function requestedReasoningEffort(body, model, fallbackEffort) {
  const effort = String(
    body?.reasoningEffort || fallbackEffort || "none",
  )
    .trim()
    .toLowerCase();
  if (!OPENAI_REASONING_EFFORTS.has(effort)) return "none";
  return effectiveReasoningEffort(String(model || ""), effort);
}

function reasoningEnvironment(env, effort) {
  const selected = OPENAI_REASONING_EFFORTS.has(effort) ? effort : "none";
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "OPENAI_REASONING_EFFORT") return selected;
      return Reflect.get(target, property, receiver);
    },
  });
}

function supportsExplicitPromptCaching(model) {
  const match = /^gpt-(\d+)\.(\d+)/.exec(String(model || ""));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 5 || (major === 5 && minor >= 6);
}

function interactiveOutputTokenLimit(latestText, reasoningEffort) {
  if (reasoningEffort !== "none") return null;
  return LONG_FORM_REQUEST_PATTERN.test(String(latestText || ""))
    ? LONG_FORM_OUTPUT_TOKEN_LIMIT
    : ORDINARY_OUTPUT_TOKEN_LIMIT;
}

function interactivePrompt(model, route, messages) {
  const stableInstructions = COPY.model.systemPrompt;
  const variableInstructions =
    COPY.model.memoryInstruction +
    "\n\n" +
    COPY.model.routeInstruction(route);

  if (!supportsExplicitPromptCaching(model)) {
    return {
      instructions: stableInstructions + "\n\n" + variableInstructions,
      input: messages,
    };
  }

  return {
    prompt_cache_key: PROMPT_CACHE_KEY,
    prompt_cache_options: { mode: "explicit", ttl: "30m" },
    input: [
      {
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text: stableInstructions,
            prompt_cache_breakpoint: { mode: "explicit" },
          },
          {
            type: "input_text",
            text: "\n\n" + variableInstructions,
          },
        ],
      },
      ...messages,
    ],
  };
}

function chatRequestPayload({
  model,
  reasoningEffort,
  serviceTier,
  route,
  messages,
  latestText,
}) {
  const outputLimit = interactiveOutputTokenLimit(
    latestText,
    reasoningEffort,
  );
  return {
    model,
    service_tier: serviceTier,
    reasoning: { effort: reasoningEffort },
    ...(outputLimit ? { max_output_tokens: outputLimit } : {}),
    text: { verbosity: "low" },
    ...interactivePrompt(model, route, messages),
    store: true,
  };
}

function usageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function logInteractiveUsage(result, model, requestedServiceTier) {
  const usage = result?.usage || {};
  const inputDetails = usage.input_tokens_details || {};
  console.info(
    JSON.stringify({
      event: "openai_chat_usage",
      model: String(model || "").slice(0, 128),
      requestedServiceTier,
      actualServiceTier: safeProviderField(result?.serviceTier),
      inputTokens: usageNumber(usage.input_tokens),
      cachedTokens: usageNumber(inputDetails.cached_tokens),
      cacheWriteTokens: usageNumber(inputDetails.cache_write_tokens),
      outputTokens: usageNumber(usage.output_tokens),
    }),
  );
}

function openAIConfig(env) {
  const apiKey = String(env.OPENAI_API_KEY || "");
  if (!apiKey) {
    const error = new Error("OpenAI is not configured");
    error.name = "MissingOpenAIKey";
    throw error;
  }

  const model = String(env.OPENAI_MODEL || "gpt-5.4");
  const requestedReasoningEffort = String(
    env.OPENAI_REASONING_EFFORT || "none",
  );
  const serviceTier = String(env.OPENAI_SERVICE_TIER || "fast")
    .trim()
    .toLowerCase();
  if (
    !/^[A-Za-z0-9._:-]+$/.test(model) ||
    !OPENAI_REASONING_EFFORTS.has(requestedReasoningEffort) ||
    !OPENAI_SERVICE_TIERS.has(serviceTier)
  ) {
    const error = new Error("OpenAI configuration is invalid");
    error.name = "InvalidOpenAIConfiguration";
    throw error;
  }

  const reasoningEffort = effectiveReasoningEffort(
    model,
    requestedReasoningEffort,
  );
  return { apiKey, model, reasoningEffort, serviceTier };
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
    return { code: null, type: null };
  }
  return {
    code: safeProviderField(providerError.code),
    type: safeProviderField(providerError.type),
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

function chatErrorResponse(error, path) {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.status);
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
        providerRequestId: error.providerRequestId,
        clientRequestId: error.clientRequestId,
        retryAfterSeconds: error.retryAfterSeconds,
        reference,
        path,
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
      path,
    }),
  );
  return jsonResponse(
    { error: COPY.api.temporarilyUnavailable, reference },
    503,
  );
}

async function callOpenAI(payload, apiKey, timeoutMs, errorName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const clientRequestId = crypto.randomUUID();

  let response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "X-Client-Request-Id": clientRequestId,
      },
      body: JSON.stringify(payload),
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
      providerRequestId,
      clientRequestId,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    });
  }

  return {
    text: responseText(responseBody),
    usage: responseBody?.usage || null,
    serviceTier: safeProviderField(responseBody?.service_tier),
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

function streamHeaders() {
  return apiHeaders({
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "X-Accel-Buffering": "no",
  });
}

function streamEvent(value) {
  return new TextEncoder().encode(JSON.stringify(value) + "\n");
}

async function openAIStream(payload, apiKey, timeoutMs, errorName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const clientRequestId = crypto.randomUUID();

  let response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "X-Client-Request-Id": clientRequestId,
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    throw new OpenAIRequestError({
      name: errorName,
      failure: controller.signal.aborted ? "timeout" : "connection",
      clientRequestId,
    });
  }

  const providerRequestId = safeProviderField(
    response.headers.get("x-request-id"),
  );
  if (!response.ok) {
    clearTimeout(timeout);
    const responseBody = await response.json().catch(() => ({}));
    const fields = providerErrorFields(responseBody);
    throw new OpenAIRequestError({
      name: errorName,
      failure: "http",
      status: response.status,
      code: fields.code,
      type: fields.type,
      providerRequestId,
      clientRequestId,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    });
  }

  return { response, controller, timeout, providerRequestId, clientRequestId, usage: null, serviceTier: null };
}

function streamFailureDiagnostic(error) {
  if (error instanceof OpenAIRequestError) {
    return {
      category: String(error.failure || "request").slice(0, 40),
      status: Number.isFinite(error.status) ? error.status : null,
      code: safeProviderField(error.code),
      type: safeProviderField(error.type),
      name: String(error.name || "OpenAIRequestError").slice(0, 60),
    };
  }
  return {
    category: "runtime",
    status: null,
    code: null,
    type: null,
    name: String(error instanceof Error ? error.name : "UnknownError").slice(0, 60),
  };
}

function parseOpenAIStreamEvent(eventBlock, result) {
  const lines = String(eventBlock || "").split(/\r\n|\n|\r/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  const data = (dataLines.length ? dataLines.join("\n") : eventBlock).trim();
  if (!data || data === "[DONE]") return null;

  try {
    return JSON.parse(data);
  } catch {
    throw new OpenAIRequestError({
      name: "OpenAIStreamParseError",
      failure: "invalid_output",
      status: 502,
      code: "invalid_sse_event",
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }
}

function streamEventText(event, result) {
  if (event?.response?.usage) result.usage = event.response.usage;
  const actualTier = safeProviderField(event?.response?.service_tier);
  if (actualTier) result.serviceTier = actualTier;
  if (
    event?.type === "response.output_text.done" &&
    typeof event.text === "string"
  ) {
    return event.text;
  }
  if (
    ["response.completed", "response.incomplete"].includes(event?.type)
  ) {
    return responseText(event.response);
  }
  return "";
}

function throwForFailedStreamEvent(event, result) {
  if (!["response.failed", "error"].includes(event?.type)) return;
  const failure = event?.response?.error || event?.error || {};
  throw new OpenAIRequestError({
    name: "OpenAIHttpError",
    failure: "http",
    status: 502,
    code: safeProviderField(failure.code),
    type: safeProviderField(failure.type),
    providerRequestId: result.providerRequestId,
    clientRequestId: result.clientRequestId,
  });
}

async function* openAITextDeltas(result) {
  if (!result.response.body) {
    throw new OpenAIRequestError({
      name: "OpenAIInvalidReplyError",
      failure: "invalid_output",
      status: 502,
      code: "missing_stream_body",
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }

  const reader = result.response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedText = "";
  let finalText = "";
  let incompleteReason = null;

  const consume = (eventBlock) => {
    const event = parseOpenAIStreamEvent(eventBlock, result);
    if (!event) return null;
    throwForFailedStreamEvent(event, result);

    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      return event.delta;
    }

    const eventText = streamEventText(event, result);
    if (eventText) finalText = eventText;
    if (event.type === "response.incomplete") {
      incompleteReason = safeProviderField(
        event.response?.incomplete_details?.reason,
      ) || "response_incomplete";
    }
    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r\n\r\n|\n\n|\r\r/);
      buffer = events.pop() || "";

      for (const eventBlock of events) {
        const delta = consume(eventBlock);
        if (!delta) continue;
        emittedText += delta;
        yield delta;
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const delta = consume(buffer);
      if (delta) {
        emittedText += delta;
        yield delta;
      }
    }

    if (!emittedText && finalText) {
      emittedText = finalText;
      yield finalText;
    }

    if (!emittedText) {
      throw new OpenAIRequestError({
        name: "OpenAIInvalidReplyError",
        failure: "invalid_output",
        status: 502,
        code: incompleteReason || "empty_stream",
        providerRequestId: result.providerRequestId,
        clientRequestId: result.clientRequestId,
      });
    }
  } finally {
    clearTimeout(result.timeout);
    try {
      reader.releaseLock();
    } catch {
      // The provider or client may already have closed the stream.
    }
  }
}

function shouldUseNonStreamingFallback(error) {
  if (!(error instanceof OpenAIRequestError)) return true;
  if (OPENAI_ACCOUNT_LIMIT_CODES.has(error.code)) return false;
  if (error.type === "insufficient_quota") return false;
  if ([401, 403, 404, 429].includes(error.status)) return false;
  if (error.failure === "timeout") return false;
  return true;
}

async function generateFallbackReply(messages, route, env, latestText) {
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
  return reply;
}

async function writeReplyDeltas(writer, text) {
  const chunks = String(text || "").match(/\S+\s*/g) || [String(text || "")];
  for (const delta of chunks) {
    if (!delta) continue;
    await writer.write(streamEvent({ type: "delta", delta }));
  }
}

function streamChatReply(messages, route, env, latestText, stub, ctx) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const produce = async () => {
    let reply = "";
    try {
      await writer.write(
        streamEvent({
          type: "meta",
          route,
          reasoningEffort: String(
            env.OPENAI_REASONING_EFFORT || "none",
          ),
        }),
      );
      const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";

      if (demoMode) {
        const demo = demoReply(route, latestText);
        reply = demo;
        await writeReplyDeltas(writer, demo);
      } else {
        try {
          const { apiKey, model, reasoningEffort, serviceTier } =
            openAIConfig(env);
          const turnReasoningEffort = reasoningEffort;
          const result = await openAIStream(
            chatRequestPayload({
              model,
              reasoningEffort: turnReasoningEffort,
              serviceTier,
              route,
              messages,
              latestText,
            }),
            apiKey,
            60_000,
            "OpenAIHttpError",
          );

          for await (const delta of openAITextDeltas(result)) {
            reply += delta;
            await writer.write(streamEvent({ type: "delta", delta }));
          }
          logInteractiveUsage(result, model, serviceTier);
        } catch (streamError) {
          if (reply || !shouldUseNonStreamingFallback(streamError)) {
            throw streamError;
          }

          console.warn(
            JSON.stringify({
              event: "openai_stream_fallback_used",
              route,
              diagnostic: streamFailureDiagnostic(streamError),
            }),
          );
          reply = await generateFallbackReply(messages, route, env, latestText);
          await writeReplyDeltas(writer, reply);
        }
      }

      let validated = validateModelReply(reply);
      if (
        validated &&
        route === "ORDINARY" &&
        typeof isNeutralGreeting === "function" &&
        typeof isUnsolicitedSafetyCheck === "function" &&
        isNeutralGreeting(latestText) &&
        isUnsolicitedSafetyCheck(validated)
      ) {
        validated = "Hi. What’s happening right now?";
      }
      if (!validated) {
        throw new OpenAIRequestError({
          name: "OpenAIInvalidReplyError",
          failure: "invalid_output",
          status: 502,
          code: "invalid_validated_reply",
          clientRequestId: crypto.randomUUID(),
        });
      }

      const recordResult = await recordExchange(stub, {
        user: latestText,
        assistant: validated,
        awaitingSafetyAnswer: false,
      });
      if (recordResult?.shouldCompact && stub && ctx) {
        schedule(ctx, compactSession(stub, env));
      }

      await writer.write(
        streamEvent({
          type: "done",
          route,
          reply: validated,
          showEmergency: false,
          awaitingSafetyAnswer: false,
        }),
      );
    } catch (error) {
      const diagnostic = streamFailureDiagnostic(error);
      const clientRequestId =
        error instanceof OpenAIRequestError
          ? error.clientRequestId
          : crypto.randomUUID();
      const reference = errorReference(clientRequestId);
      console.error(
        JSON.stringify({
          event: "openai_stream_failed",
          route,
          diagnostic,
          reference,
        }),
      );

      const publicError =
        error instanceof OpenAIRequestError
          ? publicOpenAIError(error)
          : { message: COPY.api.temporarilyUnavailable };
      try {
        await writer.write(
          streamEvent({
            type: "error",
            error: publicError.message,
            reference,
            diagnostic,
          }),
        );
      } catch {
        // The browser may have left while the provider request was running.
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // Closing an already-aborted browser stream is harmless.
      }
    }
  };

  const task = produce();
  if (!schedule(ctx, task)) void task;
  return new Response(readable, { status: 200, headers: streamHeaders() });
}

async function generateReply(messages, route, env, latestText) {
  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
  if (demoMode) return demoReply(route, latestText);

  const { apiKey, model, reasoningEffort } = openAIConfig(env);
  const turnReasoningEffort = reasoningEffort;
  const result = await callOpenAI(
    {
      model,
      reasoning: { effort: turnReasoningEffort },
      ...(turnReasoningEffort === "none"
        ? { max_output_tokens: 500 }
        : {}),
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
    {
      model,
      reasoning: { effort: "low" },
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
  if (!stub || typeof stub.recordExchange !== "function") return null;
  try {
    return await stub.recordExchange(exchange);
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
  await recordExchange(stub, {
    user:
      FIXED_ROUTE_MEMORY[route] ||
      "[A deterministic support route triggered a fixed response.]",
    assistant: fixed.reply,
    awaitingSafetyAnswer: fixed.awaitingSafetyAnswer === true,
  });
}

async function handleNewConversation(request, env, accountKey) {
  const body = await readBoundedJson(request);
  if (body?.privateChat !== true) {
    const stub = accountMemoryStub(env, accountKey);
    if (stub && typeof stub.startNewConversation === "function") {
      await stub.startNewConversation();
    }
  }
  return jsonResponse({ ok: true });
}

export async function handlePreparedChat(
  request,
  env,
  ctx,
  accountKey,
  body,
  preparedMemory = null,
) {
  env = reasoningEnvironment(
    env,
    requestedReasoningEffort(
      body,
      env.OPENAI_MODEL,
      env.OPENAI_REASONING_EFFORT,
    ),
  );
  const privateChat = body?.privateChat === true;
  const latestText = latestUserText(body);
  if (!latestText) throw new HttpError(400, COPY.api.messageRequired);
  if (latestText.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, COPY.api.messageTooLong);
  }

  const stub = privateChat ? null : accountMemoryStub(env, accountKey);
  const clientAwaiting = body?.awaitingSafetyAnswer === true;
  let route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting,
  });
  let fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(stub, route, fixed);
    if (!schedule(ctx, task)) await task;
    return jsonResponse({ route, ...fixed });
  }

  const memory = privateChat
    ? emptyMemoryContext()
    : preparedMemory || (await readMemoryContext(stub));

  route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting || memory.awaitingSafetyAnswer,
  });
  fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(stub, route, fixed);
    if (!schedule(ctx, task)) await task;
    return jsonResponse({ route, ...fixed });
  }

  const messages = privateChat
    ? privateModelInput(body?.messages, latestText)
    : modelInput(memory, latestText);
  if (!messages.length) throw new HttpError(400, COPY.api.invalidConversation);

  const acceptsStreaming = (request.headers.get("accept") || "")
    .toLowerCase()
    .includes("application/x-ndjson");
  if (acceptsStreaming) {
    return streamChatReply(messages, route, env, latestText, stub, ctx);
  }

  const reply = await generateReply(messages, route, env, latestText);
  const result = await recordExchange(stub, {
    user: latestText,
    assistant: reply,
    awaitingSafetyAnswer: false,
  });

  if (result?.shouldCompact && stub && ctx) {
    schedule(ctx, compactSession(stub, env));
  }

  return jsonResponse({
    route,
    reply,
    showEmergency: false,
    awaitingSafetyAnswer: false,
  });
}

async function handleChat(request, env, ctx, accountKey) {
  const body = await readBoundedJson(request);
  return handlePreparedChat(request, env, ctx, accountKey, body);
}

export async function preparedChatResponse(
  request,
  body,
  env,
  ctx,
  accountKey,
  preparedMemory,
) {
  try {
    return await handlePreparedChat(
      request,
      env,
      ctx,
      accountKey,
      body,
      preparedMemory,
    );
  } catch (error) {
    return chatErrorResponse(error, new URL(request.url).pathname);
  }
}

function authNotice(code) {
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
      if (FAVICON_CONTENT_TYPES.has(url.pathname)) {
        return faviconAssetResponse(
          request,
          env,
          FAVICON_CONTENT_TYPES.get(url.pathname),
        );
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (!["GET", "HEAD"].includes(request.method)) {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }

        const authSession = await readAuthSession(request, env);
        const headers = pageHeaders();
        appendRetiredCookieCleanup(headers, request, authSession);
        return new Response(
          request.method === "HEAD"
            ? null
            : renderPage({
                signedIn: Boolean(authSession),
                googleSignInAvailable: googleAuthConfigured(env),
                authNotice: authNotice(url.searchParams.get("auth")),
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
        const authSession = await readAuthSession(request, env);
        return jsonResponse({
          signedIn: Boolean(authSession),
          memory: Boolean(authSession && env.SESSIONS),
          google: googleAuthConfigured(env),
        });
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
            model: demoMode ? null : String(env.OPENAI_MODEL || "gpt-5.4"),
            reasoningEffort: demoMode
              ? null
              : String(env.OPENAI_REASONING_EFFORT || "none"),
            verbosity: demoMode ? null : "low",
            memory: Boolean(env.SESSIONS),
            authentication: googleAuthConfigured(env),
          },
          configured ? 200 : 503,
        );
      }

      if (url.pathname === "/api/conversation/new") {
        if (request.method !== "POST") {
          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
        }
        if (!sameOriginOrNonBrowser(request)) {
          return jsonResponse({ error: COPY.api.crossOriginRequest }, 403);
        }
        const authSession = await readAuthSession(request, env);
        return await handleNewConversation(request, env, authSession?.accountKey);
      }

      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") {
          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
        }
        if (!sameOriginOrNonBrowser(request)) {
          return jsonResponse({ error: COPY.api.crossOriginRequest }, 403);
        }
        const authSession = await readAuthSession(request, env);
        return await handleChat(request, env, ctx, authSession?.accountKey);
      }

      if (url.pathname.startsWith("/api/")) {
        return jsonResponse({ error: COPY.api.notFound }, 404);
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse({ error: error.message }, error.status);
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

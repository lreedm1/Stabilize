import { COPY } from "./copy.js";
import { renderPage } from "./page.js";
import { classifyInput, fixedReplyForRoute } from "./safety.js";
import {
  SESSION_RETENTION_DAYS,
  SessionMemory,
} from "./session-memory.js";

export { SessionMemory };

const MAX_BODY_BYTES = 32_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_MESSAGES = 12;
const MAX_SUMMARY_CHARS = 1_600;
// OpenAI counts visible output, hidden reasoning, and formatting tokens here.
const MAX_MODEL_OUTPUT_TOKENS = 500;
const MAX_SUMMARY_OUTPUT_TOKENS = 500;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_REASONING_EFFORTS = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
]);
const SESSION_COOKIE_NAME = "stabilize_session";
const SESSION_COOKIE_MAX_AGE = SESSION_RETENTION_DAYS * 24 * 60 * 60;
const SESSION_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    "Cache-Control": "no-cache",
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

function getSessionToken(request) {
  const candidate = readCookie(request, SESSION_COOKIE_NAME);
  return SESSION_TOKEN_PATTERN.test(candidate || "")
    ? candidate
    : crypto.randomUUID();
}

function sessionCookie(request, token) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return (
    SESSION_COOKIE_NAME +
    "=" +
    token +
    "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" +
    SESSION_COOKIE_MAX_AGE +
    secure
  );
}

function sessionHeaders(request, token) {
  return { "Set-Cookie": sessionCookie(request, token) };
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

function sessionStub(env, token) {
  if (!env?.SESSIONS || typeof env.SESSIONS.getByName !== "function") return null;
  return env.SESSIONS.getByName(token);
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
  if (direct) return direct.slice(0, MAX_MESSAGE_CHARS);

  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  const latestUser = [...rawMessages]
    .reverse()
    .find((message) => message?.role === "user");
  return String(latestUser?.content || "").trim().slice(0, MAX_MESSAGE_CHARS);
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

function openAIConfig(env) {
  const apiKey = String(env.OPENAI_API_KEY || "");
  if (!apiKey) {
    const error = new Error("OpenAI is not configured");
    error.name = "MissingOpenAIKey";
    throw error;
  }

  const model = String(env.OPENAI_MODEL || "gpt-5.6-sol");
  const reasoningEffort = String(env.OPENAI_REASONING_EFFORT || "medium");
  if (
    !/^[A-Za-z0-9._:-]+$/.test(model) ||
    !OPENAI_REASONING_EFFORTS.has(reasoningEffort)
  ) {
    const error = new Error("OpenAI configuration is invalid");
    error.name = "InvalidOpenAIConfiguration";
    throw error;
  }

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

async function callOpenAI(payload, apiKey, timeoutMs, errorName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("OpenAI returned HTTP " + response.status);
    error.name = errorName;
    throw error;
  }

  return responseText(responseBody);
}

async function generateReply(messages, route, env, latestText) {
  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
  if (demoMode) return demoReply(route, latestText);

  const { apiKey, model, reasoningEffort } = openAIConfig(env);
  const text = await callOpenAI(
    {
      model,
      reasoning: { effort: reasoningEffort, context: "current_turn" },
      instructions:
        COPY.model.systemPrompt +
        "\n\n" +
        COPY.model.memoryInstruction +
        "\n\n" +
        COPY.model.routeInstruction(route),
      input: messages,
      max_output_tokens: MAX_MODEL_OUTPUT_TOKENS,
      store: false,
    },
    apiKey,
    60_000,
    "OpenAIHttpError",
  );

  return validateModelReply(text);
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
  const text = await callOpenAI(
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

  return sanitizeSummary(text) || null;
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

function bytesToHex(value) {
  return Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function requestAliases(request, env, token) {
  const secret = String(env.OPENAI_API_KEY || "");
  if (!secret) return { ipAlias: null, sessionAlias: null };

  const encoder = new TextEncoder();
  const derivedKey = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode("stabilize-session-aliases-v1\u0000" + secret),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    derivedKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const ip = String(request.headers.get("CF-Connecting-IP") || "").slice(0, 128);
  const values = [
    ip ? crypto.subtle.sign("HMAC", key, encoder.encode("ip\u0000" + ip)) : null,
    crypto.subtle.sign("HMAC", key, encoder.encode("session\u0000" + token)),
  ];
  const [ipSignature, sessionSignature] = await Promise.all(values);

  return {
    ipAlias: ipSignature ? bytesToHex(ipSignature).slice(0, 24) : null,
    sessionAlias: bytesToHex(sessionSignature).slice(0, 24),
  };
}

function logSessionEvent(aliases, memoryUsed, turnCount) {
  console.log(
    JSON.stringify({
      event: "chat_session",
      ipAlias: aliases.ipAlias,
      sessionAlias: aliases.sessionAlias,
      memoryUsed,
      turnCount,
    }),
  );
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
  request,
  env,
  stub,
  token,
  route,
  fixed,
  priorTurnCount,
) {
  const aliases = await requestAliases(request, env, token);
  const result = await recordExchange(stub, {
    user:
      FIXED_ROUTE_MEMORY[route] ||
      "[A deterministic support route triggered a fixed response.]",
    assistant: fixed.reply,
    awaitingSafetyAnswer: fixed.awaitingSafetyAnswer === true,
    ipAlias: aliases.ipAlias,
  });
  logSessionEvent(
    aliases,
    priorTurnCount > 0,
    result?.turnCount || priorTurnCount + 1,
  );
}

async function handleChat(request, env, ctx, token) {
  const body = await readBoundedJson(request);
  const latestText = latestUserText(body);
  if (!latestText) throw new HttpError(400, COPY.api.messageRequired);

  const stub = sessionStub(env, token);
  const clientAwaiting = body?.awaitingSafetyAnswer === true;
  let route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting,
  });
  let fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(
      request,
      env,
      stub,
      token,
      route,
      fixed,
      0,
    );
    if (!schedule(ctx, task)) await task;
    return jsonResponse({ route, ...fixed }, 200, sessionHeaders(request, token));
  }

  const [memory, aliases] = await Promise.all([
    readMemoryContext(stub),
    requestAliases(request, env, token),
  ]);

  route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting || memory.awaitingSafetyAnswer,
  });
  fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(
      request,
      env,
      stub,
      token,
      route,
      fixed,
      memory.turnCount,
    );
    if (!schedule(ctx, task)) await task;
    return jsonResponse({ route, ...fixed }, 200, sessionHeaders(request, token));
  }

  const messages = modelInput(memory, latestText);
  if (!messages.length) throw new HttpError(400, COPY.api.invalidConversation);

  const generated = await generateReply(messages, route, env, latestText);
  const reply = generated || COPY.api.unreliableReply;
  const result = await recordExchange(stub, {
    user: latestText,
    assistant: reply,
    awaitingSafetyAnswer: false,
    ipAlias: aliases.ipAlias,
  });

  logSessionEvent(
    aliases,
    Boolean(memory.summary || memory.recent.length),
    result?.turnCount || memory.turnCount + 1,
  );

  if (result?.shouldCompact && stub && ctx) {
    schedule(ctx, compactSession(stub, env));
  }

  return jsonResponse(
    {
      route,
      reply,
      showEmergency: false,
      awaitingSafetyAnswer: false,
    },
    200,
    sessionHeaders(request, token),
  );
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const token = getSessionToken(request);

    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (!["GET", "HEAD"].includes(request.method)) {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }

        return new Response(request.method === "HEAD" ? null : renderPage(), {
          headers: pageHeaders(
            "text/html; charset=utf-8",
            sessionHeaders(request, token),
          ),
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
            model: demoMode ? null : String(env.OPENAI_MODEL || "gpt-5.6-sol"),
            memory: Boolean(env.SESSIONS),
          },
          configured ? 200 : 503,
        );
      }

      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") {
          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
        }
        return await handleChat(request, env, ctx, token);
      }

      if (url.pathname.startsWith("/api/")) {
        return jsonResponse({ error: COPY.api.notFound }, 404);
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      const publicMessage =
        error instanceof HttpError
          ? error.message
          : COPY.api.temporarilyUnavailable;

      if (!(error instanceof HttpError)) {
        console.error(
          JSON.stringify({
            message: "request failed",
            error: error instanceof Error ? error.name : "UnknownError",
            path: url.pathname,
          }),
        );
      }

      return jsonResponse({ error: publicMessage }, status);
    }
  },
};

export default worker;

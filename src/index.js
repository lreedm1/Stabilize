import { COPY } from "./copy.js";
import { renderPage } from "./page.js";
import { classifyInput, fixedReplyForRoute } from "./safety.js";

const MAX_BODY_BYTES = 32_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_MESSAGES = 12;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function apiHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function pageHeaders(contentType = "text/html; charset=utf-8") {
  return {
    "Cache-Control": "no-cache",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: apiHeaders(),
  });
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

  const firstUserIndex = cleaned.findIndex((message) => message.role === "user");
  if (firstUserIndex < 0) return [];

  const alternating = [];
  for (const message of cleaned.slice(firstUserIndex)) {
    const previous = alternating.at(-1);
    if (previous?.role === message.role) {
      previous.text = `${previous.text}\n${message.text}`.slice(0, MAX_MESSAGE_CHARS);
    } else {
      alternating.push({ ...message });
    }
  }

  return alternating.map((message) => ({
    role: message.role,
    content: message.text,
  }));
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
  return text.slice(0, 2_500);
}

async function generateReply(messages, route, env) {
  const latestText = messages.at(-1)?.content || "";
  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
  if (demoMode) return demoReply(route, latestText);

  const apiKey = String(env.OPENAI_API_KEY || "");
  if (!apiKey) {
    const error = new Error("OpenAI is not configured");
    error.name = "MissingOpenAIKey";
    throw error;
  }

  const model = String(env.OPENAI_MODEL || "gpt-5.4-mini");
  const reasoningEffort = String(env.OPENAI_REASONING_EFFORT || "low");
  if (
    !/^[A-Za-z0-9._:-]+$/.test(model) ||
    !OPENAI_REASONING_EFFORTS.has(reasoningEffort)
  ) {
    const error = new Error("OpenAI configuration is invalid");
    error.name = "InvalidOpenAIConfiguration";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: reasoningEffort },
        instructions: `${COPY.model.systemPrompt}\n\n${COPY.model.routeInstruction(route)}`,
        input: messages,
        max_output_tokens: 650,
        store: false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`OpenAI returned HTTP ${response.status}`);
    error.name = "OpenAIHttpError";
    throw error;
  }

  const output = Array.isArray(responseBody?.output) ? responseBody.output : [];
  const text = output
    .filter((item) => item?.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((block) => block?.type === "output_text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return validateModelReply(text);
}

async function handleChat(request, env) {
  const body = await readBoundedJson(request);
  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  const latestUser = [...rawMessages]
    .reverse()
    .find((message) => message?.role === "user");
  const latestText = String(latestUser?.content || "").trim().slice(0, MAX_MESSAGE_CHARS);

  if (!latestText) throw new HttpError(400, COPY.api.messageRequired);

  const route = classifyInput(latestText, {
    awaitingSafetyAnswer: body?.awaitingSafetyAnswer === true,
  });

  const fixed = fixedReplyForRoute(route);
  if (fixed) return jsonResponse({ route, ...fixed });

  const messages = normalizeMessages(rawMessages);
  if (!messages.length) throw new HttpError(400, COPY.api.invalidConversation);

  const reply = await generateReply(messages, route, env);
  if (!reply) {
    return jsonResponse({
      route,
      reply: COPY.api.unreliableReply,
      showEmergency: false,
      awaitingSafetyAnswer: false,
    });
  }

  return jsonResponse({
    route,
    reply,
    showEmergency: false,
    awaitingSafetyAnswer: false,
  });
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (!["GET", "HEAD"].includes(request.method)) {
          return new Response(COPY.api.methodNotAllowed, {
            status: 405,
            headers: pageHeaders("text/plain; charset=utf-8"),
          });
        }

        return new Response(request.method === "HEAD" ? null : renderPage(), {
          headers: pageHeaders(),
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
            model: demoMode ? null : String(env.OPENAI_MODEL || "gpt-5.4-mini"),
          },
          configured ? 200 : 503,
        );
      }

      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") {
          return jsonResponse({ error: COPY.api.methodNotAllowed }, 405);
        }
        return await handleChat(request, env);
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

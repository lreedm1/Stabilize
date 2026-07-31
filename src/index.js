import { SYSTEM_PROMPT } from "./prompt.js";
import { classifyInput, fixedReplyForRoute } from "./safety.js";

const MAX_BODY_BYTES = 32_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_MESSAGES = 12;

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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: apiHeaders(),
  });
}

async function readBoundedJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request body is too large.");
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
        await reader.cancel("Request body is too large");
        throw new HttpError(413, "Request body is too large.");
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
    throw new HttpError(400, "Invalid JSON.");
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
    content: [{ text: message.text }],
  }));
}

function demoReply(route, latestText) {
  const text = latestText.toLowerCase();

  if (route === "LOW_SLEEP_URGENCY") {
    return "Low sleep can make a major decision feel falsely urgent. Write the decision in one sentence, set a time to review it after sleep, and do not act on it tonight unless safety, medical care, shelter, or another real deadline cannot wait.";
  }
  if (route === "FLOOR_FOOD") {
    return "Your body needs a vote before the rest of your life gets analyzed. Eat the easiest substantial thing you can get in the next ten minutes, even if it is not ideal. Afterward, notice whether the problem still feels as large.";
  }
  if (route === "FLOOR_REST") {
    return "Exhaustion is a poor time for a life verdict. Lower the input, put the decision down, and make rest the next task. If sleep is not available, sit somewhere quiet with your eyes closed for ten minutes.";
  }
  if (/\b(?:alone|lonely|nobody|no one)\b/.test(text)) {
    return "That sounds heavy to carry alone. Send one low-pressure message to a safe person: “I’m having a rough moment. Could you stay on the phone or sit with me for a bit?”";
  }
  return "This deployment is in demo mode, so it cannot answer open-ended questions yet. Make the problem one size smaller: choose body, connection, order, or direction, then take one action that lasts under ten minutes.";
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
  const latestText = messages.at(-1)?.content?.[0]?.text || "";
  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
  if (demoMode) return demoReply(route, latestText);

  const bedrockToken = String(env.AWS_BEARER_TOKEN_BEDROCK || "");
  if (!bedrockToken) {
    const error = new Error("Bedrock is not configured");
    error.name = "MissingBedrockToken";
    throw error;
  }

  const region = String(env.AWS_REGION || "us-east-1");
  const modelId = String(env.BEDROCK_MODEL_ID || "us.amazon.nova-2-lite-v1:0");
  if (!/^[a-z0-9-]+$/.test(region) || !/^[A-Za-z0-9._:-]+$/.test(modelId)) {
    const error = new Error("Bedrock configuration is invalid");
    error.name = "InvalidBedrockConfiguration";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/converse`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bedrockToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system: [
          {
            text: `${SYSTEM_PROMPT}\n\nThe application selected route ${route}. Follow it and never downgrade an urgent route.`,
          },
        ],
        messages,
        inferenceConfig: {
          maxTokens: 350,
          temperature: 0.4,
          topP: 0.9,
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Bedrock returned HTTP ${response.status}`);
    error.name = "BedrockHttpError";
    throw error;
  }

  const blocks = Array.isArray(responseBody?.output?.message?.content)
    ? responseBody.output.message.content
    : [];
  const text = blocks
    .filter((block) => typeof block?.text === "string")
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

  if (!latestText) throw new HttpError(400, "Please enter a message.");

  const route = classifyInput(latestText, {
    awaitingSafetyAnswer: body?.awaitingSafetyAnswer === true,
  });

  const fixed = fixedReplyForRoute(route);
  if (fixed) return jsonResponse({ route, ...fixed });

  const messages = normalizeMessages(rawMessages);
  if (!messages.length) throw new HttpError(400, "No valid conversation was supplied.");

  const reply = await generateReply(messages, route, env);
  if (!reply) {
    return jsonResponse({
      route,
      reply:
        "I couldn't produce a reliable reply. Take one small stabilizing step now—water, food, rest, or contact with a safe person—and try again in a moment.",
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
      if (url.pathname === "/api/health") {
        if (request.method !== "GET") {
          return jsonResponse({ error: "Method not allowed." }, 405);
        }
        const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
        return jsonResponse({
          ok: true,
          mode: demoMode ? "demo" : "bedrock",
          model: demoMode ? null : String(env.BEDROCK_MODEL_ID || ""),
        });
      }

      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") {
          return jsonResponse({ error: "Method not allowed." }, 405);
        }
        return await handleChat(request, env);
      }

      if (url.pathname.startsWith("/api/")) {
        return jsonResponse({ error: "Not found." }, 404);
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      const publicMessage =
        error instanceof HttpError
          ? error.message
          : "The AI is temporarily unavailable. Try again shortly, or contact a safe person if the situation cannot wait.";

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

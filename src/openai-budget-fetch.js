import {
  FREE_TOKEN_MODELS, DAILY_TOKEN_LIMIT_CODE, TOKEN_BUDGET_UNAVAILABLE_CODE,
  DAILY_TOKEN_LIMIT_MESSAGE, TOKEN_BUDGET_UNAVAILABLE_MESSAGE, freeTokenLimit,
} from "./openai-budget-policy.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const BUDGET_OBJECT_NAME = "openai-organization-primary-model-group-v1";
const MAX_OUTPUT_TOKENS = 8_192;
const MAX_SSE_EVENT_CHARS = 2_000_000;
const ALLOWED_FIELDS = new Set([
  "model", "instructions", "input", "max_output_tokens", "reasoning", "text",
  "store", "stream", "service_tier", "metadata", "prompt_cache_key", "prompt_cache_options",
]);

function denial(reason = "unavailable") {
  const daily = ["exhausted", "initializing"].includes(reason);
  const retry = Math.ceil((86_400_000 - Date.now() % 86_400_000) / 1000);
  return Response.json({ error: {
    code: daily ? DAILY_TOKEN_LIMIT_CODE : TOKEN_BUDGET_UNAVAILABLE_CODE,
    message: daily ? DAILY_TOKEN_LIMIT_MESSAGE : TOKEN_BUDGET_UNAVAILABLE_MESSAGE,
  } }, { status: 503, headers: daily ? { "Retry-After": String(retry) } : {} });
}

function normalizePayload(payload) {
  if (!FREE_TOKEN_MODELS.has(payload.model) || Object.keys(payload).some((key) => !ALLOWED_FIELDS.has(key))) {
    throw new Error("Request is not approved for complimentary tokens");
  }
  if (!Array.isArray(payload.input) || !payload.input.every((message) =>
    (!message.type || message.type === "message") &&
    ["system", "developer", "user", "assistant"].includes(message.role) &&
    (typeof message.content === "string" || (Array.isArray(message.content) && message.content.every(
      (block) => block.type === "input_text" && typeof block.text === "string",
    )))
  )) throw new Error("Only self-contained text requests are eligible");
  const requested = payload.max_output_tokens ?? MAX_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("Invalid output limit");
  const normalized = {
    ...payload,
    // Fast/Priority eligibility is unverified. Always request Standard here.
    service_tier: "default",
    max_output_tokens: Math.min(requested, MAX_OUTPUT_TOKENS),
    input: payload.input.map((message) => ({
      ...message,
      content: typeof message.content === "string" ? message.content : message.content.map(
        ({ type, text }) => ({ type, text }),
      ),
    })),
  };
  // Explicit cache writes have separate pricing. Do not request them in this mode.
  delete normalized.prompt_cache_options;
  delete normalized.prompt_cache_key;
  return normalized;
}

async function settle(stub, id, usage) {
  try { await stub.settle(id, usage); }
  catch { console.warn(JSON.stringify({ event: "openai_budget_settlement_pending", reservationId: id })); }
}

function meterStream(response, stub, id) {
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  const consume = async (block) => {
    if (finished) return;
    const data = block.split(/\r\n|\n|\r/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (["response.completed", "response.incomplete", "response.failed"].includes(event.type)) {
      finished = true;
      await settle(stub, id, event.response?.usage);
    }
  };
  const stream = response.body.pipeThrough(new TransformStream({
    async transform(chunk, controller) {
      if (!finished) {
        buffer += decoder.decode(chunk, { stream: true });
        const blocks = buffer.split(/\r\n\r\n|\n\n|\r\r/);
        buffer = blocks.pop() || "";
        for (const block of blocks) await consume(block);
        // Oversize/malformed streams keep their full reservation.
        if (buffer.length > MAX_SSE_EVENT_CHARS) finished = true;
      }
      controller.enqueue(chunk);
    },
    async flush() {
      if (!finished) await consume(buffer + decoder.decode());
    },
  }));
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function budgetedOpenAIFetch(url, init, env) {
  // Explicit rollback only. An absent/misspelled flag does NOT disable protection.
  if (env?.OPENAI_FREE_TOKENS_ONLY === "false") return fetch(url, init);
  let payload, stub, reservation, id;
  try {
    freeTokenLimit(env || {});
    if (url !== RESPONSES_URL || init.method !== "POST") return denial();
    payload = normalizePayload(JSON.parse(init.body));
    stub = env.OPENAI_TOKEN_BUDGET.getByName(BUDGET_OBJECT_NAME);
    const countPayload = Object.fromEntries(
      ["model", "input", "instructions", "reasoning", "text"].filter((key) => payload[key] !== undefined)
        .map((key) => [key, payload[key]]),
    );
    const countResponse = await fetch(`${RESPONSES_URL}/input_tokens`, {
      ...init, body: JSON.stringify(countPayload),
    });
    if (!countResponse.ok) return denial();
    const count = await countResponse.json();
    if (count.object !== "response.input_tokens" || !Number.isSafeInteger(count.input_tokens) || count.input_tokens < 0) return denial();
    // A small per-request buffer supplements the 10% daily headroom.
    const tokens = count.input_tokens + payload.max_output_tokens + 256;
    id = new Headers(init.headers).get("X-Client-Request-Id") || crypto.randomUUID();
    reservation = await stub.reserve(id, tokens);
    if (!reservation?.allowed) return denial(reservation?.reason);
    console.info(JSON.stringify({ event: "openai_budget_reserved", clientRequestId: id, model: payload.model, tokens }));
  } catch {
    return denial();
  }
  // No automatic retry or refund. A network error may follow billable generation.
  const headers = new Headers(init.headers);
  headers.set("X-Client-Request-Id", id);
  const response = await fetch(url, { ...init, headers, body: JSON.stringify(payload) });
  if (!response.ok) return response;
  if (payload.stream) {
    return response.body ? meterStream(response, stub, id) : response;
  }
  const body = await response.clone().json().catch(() => null);
  await settle(stub, id, body?.usage);
  return response;
}

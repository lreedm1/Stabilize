import assert from "node:assert/strict";
import { env } from "cloudflare:test";
import { test } from "vitest";
import worker from "../src/impact-worker.js";

const ADMIN_PASSWORD =
  "impact-test-dashboard-password-with-adequate-entropy";
const TEST_ENV = {
  ...env,
  DEMO_MODE: "false",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "gpt-5.4",
  OPENAI_REASONING_EFFORT: "none",
  OPENAI_SERVICE_TIER: "fast",
  FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-sol",
  FREE_PLAN_FALLBACK_MODEL: "gpt-5.4",
  FREE_DAILY_MODEL_MESSAGE_LIMIT: "50",
  MODEL_CHOICES: "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
  PAID_MONTHLY_MESSAGE_LIMIT: "200",
  AUTH_SECRET:
    "decision-grade-impact-test-secret-with-more-than-thirty-two-characters",
  PUBLIC_ORIGIN: "https://stabilize.test",
  IMPACT_ADMIN_PASSWORD_SHA256:
    "8641cac79ab3e694c764020bcfd03d43fcb736ec8ac85080d05d9bd6fcf946dd",
  IMPACT_RETENTION_DAYS: "180",
  IMPACT_ESTIMATED_CHAT_COST_MICROS: "0",
  IMPACT_MONTHLY_RECURRING_REVENUE_CENTS: "0",
  IMPACT_MONTHLY_RECURRING_COST_CENTS: "0",
};

function executionContext() {
  const tasks = [];
  return {
    tasks,
    waitUntil(task) {
      tasks.push(Promise.resolve(task));
    },
  };
}

function openAIStream(reply) {
  const response = {
    service_tier: "priority",
    usage: {
      input_tokens: 1_000,
      input_tokens_details: {
        cached_tokens: 400,
        cache_write_tokens: 100,
      },
      output_tokens: 100,
      output_tokens_details: { reasoning_tokens: 40 },
    },
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: reply,
            annotations: [],
          },
        ],
      },
    ],
  };
  const events = [
    { type: "response.output_text.delta", delta: reply.slice(0, 8) },
    { type: "response.output_text.delta", delta: reply.slice(8) },
    { type: "response.completed", response },
  ];
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
      "data: [DONE]\n\n",
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Request-Id": "req_decision_grade_impact",
      },
    },
  );
}

async function sendChat({ sessionId, browserId, conversationId, message }) {
  const ctx = executionContext();
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson, application/json",
        "Content-Type": "application/json",
        "X-Stabilize-Session-Id": sessionId,
        "X-Stabilize-Browser-Id": browserId,
        "X-Stabilize-Conversation-Id": conversationId,
      },
      body: JSON.stringify({ message }),
    }),
    TEST_ENV,
    ctx,
  );
  const turnId = response.headers.get("X-Stabilize-Turn-Id");
  const text = await response.text();
  await Promise.all(ctx.tasks);
  assert.equal(response.status, 200);
  assert.match(turnId || "", /^[0-9a-f-]{36}$/i);
  assert.match(text, /"type":"done"/);
  assert.match(text, /"model":"gpt-5\.6-sol"/);
  assert.match(text, /"actualServiceTier":"priority"/);
  assert.match(text, /"inputTokens":1000/);
  assert.match(text, /"cachedInputTokens":400/);
  assert.match(text, /"cacheWriteTokens":100/);
  assert.match(text, /"reasoningTokens":40/);
  assert.match(text, /"outputTokens":100/);
  return turnId;
}

function conversationHelpEvent(turnId, sessionId, browserId) {
  return new Request("https://stabilize.test/api/impact-event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://stabilize.test",
    },
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      sessionId,
      browserId,
      turnId,
      event: "conversation_help_reported",
      value: "yes",
      promptVersion: "conversation-help-v1",
    }),
  });
}

async function dashboardCookie() {
  const login = await worker.fetch(
    new Request("https://stabilize.test/admin/impact/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://stabilize.test",
      },
      body: new URLSearchParams({ password: ADMIN_PASSWORD }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(login.status, 303);
  const cookie = (login.headers.get("Set-Cookie") || "").split(";", 1)[0];
  assert.match(cookie, /^stabilize_impact_admin=/);
  return cookie;
}

test("provider usage, cost, and segmented latency reach the private dashboard", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== "https://api.openai.com/v1/responses") {
      return originalFetch(input, init);
    }
    providerCalls += 1;
    const payload = JSON.parse(String(init?.body || "{}"));
    assert.equal(payload.model, "gpt-5.6-sol");
    assert.equal(payload.service_tier, "fast");
    assert.equal(payload.stream, true);
    return openAIStream(
      providerCalls === 1
        ? "Pick the smallest useful task and open it."
        : "Write the first line, then stop and reassess.",
    );
  };

  try {
    const sessionId = crypto.randomUUID();
    const browserId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const firstTurnId = await sendChat({
      sessionId,
      browserId,
      conversationId,
      message: "Help me choose one small task.",
    });
    await sendChat({
      sessionId,
      browserId,
      conversationId,
      message: "Make that easier to start.",
    });
    assert.equal(providerCalls, 2);

    const outcome = await worker.fetch(
      conversationHelpEvent(firstTurnId, sessionId, browserId),
      TEST_ENV,
      {},
    );
    assert.equal(outcome.status, 202);

    const dashboard = await worker.fetch(
      new Request("https://stabilize.test/admin/impact", {
        headers: { Cookie: await dashboardCookie() },
      }),
      TEST_ENV,
      {},
    );
    const html = await dashboard.text();
    assert.equal(dashboard.status, 200);
    assert.match(html, /First-token p50/);
    assert.match(html, /First-token p95/);
    assert.match(html, /Total-response p50/);
    assert.match(html, /Total-response p95/);
    assert.match(html, /Latency breakdown/);
    assert.match(html, /Guest/);
    assert.match(html, /First message/);
    assert.match(html, /Follow-up/);
    assert.match(html, /Memory · guest/);
    assert.match(html, /Model · gpt-5\.6-sol/);
    assert.match(html, /Model and cost breakdown/);
    assert.match(html, /gpt-5\.6-sol/);
    assert.match(html, /priority/);
    assert.match(html, />2<\/td><td>2,000<\/td><td>800<\/td><td>80<\/td><td>200<\/td>/);
    assert.match(html, /\$0\.03/);
    assert.match(html, /Helpful conversations \/ \$/);
    assert.match(html, />39\.5<\/strong>/);
    assert.match(html, /Est\. cost \/ helpful conversation/);
    assert.match(html, /Pricing coverage/);
    assert.match(html, />100%<\/strong>/);
    assert.match(html, /openai-2026-08-08-v1/);
    assert.doesNotMatch(html, /Help me choose one small task/);
    assert.doesNotMatch(html, /Make that easier to start/);
    assert.doesNotMatch(html, /Pick the smallest useful task/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

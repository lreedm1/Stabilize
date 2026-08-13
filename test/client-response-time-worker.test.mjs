import assert from "node:assert/strict";
import { env } from "cloudflare:test";
import { test } from "vitest";
import worker from "../src/impact-worker.js";

const ADMIN_PASSWORD =
  "impact-test-dashboard-password-with-adequate-entropy";
const TEST_ENV = {
  ...env,
  DEMO_MODE: "true",
  OPENAI_MODEL: "gpt-5.4",
  OPENAI_REASONING_EFFORT: "none",
  OPENAI_SERVICE_TIER: "fast",
  AUTH_SECRET:
    "client-response-time-test-secret-with-more-than-thirty-two-characters",
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

function clientLatencyRequest({
  sessionId,
  browserId,
  turnId,
  firstVisibleMs = 420,
  completeMs = 1_200,
}) {
  return new Request("https://stabilize.test/api/client-latency", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://stabilize.test",
    },
    body: JSON.stringify({
      sessionId,
      browserId,
      turnId,
      firstVisibleMs,
      completeMs,
      metricVersion: "browser-render-v1",
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
  return (login.headers.get("Set-Cookie") || "").split(";", 1)[0];
}

test("verified browser-rendered timings appear as actual response time", async () => {
  const sessionId = crypto.randomUUID();
  const browserId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const ctx = executionContext();
  const chat = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson, application/json",
        "Content-Type": "application/json",
        "X-Stabilize-Session-Id": sessionId,
        "X-Stabilize-Browser-Id": browserId,
        "X-Stabilize-Conversation-Id": conversationId,
      },
      body: JSON.stringify({ message: "Give me one small next step." }),
    }),
    TEST_ENV,
    ctx,
  );
  const turnId = chat.headers.get("X-Stabilize-Turn-Id");
  assert.match(turnId || "", /^[0-9a-f-]{36}$/i);
  assert.match(await chat.text(), /"type":"done"/);
  await Promise.all(ctx.tasks);

  const accepted = await worker.fetch(
    clientLatencyRequest({ sessionId, browserId, turnId }),
    TEST_ENV,
    {},
  );
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { accepted: true, duplicate: false });

  const duplicate = await worker.fetch(
    clientLatencyRequest({ sessionId, browserId, turnId }),
    TEST_ENV,
    {},
  );
  assert.equal(duplicate.status, 202);
  assert.deepEqual(await duplicate.json(), { accepted: true, duplicate: true });

  const wrongSession = await worker.fetch(
    clientLatencyRequest({
      sessionId: crypto.randomUUID(),
      browserId,
      turnId,
    }),
    TEST_ENV,
    {},
  );
  assert.equal(wrongSession.status, 409);

  const invalidOrder = await worker.fetch(
    clientLatencyRequest({
      sessionId,
      browserId,
      turnId,
      firstVisibleMs: 2_000,
      completeMs: 1_000,
    }),
    TEST_ENV,
    {},
  );
  assert.equal(invalidOrder.status, 400);

  const dashboard = await worker.fetch(
    new Request("https://stabilize.test/admin/impact", {
      headers: { Cookie: await dashboardCookie() },
    }),
    TEST_ENV,
    {},
  );
  const html = await dashboard.text();
  assert.equal(dashboard.status, 200);
  assert.match(html, /Actual response time/);
  assert.match(html, /Actual first-visible p50/);
  assert.match(html, /Actual fully-rendered p50/);
  assert.match(html, /Browser timing coverage/);
  assert.match(html, /500 ms/);
  assert.match(html, /1\.5 s/);
  assert.match(html, />100%<\/strong>/);
  assert.match(html, /Guest/);
  assert.match(html, /First message/);
  assert.doesNotMatch(html, /Give me one small next step/);
});

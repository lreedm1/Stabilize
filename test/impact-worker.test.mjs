import assert from "node:assert/strict";
import { env } from "cloudflare:test";
import { test } from "vitest";
import worker from "../src/impact-worker.js";

const TEST_ENV = {
  ...env,
  DEMO_MODE: "true",
  OPENAI_MODEL: "gpt-5.4",
  OPENAI_REASONING_EFFORT: "medium",
  AUTH_SECRET: "impact-test-auth-secret-with-more-than-thirty-two-characters",
  PUBLIC_ORIGIN: "https://stabilize.test",
  IMPACT_ADMIN_SECRET: "impact-test-dashboard-secret-with-adequate-length",
  IMPACT_RETENTION_DAYS: "180",
  IMPACT_ESTIMATED_CHAT_COST_MICROS: "10000",
  IMPACT_MONTHLY_RECURRING_REVENUE_CENTS: "50000",
  IMPACT_MONTHLY_RECURRING_COST_CENTS: "25000",
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

function impactEvent(turnId, sessionId, browserId, event, value, responseType = "planning") {
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
      event,
      value,
      responseType,
      promptVersion: "outcome-v1",
      firstTokenMs: 125,
      totalResponseMs: 800,
    }),
  });
}

test("a verified chat turn accepts structured impact events and appears in the private dashboard", async () => {
  const sessionId = crypto.randomUUID();
  const browserId = crypto.randomUUID();
  const ctx = executionContext();
  const chat = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson, application/json",
        "X-Stabilize-Session-Id": sessionId,
        "X-Stabilize-Browser-Id": browserId,
      },
      body: JSON.stringify({ message: "Help me plan one task for today." }),
    }),
    TEST_ENV,
    ctx,
  );

  const turnId = chat.headers.get("x-stabilize-turn-id");
  assert.match(turnId || "", /^[0-9a-f-]{36}$/i);
  assert.equal(chat.headers.get("x-stabilize-impact-version"), "outcome-v1");
  assert.match(chat.headers.get("content-type") || "", /application\/x-ndjson/);
  assert.match(await chat.text(), /"type":"done"/);
  await Promise.all(ctx.tasks);

  const events = [
    ["response_completed", "completed", "unknown"],
    ["outcome_prompt_shown", "", "planning"],
    ["clarity_answered", "yes", "planning"],
    ["outcome_selected", "action", "planning"],
  ];
  for (const [event, value, responseType] of events) {
    const response = await worker.fetch(
      impactEvent(turnId, sessionId, browserId, event, value, responseType),
      TEST_ENV,
      {},
    );
    assert.equal(response.status, 202);
  }

  const login = await worker.fetch(
    new Request("https://stabilize.test/admin/impact/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://stabilize.test",
      },
      body: new URLSearchParams({ password: TEST_ENV.IMPACT_ADMIN_SECRET }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(login.status, 303);
  const cookie = (login.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(cookie, /^stabilize_impact_admin=/);

  const dashboard = await worker.fetch(
    new Request("https://stabilize.test/admin/impact", {
      headers: { Cookie: cookie },
    }),
    TEST_ENV,
    {},
  );
  const html = await dashboard.text();
  assert.equal(dashboard.status, 200);
  assert.match(html, /Orderly impact/);
  assert.match(html, /Resolved outcomes/);
  assert.match(html, />1<\/strong>/);
  assert.match(html, /2\.00×/);
  assert.doesNotMatch(html, /Help me plan one task/);
});

test("impact events are rejected when they do not match a server-created turn", async () => {
  const response = await worker.fetch(
    impactEvent(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      "clarity_answered",
      "yes",
    ),
    TEST_ENV,
    {},
  );
  assert.equal(response.status, 409);
});

test("the privacy page receives the outcome-measurement disclosure", async () => {
  const assets = {
    fetch: async () => new Response(
      '<!doctype html><html><body><h2>Public feedback</h2></body></html>',
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    ),
  };
  const response = await worker.fetch(
    new Request("https://stabilize.test/privacy.html"),
    { ...TEST_ENV, ASSETS: assets },
    {},
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /id="outcome-measurement"/);
  assert.match(html, /does not place the user’s message/);
});

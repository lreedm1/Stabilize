import assert from "node:assert/strict";
import { env } from "cloudflare:test";
import { test } from "vitest";
import worker from "../src/impact-worker.js";

const TEST_ADMIN_PASSWORD =
  "impact-test-dashboard-password-with-adequate-entropy";
const TEST_ENV = {
  ...env,
  DEMO_MODE: "true",
  OPENAI_MODEL: "gpt-5.4",
  OPENAI_REASONING_EFFORT: "medium",
  AUTH_SECRET: "impact-test-auth-secret-with-more-than-thirty-two-characters",
  PUBLIC_ORIGIN: "https://stabilize.test",
  IMPACT_ADMIN_PASSWORD_SHA256:
    "8641cac79ab3e694c764020bcfd03d43fcb736ec8ac85080d05d9bd6fcf946dd",
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

function nextStepEvent(turnId, sessionId, browserId, value) {
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
      event: "next_step_reported",
      value,
      promptVersion: "next-step-v1",
    }),
  });
}

test("one verified event row advances from shown to yes and appears in the six-number dashboard", async () => {
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
      body: JSON.stringify({ message: "Help me choose one task for today." }),
    }),
    TEST_ENV,
    ctx,
  );

  const turnId = chat.headers.get("x-stabilize-turn-id");
  assert.match(turnId || "", /^[0-9a-f-]{36}$/i);
  assert.equal(chat.headers.get("x-stabilize-impact-version"), "next-step-v1");
  assert.match(chat.headers.get("content-type") || "", /application\/x-ndjson/);
  assert.match(await chat.text(), /"type":"done"/);
  await Promise.all(ctx.tasks);

  for (const value of ["shown", "yes", "shown"]) {
    const response = await worker.fetch(
      nextStepEvent(turnId, sessionId, browserId, value),
      TEST_ENV,
      {},
    );
    assert.equal(response.status, 202);
  }

  const rejectedLogin = await worker.fetch(
    new Request("https://stabilize.test/admin/impact/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://stabilize.test",
      },
      body: new URLSearchParams({ password: "wrong-password" }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(rejectedLogin.status, 401);
  assert.equal(rejectedLogin.headers.get("set-cookie"), null);

  const login = await worker.fetch(
    new Request("https://stabilize.test/admin/impact/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://stabilize.test",
      },
      body: new URLSearchParams({ password: TEST_ADMIN_PASSWORD }),
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
  assert.match(html, /One question\. Six numbers\. One decision each week\./);
  assert.match(html, /Eligible checks shown/);
  assert.match(html, /Reports received/);
  assert.match(html, /Reported next-step rate/);
  assert.match(html, /One decision this week/);
  assert.match(html, /2\.00×/);
  assert.equal((html.match(/class="tile"/g) || []).length, 6);
  assert.doesNotMatch(html, /Help me choose one task/);
  assert.doesNotMatch(html, new RegExp(TEST_ADMIN_PASSWORD));
});

test("opaque-origin iOS login works without allowing cross-site form posts", async () => {
  const opaqueLogin = await worker.fetch(
    new Request("https://stabilize.test/admin/impact/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "null",
        "Sec-Fetch-Site": "none",
      },
      body: new URLSearchParams({ password: TEST_ADMIN_PASSWORD }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(opaqueLogin.status, 303);
  assert.match(
    opaqueLogin.headers.get("set-cookie") || "",
    /^stabilize_impact_admin=/,
  );

  const crossSite = await worker.fetch(
    new Request("https://stabilize.test/admin/impact/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: new URLSearchParams({ password: TEST_ADMIN_PASSWORD }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(crossSite.status, 403);

  const opaqueCrossSite = await worker.fetch(
    new Request("https://stabilize.test/admin/impact/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "null",
        "Sec-Fetch-Site": "cross-site",
      },
      body: new URLSearchParams({ password: TEST_ADMIN_PASSWORD }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(opaqueCrossSite.status, 403);
});

test("impact events are rejected when they do not match a server-created turn", async () => {
  const response = await worker.fetch(
    nextStepEvent(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      "yes",
    ),
    TEST_ENV,
    {},
  );
  assert.equal(response.status, 409);
});

test("the event endpoint rejects extra event types", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/impact-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://stabilize.test",
      },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        browserId: crypto.randomUUID(),
        turnId: crypto.randomUUID(),
        event: "proportionality_answered",
        value: "about_right",
        promptVersion: "next-step-v1",
      }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(response.status, 400);
});

test("canonical and file privacy routes receive the one-question disclosure", async () => {
  const assets = {
    fetch: async () =>
      new Response(
        '<!doctype html><html><body><h2>Public feedback</h2></body></html>',
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      ),
  };

  for (const path of ["/privacy", "/privacy.html"]) {
    const response = await worker.fetch(
      new Request(`https://stabilize.test${path}`),
      { ...TEST_ENV, ASSETS: assets },
      {},
    );
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /id="outcome-measurement"/);
    assert.match(html, /Did you choose a next step/);
    assert.match(html, /does not place the\s+user’s message/);
  }
});

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

function structuredImpactEvent(
  turnId,
  sessionId,
  browserId,
  event,
  value,
  promptVersion,
) {
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
      promptVersion,
    }),
  });
}

function nextStepEvent(turnId, sessionId, browserId, value) {
  return structuredImpactEvent(
    turnId,
    sessionId,
    browserId,
    "next_step_reported",
    value,
    "next-step-v1",
  );
}

function conversationHelpEvent(turnId, sessionId, browserId, value) {
  return structuredImpactEvent(
    turnId,
    sessionId,
    browserId,
    "conversation_help_reported",
    value,
    "conversation-help-v1",
  );
}

function messageFeedbackEvent(
  turnId,
  sessionId,
  browserId,
  rating,
  reason = "",
  comment = "",
) {
  return new Request("https://stabilize.test/api/message-feedback", {
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
      rating,
      reason,
      comment,
    }),
  });
}

test("verified outcomes and response feedback appear in the private dashboard", async () => {
  const sessionId = crypto.randomUUID();
  const browserId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const ctx = executionContext();
  const chat = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson, application/json",
        "X-Stabilize-Session-Id": sessionId,
        "X-Stabilize-Browser-Id": browserId,
        "X-Stabilize-Conversation-Id": conversationId,
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

  for (const value of ["shown", "partly", "shown"]) {
    const response = await worker.fetch(
      conversationHelpEvent(turnId, sessionId, browserId, value),
      TEST_ENV,
      {},
    );
    assert.equal(response.status, 202);
  }

  const writtenFeedback = "Useful structure <script>alert('no')</script>";
  for (const [rating, reason, comment] of [
    ["shown", "", ""],
    ["up", "clear_answer", ""],
    ["up", "clear_answer", writtenFeedback],
  ]) {
    const response = await worker.fetch(
      messageFeedbackEvent(
        turnId,
        sessionId,
        browserId,
        rating,
        reason,
        comment,
      ),
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
  assert.match(
    html,
    /Outcomes, latency, provider usage, reliability, and cost\./,
  );
  assert.match(html, /Eligible checks shown/);
  assert.match(html, /Reports received/);
  assert.match(html, /Reported next-step rate/);
  assert.match(html, /Conversations started/);
  assert.match(html, /Second-message rate/);
  assert.match(html, /Helpful response rate/);
  assert.match(html, /Feedback response rate/);
  assert.match(html, /Conversation help rate/);
  assert.match(html, /Conversation feedback rate/);
  assert.match(html, /Daily usage/);
  assert.match(html, /Latency breakdown/);
  assert.match(html, /Model and cost breakdown/);
  assert.match(html, /Latency breakdown/);
  assert.match(html, /Model and cost breakdown/);
  assert.match(html, /Latency breakdown/);
  assert.match(html, /Model and cost breakdown/);
  assert.match(html, /Unique browsers and submitted chat messages by UTC day/);
  assert.match(html, /Top feedback reasons/);
  assert.match(html, /Recent written feedback/);
  assert.match(html, /Clear answer/);
  assert.match(
    html,
    /Useful structure &lt;script&gt;alert\(&#39;no&#39;\)&lt;\/script&gt;/,
  );
  assert.doesNotMatch(html, /<script>alert\('no'\)<\/script>/);
  assert.match(html, /<strong>1 users<\/strong>/);
  assert.match(html, /<strong>1 messages<\/strong>/);
  assert.match(html, /<th>Users<\/th><th>Messages<\/th>/);
  assert.match(html, /One decision this week/);
  assert.match(html, /2\.00×/);
  assert.ok((html.match(/class="tile"/g) || []).length >= 24);
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

test("impact and feedback events are rejected when they do not match a server-created turn", async () => {
  const impactResponse = await worker.fetch(
    nextStepEvent(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      "yes",
    ),
    TEST_ENV,
    {},
  );
  assert.equal(impactResponse.status, 409);

  const conversationResponse = await worker.fetch(
    conversationHelpEvent(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      "yes",
    ),
    TEST_ENV,
    {},
  );
  assert.equal(conversationResponse.status, 409);

  const feedbackResponse = await worker.fetch(
    messageFeedbackEvent(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      "down",
      "too_generic",
    ),
    TEST_ENV,
    {},
  );
  assert.equal(feedbackResponse.status, 409);
});

test("the event endpoints reject unsupported values and prompt versions", async () => {
  const impactResponse = await worker.fetch(
    structuredImpactEvent(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      "proportionality_answered",
      "about_right",
      "next-step-v1",
    ),
    TEST_ENV,
    {},
  );
  assert.equal(impactResponse.status, 400);

  const wrongVersion = await worker.fetch(
    structuredImpactEvent(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      "conversation_help_reported",
      "yes",
      "next-step-v1",
    ),
    TEST_ENV,
    {},
  );
  assert.equal(wrongVersion.status, 400);

  const feedbackResponse = await worker.fetch(
    messageFeedbackEvent(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      "down",
      "unsupported_reason",
    ),
    TEST_ENV,
    {},
  );
  assert.equal(feedbackResponse.status, 400);
});

test("canonical and file privacy routes receive the outcome and feedback disclosure", async () => {
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
    assert.match(html, /up to three optional action buttons beside/);
    assert.match(html, /prior conversation helped\s+the\s+user move forward/);
    assert.match(html, /random browser, tab, and conversation identifiers/);
    assert.match(html, /response-quality/);
    assert.match(html, /does not\s+place the user's message/);
  }
});

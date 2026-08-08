import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/paid-worker.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

const BASE_ENV = {
  ...env,
  DEMO_MODE: "false",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "gpt-5.4",
  OPENAI_REASONING_EFFORT: "none",
  OPENAI_SERVICE_TIER: "fast",
  MODEL_CHOICES: "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
  FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-sol",
  FREE_PLAN_FALLBACK_MODEL: "gpt-5.4",
  FREE_DAILY_MODEL_MESSAGE_LIMIT: "2",
  PAID_MONTHLY_MESSAGE_LIMIT: "200",
  PUBLIC_ORIGIN: "https://stabilize.info",
  GOOGLE_CLIENT_ID:
    "1234567890-stabilize-model-usage.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  AUTH_SECRET: "test-auth-secret-with-at-least-thirty-two-characters",
};

async function identity(subject) {
  const token = await createAuthSessionTokenForGoogleSubject(subject, BASE_ENV);
  const cookie = `${AUTH_COOKIE_NAME}=${token}`;
  const session = await readAuthSession(
    new Request("https://stabilize.info/", { headers: { Cookie: cookie } }),
    BASE_ENV,
  );
  assert.ok(session);
  return {
    cookie,
    billing: BASE_ENV.BILLING.getByName(`google:${session.accountKey}`),
  };
}

function responseWithText(text) {
  return Response.json({
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text, annotations: [] },
        ],
      },
    ],
  });
}

function chatRequest(cookie, message, reasoningEffort = "none") {
  return new Request("https://stabilize.info/api/chat", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: "https://stabilize.info",
    },
    body: JSON.stringify({ message, reasoningEffort }),
  });
}

test("signed-in instant is unmetered GPT-5.4 while thinking uses Current then falls back", async () => {
  const user = await identity("fast-signed-in-model-user");
  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    if (body.text?.verbosity === "low") {
      providerRequests.push({ model: body.model, effort: body.reasoning.effort });
    }
    return responseWithText("Use the smallest reversible step.");
  };

  try {
    const instant = await worker.fetch(
      chatRequest(user.cookie, "Give me one quick step."),
      BASE_ENV,
      {},
    );
    assert.equal(instant.status, 200);
    assert.equal(instant.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal(instant.headers.get("X-Stabilize-Model-Usage-Tier"), null);
    assert.match(instant.headers.get("Server-Timing") || "", /stabilize-billing/);
    assert.equal((await instant.json()).reply, "Use the smallest reversible step.");
    assert.equal((await user.billing.readState()).freeUsageCount, 0);

    for (const expectedUsed of [1, 2]) {
      const response = await worker.fetch(
        chatRequest(user.cookie, `Think through step ${expectedUsed}.`, "high"),
        BASE_ENV,
        {},
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
      assert.equal(response.headers.get("X-Stabilize-Model-Usage-Used"), String(expectedUsed));
      assert.equal(response.headers.get("X-Stabilize-Model-Usage-Limit"), "2");
      assert.equal((await response.json()).reply, "Use the smallest reversible step.");
    }

    const fallback = await worker.fetch(
      chatRequest(user.cookie, "Think through one more step.", "high"),
      BASE_ENV,
      {},
    );
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal((await fallback.json()).reply, "Use the smallest reversible step.");

    assert.deepEqual(providerRequests, [
      { model: "gpt-5.4", effort: "none" },
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.4", effort: "none" },
    ]);
    const state = await user.billing.readState();
    assert.equal(state.freeUsageCount, 2);
    assert.equal(state.paidUsageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the free homepage presents GPT-5.4 Fastest response and the Current thinking allowance", async () => {
  const user = await identity("fast-signed-in-model-page-user");
  const page = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: user.cookie },
    }),
    BASE_ENV,
    {},
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /0 of 2 free Current thinking messages used today/);
  assert.match(html, /Fastest response uses GPT-5.4/);
  assert.ok(
    html.includes('<span class="composer-model-current">5.4</span>'),
  );
  assert.doesNotMatch(html, /id="composer-model-choice" name="model"/);
});

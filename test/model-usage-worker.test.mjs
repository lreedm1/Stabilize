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
          {
            type: "output_text",
            text,
            annotations: [],
          },
        ],
      },
    ],
  });
}

function chatRequest(cookie, message) {
  return new Request("https://stabilize.info/api/chat", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: "https://stabilize.info",
    },
    body: JSON.stringify({ message, reasoningEffort: "high" }),
  });
}

test("free usage automatically runs GPT-5.6 twice and GPT-5.4 afterward", async () => {
  const user = await identity("automatic-free-model-user");
  await user.billing.setSelectedModel("gpt-5.4");

  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    if (body.reasoning?.effort === "none") {
      providerRequests.push({
        model: body.model,
        effort: body.reasoning.effort,
      });
    }
    return responseWithText("Use the smallest reversible step.");
  };

  try {
    for (const expectedUsed of [1, 2]) {
      const response = await worker.fetch(
        chatRequest(user.cookie, `Give me step ${expectedUsed}.`),
        BASE_ENV,
        {},
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
      assert.equal(
        response.headers.get("X-Stabilize-Model-Usage-Used"),
        String(expectedUsed),
      );
      assert.equal(response.headers.get("X-Stabilize-Model-Usage-Limit"), "2");
      assert.equal((await response.json()).reply, "Use the smallest reversible step.");
    }

    const fallback = await worker.fetch(
      chatRequest(user.cookie, "Give me one more step."),
      BASE_ENV,
      {},
    );
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Usage-Used"), "2");
    assert.equal((await fallback.json()).reply, "Use the smallest reversible step.");
    const fallbackState = await user.billing.readState();
    assert.equal(fallbackState.selectedModel, BASE_ENV.OPENAI_MODEL);

    assert.deepEqual(providerRequests, [
      { model: "gpt-5.6-sol", effort: "none" },
      { model: "gpt-5.6-sol", effort: "none" },
      { model: "gpt-5.4", effort: "none" },
    ]);
    const state = await user.billing.readState();
    assert.equal(state.freeUsageCount, 2);
    assert.equal(state.paidUsageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the free homepage presents the automatic 5.6 to 5.4 ladder", async () => {
  const user = await identity("automatic-free-model-page-user");
  const page = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: user.cookie },
    }),
    BASE_ENV,
    {},
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /0 of 2 free GPT-5\.6 Instant messages used today/);
  assert.match(html, /GPT-5\.4 takes over afterward/);
  assert.doesNotMatch(html, /id="composer-model-choice" name="model"/);
});

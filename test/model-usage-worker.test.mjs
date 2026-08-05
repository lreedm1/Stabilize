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
  OPENAI_MODEL: "gpt-5-mini",
  OPENAI_REASONING_EFFORT: "medium",
  MODEL_CHOICES: [
    "gpt-5-mini|GPT-5 mini (default)",
    "gpt-5.1|GPT-5.1",
    "gpt-5.6-luna|GPT-5.6 Luna",
    "gpt-5.6-terra|GPT-5.6 Terra",
    "gpt-5.6-sol|GPT-5.6 Sol",
  ].join(","),
  FREE_DAILY_MODEL_MESSAGE_LIMIT: "2",
  PAID_MONTHLY_MESSAGE_LIMIT: "200",
  PUBLIC_ORIGIN: "https://stabilize.info",
  GOOGLE_CLIENT_ID:
    "1234567890-stabilize-model-usage.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  AUTH_SECRET: "test-auth-secret-with-at-least-thirty-two-characters",
};

async function identity(subject, testEnv = BASE_ENV) {
  const token = await createAuthSessionTokenForGoogleSubject(subject, testEnv);
  const cookie = `${AUTH_COOKIE_NAME}=${token}`;
  const session = await readAuthSession(
    new Request("https://stabilize.info/", { headers: { Cookie: cookie } }),
    testEnv,
  );
  assert.ok(session);
  return {
    cookie,
    billing: testEnv.BILLING.getByName(`google:${session.accountKey}`),
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
    body: JSON.stringify({ message }),
  });
}

test("selected-model usage persists and is returned for live counter updates", async () => {
  const user = await identity("live-model-usage-user");
  await user.billing.setSelectedModel("gpt-5.6-terra");

  const originalFetch = globalThis.fetch;
  const providerModels = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    providerModels.push(body.model);
    return responseWithText("Use the smallest reversible step.");
  };

  try {
    let period = "";
    for (const expectedUsed of [1, 2]) {
      const response = await worker.fetch(
        chatRequest(
          user.cookie,
          `Compare the options and give me step ${expectedUsed}.`,
        ),
        BASE_ENV,
        {},
      );

      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("X-Stabilize-Model-Usage-Tier"),
        "free",
      );
      assert.equal(
        response.headers.get("X-Stabilize-Model-Usage-Used"),
        String(expectedUsed),
      );
      assert.equal(
        response.headers.get("X-Stabilize-Model-Usage-Limit"),
        "2",
      );
      assert.equal(
        response.headers.get("X-Stabilize-Model-Selected"),
        "gpt-5.6-terra",
      );
      period = response.headers.get("X-Stabilize-Model-Usage-Period") || "";
      assert.match(period, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(
        (await response.json()).reply,
        "Use the smallest reversible step.",
      );
    }

    const state = await user.billing.readState();
    assert.equal(state.freeUsagePeriod, period);
    assert.equal(state.freeUsageCount, 2);
    assert.equal(state.paidUsageCount, 0);

    const page = await worker.fetch(
      new Request("https://stabilize.info/", {
        headers: { Cookie: user.cookie },
      }),
      BASE_ENV,
      {},
    );
    const html = await page.text();
    assert.match(html, /2 of 2 free model-select messages used today/);
    assert.match(html, /data-model-usage="true"/);

    const blocked = await worker.fetch(
      chatRequest(user.cookie, "Give me one more selected-model response."),
      BASE_ENV,
      {},
    );
    assert.equal(blocked.status, 429);
    assert.match(
      (await blocked.json()).error,
      /daily free model-select limit of 2 messages has been reached/i,
    );
    assert.ok(
      providerModels.filter((model) => model === "gpt-5.6-terra").length >= 2,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the GPT-5 mini default does not consume selected-model usage", async () => {
  const user = await identity("default-model-usage-user");
  await user.billing.setSelectedModel("gpt-5-mini");

  const originalFetch = globalThis.fetch;
  let providerModel = null;
  globalThis.fetch = async (_input, init) => {
    providerModel = JSON.parse(init.body).model;
    return responseWithText("Default reply.");
  };

  try {
    const response = await worker.fetch(
      chatRequest(user.cookie, "Give me one clear next step."),
      BASE_ENV,
      {},
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, "Default reply.");
    assert.equal(providerModel, "gpt-5-mini");
    assert.equal(
      response.headers.get("X-Stabilize-Model-Usage-Used"),
      null,
    );

    const state = await user.billing.readState();
    assert.equal(state.freeUsageCount, 0);
    assert.equal(state.paidUsageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

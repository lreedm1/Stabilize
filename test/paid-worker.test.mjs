import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/paid-worker.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

const TEST_ENV = {
  ...env,
  DEMO_MODE: "false",
  OPENAI_API_KEY: "test-openai-key", OPENAI_FREE_TOKENS_ONLY: "false",
  OPENAI_MODEL: "gpt-5.2",
  OPENAI_REASONING_EFFORT: "medium",
  MODEL_CHOICES:
    "gpt-5.2|Stabilize default,gpt-5.1|GPT-5.1,gpt-5-mini|GPT-5 mini",
  FREE_DAILY_MODEL_MESSAGE_LIMIT: "20",
  PAID_MONTHLY_MESSAGE_LIMIT: "200",
  STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
  STRIPE_WEBHOOK_SECRET: "whsec_1234567890abcdefghijklmnop",
  STRIPE_MODEL_CHOICE_PRICE_ID: "price_12345678",
  PUBLIC_ORIGIN: "https://stabilize.info",
  GOOGLE_CLIENT_ID:
    "1234567890-stabilize-paid-tests.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  AUTH_SECRET: "test-auth-secret-with-at-least-thirty-two-characters",
};

async function identity(subject) {
  const token = await createAuthSessionTokenForGoogleSubject(subject, TEST_ENV);
  const cookie = `${AUTH_COOKIE_NAME}=${token}`;
  const session = await readAuthSession(
    new Request("https://stabilize.info/", { headers: { Cookie: cookie } }),
    TEST_ENV,
  );
  assert.ok(session);
  return {
    cookie,
    billing: TEST_ENV.BILLING.getByName(`google:${session.accountKey}`),
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

test("opaque-origin signed-in checkout opens Stripe through JSON navigation", async () => {
  const user = await identity("paid-checkout-user");
  const originalFetch = globalThis.fetch;
  let stripeRequest;

  globalThis.fetch = async (input, init) => {
    stripeRequest = { input: String(input), init };
    return Response.json({
      id: "cs_test_12345678",
      url: "https://checkout.stripe.com/c/pay/cs_test_12345678",
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.info/billing/checkout", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Cookie: user.cookie,
          Origin: "null",
          "Sec-Fetch-Site": "same-origin",
        },
      }),
      TEST_ENV,
      {},
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      url: "https://checkout.stripe.com/c/pay/cs_test_12345678",
    });
    assert.equal(
      stripeRequest.input,
      "https://api.stripe.com/v1/checkout/sessions",
    );
    const params = new URLSearchParams(stripeRequest.init.body);
    assert.equal(params.get("mode"), "subscription");
    assert.equal(params.get("line_items[0][price]"), "price_12345678");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("opaque cross-site billing submissions remain blocked", async () => {
  const user = await identity("paid-cross-site-user");
  const response = await worker.fetch(
    new Request("https://stabilize.info/billing/checkout", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: user.cookie,
        Origin: "null",
        "Sec-Fetch-Site": "cross-site",
      },
    }),
    TEST_ENV,
    {},
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Cross-origin request rejected.",
  });
});

test("homepage keeps settings simple with no selectable models", async () => {
  const user = await identity("paid-model-picker-user");
  const response = await worker.fetch(
    new Request("https://stabilize.info/", { headers: { Cookie: user.cookie } }),
    TEST_ENV, {},
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /class="menu-panel"/);
  assert.match(html, /id="chat-form"/);
  assert.match(html, /id="new-conversation-button"/);
  assert.match(html, /simple-more/);
  assert.doesNotMatch(html, /class="composer-model-picker"/);
  assert.doesNotMatch(html, /<select[^>]+name="model"/);
  assert.match(html, /reasoning-choice\.js\?v=20261014-think-only/);
});

test("a free signed-in user gets GPT-5.6 Fast before GPT-5.4 fallback", async () => {
  const user = await identity("free-daily-model-user");
  const limitedEnv = {
    ...TEST_ENV,
    OPENAI_MODEL: "gpt-5.4",
    OPENAI_REASONING_EFFORT: "none",
    OPENAI_SERVICE_TIER: "fast",
    MODEL_CHOICES: "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
    FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-sol",
    FREE_PLAN_FALLBACK_MODEL: "gpt-5.4",
    FREE_DAILY_MODEL_MESSAGE_LIMIT: "2",
  };
  const page = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: user.cookie },
    }),
    limitedEnv,
    {},
  );
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="chat-form"/);

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
    for (const [index, reasoningEffort] of ["none", "high"].entries()) {
      const response = await worker.fetch(
        new Request("https://stabilize.info/api/chat", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Cookie: user.cookie,
            Origin: "https://stabilize.info",
          },
          body: JSON.stringify({
            message: `Give me step ${index + 1}.`,
            reasoningEffort,
          }),
        }),
        limitedEnv,
        {},
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
      assert.equal(response.headers.get("X-Stabilize-Model-Usage-Used"), String(index + 1));
    }

    const fallback = await worker.fetch(
      new Request("https://stabilize.info/api/chat", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: user.cookie,
          Origin: "https://stabilize.info",
        },
        body: JSON.stringify({
          message: "Give me one more step.",
          reasoningEffort: "high",
        }),
      }),
      limitedEnv,
      {},
    );
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.deepEqual(providerRequests, [
      { model: "gpt-5.6-sol", effort: "medium" },
      { model: "gpt-5.6-sol", effort: "medium" },
      { model: "gpt-5.4", effort: "medium" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("an entitled user can select a subscriber model and the chat request uses it", async () => {
  const user = await identity("paid-model-user");
  await user.billing.updateBilling({
    customerId: "cus_12345678",
    subscriptionId: "sub_12345678",
    subscriptionStatus: "active",
  });

  const selection = await worker.fetch(
    new Request("https://stabilize.info/account/model", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: user.cookie,
        Origin: "https://stabilize.info",
        "Sec-Fetch-Site": "same-origin",
      },
      body: new URLSearchParams({ model: "gpt-5.1" }),
    }),
    TEST_ENV,
    {},
  );

  assert.equal(selection.status, 303);
  assert.equal(selection.headers.get("location"), "/?model=saved");
  assert.equal((await user.billing.readState()).selectedModel, "gpt-5.1");

  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Use the first reversible step.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.info/api/chat", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: user.cookie,
          Origin: "https://stabilize.info",
        },
        body: JSON.stringify({
          message: "Compare these two options and give me one reversible next step.",
        }),
      }),
      TEST_ENV,
      {},
    );

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.reply, "Use the first reversible step.");
    assert.equal(providerBody.model, "gpt-5.1");
    const state = await user.billing.readState();
    assert.equal(state.usageCount, 1);
    assert.equal(state.paidUsageCount, 1);
    assert.equal(state.freeUsageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

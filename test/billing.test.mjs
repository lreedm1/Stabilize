import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const {
  MANAGED_PAYMENTS_STRIPE_VERSION,
  createCheckoutSession,
  dailyUsagePeriod,
  freeDailyModelMessageLimit,
  modelChoices,
  monthlyModelMessageLimit,
  stateFromStripeEvent,
  subscriptionHasAccess,
  usagePeriod,
  verifyStripeSignature,
} = await import("../src/billing.js");

test("model choices are bounded, deduplicated, and include the default", () => {
  const choices = modelChoices({
    OPENAI_MODEL: "gpt-default",
    MODEL_CHOICES: "gpt-fast|Fast,gpt-fast|Duplicate,gpt-deep|Deep",
  });
  assert.deepEqual(choices, [
    { id: "gpt-default", label: "Stabilize default" },
    { id: "gpt-fast", label: "Fast" },
    { id: "gpt-deep", label: "Deep" },
  ]);
});

test("free model choice gets 20 messages per UTC day while subscribers remain monthly", () => {
  const instant = new Date("2026-08-05T23:59:59.000Z");
  assert.equal(freeDailyModelMessageLimit({}), 20);
  assert.equal(
    freeDailyModelMessageLimit({ FREE_DAILY_MODEL_MESSAGE_LIMIT: "35" }),
    35,
  );
  assert.equal(
    freeDailyModelMessageLimit({ FREE_DAILY_MODEL_MESSAGE_LIMIT: "invalid" }),
    20,
  );
  assert.equal(monthlyModelMessageLimit({}), 200);
  assert.equal(dailyUsagePeriod(instant), "2026-08-05");
  assert.equal(usagePeriod(instant), "2026-08");
});

test("only active and trialing subscriptions grant the larger subscriber allowance", () => {
  assert.equal(subscriptionHasAccess("active"), true);
  assert.equal(subscriptionHasAccess("trialing"), true);
  assert.equal(subscriptionHasAccess("past_due"), false);
  assert.equal(subscriptionHasAccess("canceled"), false);
});

test("model subscription uses standard Stripe Checkout parameters", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return Response.json({
      id: "cs_test_12345678",
      url: "https://checkout.stripe.com/c/pay/cs_test_12345678",
    });
  };

  try {
    const accountAlias = "A".repeat(43);
    const checkoutUrl = await createCheckoutSession(
      {
        STRIPE_SECRET_KEY: "sk_test_1234567890abcdefghijklmnop",
        STRIPE_WEBHOOK_SECRET: "whsec_1234567890abcdefghijklmnop",
        STRIPE_MODEL_CHOICE_PRICE_ID: "price_12345678",
        PUBLIC_ORIGIN: "https://stabilize.info",
      },
      {},
      accountAlias,
    );

    assert.equal(
      checkoutUrl,
      "https://checkout.stripe.com/c/pay/cs_test_12345678",
    );
    assert.equal(request.input, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.headers["Stripe-Version"], undefined);

    const params = new URLSearchParams(request.init.body);
    assert.equal(params.get("mode"), "subscription");
    assert.equal(params.has("managed_payments[enabled]"), false);
    assert.equal(params.get("line_items[0][price]"), "price_12345678");
    assert.equal(params.get("line_items[0][quantity]"), "1");
    assert.equal(params.get("client_reference_id"), accountAlias);
    assert.equal(params.get("metadata[account_key]"), accountAlias);
    assert.equal(
      params.get("subscription_data[metadata][account_key]"),
      accountAlias,
    );
    assert.equal(
      params.get("success_url"),
      "https://stabilize.info/?billing=success&session_id={CHECKOUT_SESSION_ID}",
    );
    assert.equal(
      params.get("cancel_url"),
      "https://stabilize.info/?billing=cancelled",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Stripe subscription events map to one account alias", () => {
  const alias = "A".repeat(43);
  const state = stateFromStripeEvent({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_12345678",
        customer: "cus_12345678",
        status: "active",
        metadata: { account_key: alias },
      },
    },
  });
  assert.deepEqual(state, {
    accountKey: alias,
    customerId: "cus_12345678",
    subscriptionId: "sub_12345678",
    subscriptionStatus: "active",
    updatedAt: state.updatedAt,
  });
  assert.ok(Number.isFinite(state.updatedAt));
});

test("Stripe webhook verification uses the raw body and rejects stale signatures", async () => {
  const secret = "whsec_1234567890abcdefgh";
  const payload = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
  const timestamp = 1_800_000_000;
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const header = `t=${timestamp},v1=${signature}`;

  assert.equal(
    await verifyStripeSignature(payload, header, secret, timestamp + 10),
    true,
  );
  assert.equal(
    await verifyStripeSignature(payload + " ", header, secret, timestamp + 10),
    false,
  );
  assert.equal(
    await verifyStripeSignature(payload, header, secret, timestamp + 301),
    false,
  );
});

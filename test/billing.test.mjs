import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const {
  modelChoices,
  stateFromStripeEvent,
  subscriptionHasAccess,
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

test("only active and trialing subscriptions grant model choice", () => {
  assert.equal(subscriptionHasAccess("active"), true);
  assert.equal(subscriptionHasAccess("trialing"), true);
  assert.equal(subscriptionHasAccess("past_due"), false);
  assert.equal(subscriptionHasAccess("canceled"), false);
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

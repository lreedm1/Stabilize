import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";

test("BillingAccount stores entitlement, model choice, and bounded monthly usage", async () => {
  const stub = env.BILLING.getByName("billing-account-lifecycle");

  assert.deepEqual(await stub.readState(), {
    customerId: null,
    subscriptionId: null,
    subscriptionStatus: "none",
    entitled: false,
    selectedModel: null,
    usagePeriod: null,
    usageCount: 0,
    updatedAt: null,
  });

  const active = await stub.updateBilling({
    customerId: "cus_12345678",
    subscriptionId: "sub_12345678",
    subscriptionStatus: "active",
  });
  assert.equal(active.entitled, true);

  const selected = await stub.setSelectedModel("gpt-5-mini");
  assert.equal(selected.selectedModel, "gpt-5-mini");

  assert.deepEqual(await stub.reserveUsage("2026-08", 2), {
    allowed: true,
    reason: null,
    used: 1,
    limit: 2,
  });
  assert.equal((await stub.reserveUsage("2026-08", 2)).used, 2);
  assert.deepEqual(await stub.reserveUsage("2026-08", 2), {
    allowed: false,
    reason: "limit",
    used: 2,
    limit: 2,
  });

  assert.equal(await stub.refundUsage("2026-08"), true);
  assert.equal((await stub.readState()).usageCount, 1);

  const canceled = await stub.updateBilling({
    customerId: "cus_12345678",
    subscriptionId: "sub_12345678",
    subscriptionStatus: "canceled",
  });
  assert.equal(canceled.entitled, false);
  assert.equal((await stub.reserveUsage("2026-08", 2)).reason, "inactive");
});

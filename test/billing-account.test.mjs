import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";

test("BillingAccount stores free model choice and separate daily and monthly quotas", async () => {
  const stub = env.BILLING.getByName("billing-account-free-daily-v1");

  assert.deepEqual(await stub.readState(), {
    customerId: null,
    subscriptionId: null,
    subscriptionStatus: "none",
    entitled: false,
    selectedModel: null,
    usagePeriod: null,
    usageCount: 0,
    paidUsagePeriod: null,
    paidUsageCount: 0,
    freeUsagePeriod: null,
    freeUsageCount: 0,
    updatedAt: null,
  });

  const freeSelection = await stub.setSelectedModel("gpt-5-mini");
  assert.equal(freeSelection.entitled, false);
  assert.equal(freeSelection.selectedModel, "gpt-5-mini");

  assert.deepEqual(await stub.reserveUsage("free", "2026-08-05", 2), {
    allowed: true,
    reason: null,
    used: 1,
    limit: 2,
  });
  assert.equal((await stub.reserveUsage("free", "2026-08-05", 2)).used, 2);
  assert.deepEqual(await stub.reserveUsage("free", "2026-08-05", 2), {
    allowed: false,
    reason: "limit",
    used: 2,
    limit: 2,
  });
  assert.equal(await stub.refundUsage("free", "2026-08-05"), true);
  assert.equal((await stub.readState()).freeUsageCount, 1);

  const nextDay = await stub.reserveUsage("free", "2026-08-06", 2);
  assert.equal(nextDay.allowed, true);
  assert.equal(nextDay.used, 1);
  const freeState = await stub.readState();
  assert.equal(freeState.freeUsagePeriod, "2026-08-06");
  assert.equal(freeState.freeUsageCount, 1);

  const active = await stub.updateBilling({
    customerId: "cus_12345678",
    subscriptionId: "sub_12345678",
    subscriptionStatus: "active",
  });
  assert.equal(active.entitled, true);
  assert.equal(active.selectedModel, "gpt-5-mini");

  assert.deepEqual(await stub.reserveUsage("paid", "2026-08", 2), {
    allowed: true,
    reason: null,
    used: 1,
    limit: 2,
  });
  assert.equal((await stub.reserveUsage("paid", "2026-08", 2)).used, 2);
  assert.deepEqual(await stub.reserveUsage("paid", "2026-08", 2), {
    allowed: false,
    reason: "limit",
    used: 2,
    limit: 2,
  });
  assert.equal(await stub.refundUsage("paid", "2026-08"), true);

  const separated = await stub.readState();
  assert.equal(separated.paidUsagePeriod, "2026-08");
  assert.equal(separated.paidUsageCount, 1);
  assert.equal(separated.usagePeriod, "2026-08");
  assert.equal(separated.usageCount, 1);
  assert.equal(separated.freeUsagePeriod, "2026-08-06");
  assert.equal(separated.freeUsageCount, 1);

  const canceled = await stub.updateBilling({
    customerId: "cus_12345678",
    subscriptionId: "sub_12345678",
    subscriptionStatus: "canceled",
  });
  assert.equal(canceled.entitled, false);
  assert.equal(
    (await stub.reserveUsage("paid", "2026-08", 2)).reason,
    "inactive",
  );
  assert.equal(
    (await stub.reserveUsage("free", "2026-08-06", 2)).allowed,
    true,
  );
});

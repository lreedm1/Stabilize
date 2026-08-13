import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";

test("feedback gate limits rapid submissions and refunds failed writes", async () => {
  const stub = env.FEEDBACK_LIMITS.getByName("feedback-gate-interval");
  const now = Date.parse("2026-08-02T20:00:00.000Z");

  const first = await stub.reserve(now);
  assert.equal(first.allowed, true);
  assert.match(first.reservationId, /^[a-f0-9-]{36}$/i);

  const rapid = await stub.reserve(now + 30_000);
  assert.equal(rapid.allowed, false);
  assert.equal(rapid.reason, "interval");
  assert.ok(rapid.retryAfterSeconds > 0);

  assert.equal(await stub.refund(first.reservationId), true);
  const retry = await stub.reserve(now + 31_000);
  assert.equal(retry.allowed, true);
});

test("feedback gate enforces a daily cap", async () => {
  const base = Date.parse("2026-08-02T00:00:00.000Z");
  const stub = env.FEEDBACK_LIMITS.getByName("feedback-gate-daily");

  for (let index = 0; index < 10; index += 1) {
    const result = await stub.reserve(base + index * 10 * 60 * 1_000);
    assert.equal(result.allowed, true);
  }

  const limited = await stub.reserve(base + 10 * 10 * 60 * 1_000);
  assert.equal(limited.allowed, false);
  assert.equal(limited.reason, "daily");

  const nextDay = await stub.reserve(base + 24 * 60 * 60 * 1_000);
  assert.equal(nextDay.allowed, true);
});

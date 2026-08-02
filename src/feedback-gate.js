import { DurableObject } from "cloudflare:workers";

const MINIMUM_INTERVAL_MS = 10 * 60 * 1_000;
const DAILY_LIMIT = 10;

function utcDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function emptyState(day) {
  return {
    day,
    count: 0,
    lastAt: 0,
    reservationId: null,
  };
}

export class FeedbackGate extends DurableObject {
  async reserve(now = Date.now()) {
    const timestamp = Number(now);
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error("Invalid feedback reservation time");
    }

    const day = utcDay(timestamp);
    const stored = await this.ctx.storage.get("feedback-limit");
    const state = stored?.day === day ? stored : emptyState(day);

    if (state.count >= DAILY_LIMIT) {
      const nextDay = Date.parse(`${day}T00:00:00.000Z`) + 24 * 60 * 60 * 1_000;
      return {
        allowed: false,
        reason: "daily",
        retryAfterSeconds: Math.max(60, Math.ceil((nextDay - timestamp) / 1_000)),
      };
    }

    const elapsed = timestamp - Number(state.lastAt || 0);
    if (state.lastAt && elapsed < MINIMUM_INTERVAL_MS) {
      return {
        allowed: false,
        reason: "interval",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((MINIMUM_INTERVAL_MS - elapsed) / 1_000),
        ),
      };
    }

    const reservationId = crypto.randomUUID();
    await this.ctx.storage.put("feedback-limit", {
      day,
      count: Number(state.count || 0) + 1,
      lastAt: timestamp,
      reservationId,
    });

    return {
      allowed: true,
      reservationId,
      remainingToday: Math.max(0, DAILY_LIMIT - Number(state.count || 0) - 1),
    };
  }

  async refund(reservationId) {
    const id = String(reservationId || "");
    if (!id) return false;
    const state = await this.ctx.storage.get("feedback-limit");
    if (!state || state.reservationId !== id) return false;

    await this.ctx.storage.put("feedback-limit", {
      ...state,
      count: Math.max(0, Number(state.count || 0) - 1),
      lastAt: 0,
      reservationId: null,
    });
    return true;
  }
}

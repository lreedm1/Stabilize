import { DurableObject } from "cloudflare:workers";

const MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const STRIPE_ID_PATTERN = /^(?:cus|sub)_[A-Za-z0-9]{8,}$/;
const STATUS_PATTERN = /^[a-z_]{1,32}$/;
const MONTHLY_PERIOD_PATTERN = /^\d{4}-\d{2}$/;
const DAILY_PERIOD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const USAGE_TIERS = new Set(["free", "paid"]);

function cleanStripeId(value, prefix) {
  const text = String(value || "").trim().slice(0, 128);
  return STRIPE_ID_PATTERN.test(text) && text.startsWith(prefix + "_")
    ? text
    : null;
}

function emptyState() {
  return {
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
  };
}

function normalizeReservation(tierOrPeriod, periodOrLimit, maybeLimit) {
  const legacy = maybeLimit === undefined;
  const tier = legacy ? "paid" : String(tierOrPeriod || "").trim();
  const period = String(legacy ? tierOrPeriod : periodOrLimit || "").trim();
  const limit = Number(legacy ? periodOrLimit : maybeLimit);
  const periodIsValid =
    tier === "paid"
      ? MONTHLY_PERIOD_PATTERN.test(period)
      : tier === "free" && DAILY_PERIOD_PATTERN.test(period);

  if (
    !USAGE_TIERS.has(tier) ||
    !periodIsValid ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  ) {
    throw new Error("Invalid usage reservation");
  }
  return { tier, period, limit };
}

function normalizeRefund(tierOrPeriod, maybePeriod) {
  const legacy = maybePeriod === undefined;
  const tier = legacy ? "paid" : String(tierOrPeriod || "").trim();
  const period = String(legacy ? tierOrPeriod : maybePeriod || "").trim();
  const periodIsValid =
    tier === "paid"
      ? MONTHLY_PERIOD_PATTERN.test(period)
      : tier === "free" && DAILY_PERIOD_PATTERN.test(period);
  return USAGE_TIERS.has(tier) && periodIsValid ? { tier, period } : null;
}

export class BillingAccount extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS billing_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          subscription_status TEXT NOT NULL DEFAULT 'none',
          selected_model TEXT,
          usage_period TEXT,
          usage_count INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS model_usage (
          tier TEXT NOT NULL CHECK (tier IN ('free', 'paid')),
          period TEXT NOT NULL,
          usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (tier, period)
        );
      `);
      this.ctx.storage.sql.exec(`
        INSERT OR IGNORE INTO model_usage (
          tier, period, usage_count, updated_at
        )
        SELECT 'paid', usage_period, usage_count, updated_at
        FROM billing_state
        WHERE usage_period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
          AND usage_count > 0;
      `);
    });
  }

  readUsage(tier) {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT period, usage_count
         FROM model_usage
         WHERE tier = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        tier,
      )
      .toArray()[0];
    return {
      period: row ? String(row.period || "") : null,
      count: row ? Math.max(0, Number(row.usage_count) || 0) : 0,
    };
  }

  async readState() {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT stripe_customer_id, stripe_subscription_id,
                subscription_status, selected_model, updated_at
         FROM billing_state WHERE id = 1`,
      )
      .toArray()[0];
    const paidUsage = this.readUsage("paid");
    const freeUsage = this.readUsage("free");
    if (!row) {
      return {
        ...emptyState(),
        usagePeriod: paidUsage.period,
        usageCount: paidUsage.count,
        paidUsagePeriod: paidUsage.period,
        paidUsageCount: paidUsage.count,
        freeUsagePeriod: freeUsage.period,
        freeUsageCount: freeUsage.count,
      };
    }

    const status = STATUS_PATTERN.test(String(row.subscription_status || ""))
      ? String(row.subscription_status)
      : "none";
    const selectedModel = MODEL_ID_PATTERN.test(String(row.selected_model || ""))
      ? String(row.selected_model)
      : null;

    return {
      customerId: cleanStripeId(row.stripe_customer_id, "cus"),
      subscriptionId: cleanStripeId(row.stripe_subscription_id, "sub"),
      subscriptionStatus: status,
      entitled: ACTIVE_STATUSES.has(status),
      selectedModel,
      usagePeriod: paidUsage.period,
      usageCount: paidUsage.count,
      paidUsagePeriod: paidUsage.period,
      paidUsageCount: paidUsage.count,
      freeUsagePeriod: freeUsage.period,
      freeUsageCount: freeUsage.count,
      updatedAt: Number(row.updated_at) || null,
    };
  }

  async updateBilling(update) {
    const customerId = cleanStripeId(update?.customerId, "cus");
    const subscriptionId = cleanStripeId(update?.subscriptionId, "sub");
    const status = String(update?.subscriptionStatus || "none")
      .trim()
      .slice(0, 32);
    if (!STATUS_PATTERN.test(status)) throw new Error("Invalid billing status");
    const now = Date.now();

    this.ctx.storage.sql.exec(
      `INSERT INTO billing_state (
         id, stripe_customer_id, stripe_subscription_id,
         subscription_status, selected_model,
         usage_period, usage_count, updated_at
       ) VALUES (1, ?, ?, ?, NULL, NULL, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         stripe_customer_id = COALESCE(
           excluded.stripe_customer_id,
           billing_state.stripe_customer_id
         ),
         stripe_subscription_id = COALESCE(
           excluded.stripe_subscription_id,
           billing_state.stripe_subscription_id
         ),
         subscription_status = excluded.subscription_status,
         updated_at = excluded.updated_at`,
      customerId,
      subscriptionId,
      status,
      now,
    );
    return this.readState();
  }

  async setSelectedModel(model) {
    const selectedModel = String(model || "").trim().slice(0, 128);
    if (!MODEL_ID_PATTERN.test(selectedModel)) {
      throw new Error("Invalid selected model");
    }
    const now = Date.now();

    this.ctx.storage.sql.exec(
      `INSERT INTO billing_state (
         id, subscription_status, selected_model,
         usage_period, usage_count, updated_at
       ) VALUES (1, 'none', ?, NULL, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         selected_model = excluded.selected_model,
         updated_at = excluded.updated_at`,
      selectedModel,
      now,
    );
    return this.readState();
  }

  async reserveUsage(tierOrPeriod, periodOrLimit, maybeLimit) {
    const { tier, period, limit } = normalizeReservation(
      tierOrPeriod,
      periodOrLimit,
      maybeLimit,
    );

    return this.ctx.storage.transactionSync(() => {
      if (tier === "paid") {
        const billing = this.ctx.storage.sql
          .exec(
            `SELECT subscription_status
             FROM billing_state
             WHERE id = 1`,
          )
          .toArray()[0];
        if (!billing || !ACTIVE_STATUSES.has(String(billing.subscription_status))) {
          return { allowed: false, reason: "inactive", used: 0, limit };
        }
      }

      const row = this.ctx.storage.sql
        .exec(
          `SELECT usage_count
           FROM model_usage
           WHERE tier = ? AND period = ?`,
          tier,
          period,
        )
        .toArray()[0];
      const used = row ? Math.max(0, Number(row.usage_count) || 0) : 0;
      if (used >= limit) {
        return { allowed: false, reason: "limit", used, limit };
      }

      const next = used + 1;
      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO model_usage (
           tier, period, usage_count, updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(tier, period) DO UPDATE SET
           usage_count = excluded.usage_count,
           updated_at = excluded.updated_at`,
        tier,
        period,
        next,
        now,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM model_usage
         WHERE tier = ? AND period <> ?`,
        tier,
        period,
      );
      return { allowed: true, reason: null, used: next, limit };
    });
  }

  async refundUsage(tierOrPeriod, maybePeriod) {
    const normalized = normalizeRefund(tierOrPeriod, maybePeriod);
    if (!normalized) return false;
    const { tier, period } = normalized;

    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec(
          `SELECT usage_count
           FROM model_usage
           WHERE tier = ? AND period = ?`,
          tier,
          period,
        )
        .toArray()[0];
      const used = row ? Math.max(0, Number(row.usage_count) || 0) : 0;
      if (used < 1) return false;
      this.ctx.storage.sql.exec(
        `UPDATE model_usage
         SET usage_count = ?, updated_at = ?
         WHERE tier = ? AND period = ?`,
        used - 1,
        Date.now(),
        tier,
        period,
      );
      return true;
    });
  }
}

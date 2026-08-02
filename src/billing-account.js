import { DurableObject } from "cloudflare:workers";

const MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const STRIPE_ID_PATTERN = /^(?:cus|sub)_[A-Za-z0-9]{8,}$/;
const STATUS_PATTERN = /^[a-z_]{1,32}$/;
const PERIOD_PATTERN = /^\d{4}-\d{2}$/;
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

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
    updatedAt: null,
  };
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
    });
  }

  async readState() {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT stripe_customer_id, stripe_subscription_id,
                subscription_status, selected_model,
                usage_period, usage_count, updated_at
         FROM billing_state WHERE id = 1`,
      )
      .toArray()[0];
    if (!row) return emptyState();

    const status = STATUS_PATTERN.test(String(row.subscription_status || ""))
      ? String(row.subscription_status)
      : "none";
    const selectedModel = MODEL_ID_PATTERN.test(String(row.selected_model || ""))
      ? String(row.selected_model)
      : null;
    const period = PERIOD_PATTERN.test(String(row.usage_period || ""))
      ? String(row.usage_period)
      : null;

    return {
      customerId: cleanStripeId(row.stripe_customer_id, "cus"),
      subscriptionId: cleanStripeId(row.stripe_subscription_id, "sub"),
      subscriptionStatus: status,
      entitled: ACTIVE_STATUSES.has(status),
      selectedModel,
      usagePeriod: period,
      usageCount: Math.max(0, Number(row.usage_count) || 0),
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
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, billing_state.stripe_customer_id),
         stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, billing_state.stripe_subscription_id),
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
    const current = await this.readState();
    if (!current.entitled) throw new Error("Model choice is not active");

    this.ctx.storage.sql.exec(
      `UPDATE billing_state
       SET selected_model = ?, updated_at = ?
       WHERE id = 1`,
      selectedModel,
      Date.now(),
    );
    return this.readState();
  }

  async reserveUsage(period, limit) {
    const cleanPeriod = String(period || "").trim();
    const cleanLimit = Number(limit);
    if (
      !PERIOD_PATTERN.test(cleanPeriod) ||
      !Number.isSafeInteger(cleanLimit) ||
      cleanLimit < 1
    ) {
      throw new Error("Invalid usage reservation");
    }

    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec(
          `SELECT subscription_status, usage_period, usage_count
           FROM billing_state WHERE id = 1`,
        )
        .toArray()[0];
      if (!row || !ACTIVE_STATUSES.has(String(row.subscription_status))) {
        return { allowed: false, reason: "inactive", used: 0, limit: cleanLimit };
      }

      const used = row.usage_period === cleanPeriod
        ? Math.max(0, Number(row.usage_count) || 0)
        : 0;
      if (used >= cleanLimit) {
        return { allowed: false, reason: "limit", used, limit: cleanLimit };
      }

      const next = used + 1;
      this.ctx.storage.sql.exec(
        `UPDATE billing_state
         SET usage_period = ?, usage_count = ?, updated_at = ?
         WHERE id = 1`,
        cleanPeriod,
        next,
        Date.now(),
      );
      return { allowed: true, reason: null, used: next, limit: cleanLimit };
    });
  }

  async refundUsage(period) {
    const cleanPeriod = String(period || "").trim();
    if (!PERIOD_PATTERN.test(cleanPeriod)) return false;
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec(
          `SELECT usage_period, usage_count FROM billing_state WHERE id = 1`,
        )
        .toArray()[0];
      if (!row || row.usage_period !== cleanPeriod) return false;
      const used = Math.max(0, Number(row.usage_count) || 0);
      if (used < 1) return false;
      this.ctx.storage.sql.exec(
        `UPDATE billing_state
         SET usage_count = ?, updated_at = ?
         WHERE id = 1`,
        used - 1,
        Date.now(),
      );
      return true;
    });
  }
}

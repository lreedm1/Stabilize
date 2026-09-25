import { DurableObject } from "cloudflare:workers";
import { freeTokenLimit, usageTokens } from "./openai-budget-policy.js";
import { freshOrganizationUsage, readOrganizationUsage, usageOrganization } from "./openai-organization-usage.js";

const DAY_MS = 86_400_000;
const RECEIPT_RETENTION_MS = 7 * DAY_MS;
const validId = (id) => typeof id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(id);

export class OpenAITokenBudget extends DurableObject {
  now() { return Date.now(); }

  async ledger(storage) {
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const state = await storage.get("ledger") || {
      day, initializedDay: day, used: 0, reserved: 0, providerUsed: 0, suspended: false,
    };
    state.providerUsed ??= 0;
    if (![state.used, state.reserved, state.providerUsed].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error("Invalid token ledger");
    }
    if (state.day !== day) {
      state.day = day;
      state.used = 0;
      state.providerUsed = 0;
      // Unknown and in-flight usage remains reserved even across midnight.
    }
    return state;
  }

  async reserve(id, tokens) {
    const limit = freeTokenLimit(this.env);
    if (!validId(id) || !Number.isSafeInteger(tokens) || tokens < 1) {
      throw new Error("Invalid token reservation");
    }
    let usage;
    try { usage = await readOrganizationUsage(this.env, { now: () => this.now() }); }
    catch { return { allowed: false, reason: "unavailable" }; }
    return this.ctx.storage.transaction(async (storage) => {
      const state = await this.ledger(storage);
      if (!freshOrganizationUsage(usage, usageOrganization(this.env), this.now()) ||
          (state.organization && state.organization !== usage.organization)) {
        return { allowed: false, reason: "unavailable" };
      }
      state.organization = usage.organization;
      // Never let a delayed, lower report reopen an already consumed budget.
      state.providerUsed = Math.max(state.providerUsed, usage.tokens);
      await storage.put("ledger", state);
      // On first activation we cannot know this organization's earlier usage.
      // Begin only after a complete provider reset; never assume a fresh quota.
      if (state.initializedDay === state.day) return { allowed: false, reason: "initializing" };
      if (state.suspended) return { allowed: false, reason: "suspended" };
      if (await storage.get(`reservation:${id}`)) return { allowed: false, reason: "duplicate" };
      // Add all local usage on top of the reported organization total. Some
      // local tokens can be counted twice, deliberately: the Usage API does not
      // prove which local receipts have appeared in its aggregate yet.
      const projected = state.providerUsed + state.used + state.reserved + tokens;
      if (!Number.isSafeInteger(projected) || projected > limit) {
        return { allowed: false, reason: "exhausted" };
      }
      state.reserved += tokens;
      await storage.put(`reservation:${id}`, { tokens, settled: false });
      await storage.put("ledger", state);
      return { allowed: true, day: state.day, tokens, usage };
    });
  }

  async settle(id, usage) {
    const actual = usageTokens(usage);
    if (!validId(id) || actual === null) return false;
    return this.ctx.storage.transaction(async (storage) => {
      const reservation = await storage.get(`reservation:${id}`);
      if (!reservation || reservation.settled) return false;
      const state = await this.ledger(storage);
      state.reserved -= reservation.tokens;
      state.used += actual;
      // An unexpected undercount is a fault, not permission to keep spending.
      if (actual > reservation.tokens) state.suspended = true;
      await storage.put("ledger", state);
      await storage.put(`reservation:${id}`, { ...reservation, settled: true });
      await storage.put(`receipt:${this.now() + RECEIPT_RETENTION_MS}:${id}`, id);
      if (await storage.getAlarm() === null) await storage.setAlarm(this.now() + DAY_MS);
      return true;
    });
  }

  async alarm() {
    // Pending reservations never expire automatically: an interrupted request
    // may have consumed tokens even when no usage receipt reached this Worker.
    const receipts = await this.ctx.storage.list({ prefix: "receipt:", limit: 1000 });
    for (const [key, id] of receipts) {
      if (Number(key.split(":")[1]) > this.now()) break;
      await this.ctx.storage.delete([key, `reservation:${id}`]);
    }
    if (receipts.size) await this.ctx.storage.setAlarm(this.now() + DAY_MS);
  }
}

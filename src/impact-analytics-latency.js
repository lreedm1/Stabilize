import { ImpactAnalytics as BaseImpactAnalytics } from "./impact-analytics.js";

function boundedTiming(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(600_000, Math.round(number));
}

export class ImpactAnalytics extends BaseImpactAnalytics {
  constructor(ctx, env) {
    super(ctx, env);
    this.firstTokenColumnReady = false;
  }

  async ensureFirstTokenColumn() {
    if (this.firstTokenColumnReady) return;
    const columns = this.ctx.storage.sql
      .exec("PRAGMA table_info(chat_turns)")
      .toArray();
    if (!columns.some((column) => column.name === "first_token_ms")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE chat_turns ADD COLUMN first_token_ms INTEGER",
      );
    }
    this.firstTokenColumnReady = true;
  }

  async finishChat(record) {
    const result = await super.finishChat(record);
    const turnId = String(record?.turnId || "").trim().slice(0, 64);
    if (!turnId) return result;

    await this.ensureFirstTokenColumn();
    this.ctx.storage.sql.exec(
      "UPDATE chat_turns SET first_token_ms = ? WHERE turn_id = ?",
      boundedTiming(record?.firstTokenMs),
      turnId,
    );
    return result;
  }
}

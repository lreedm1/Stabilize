// Only the models currently used by Stabilize are approved. New models require
// an eligibility review; matching a model-name prefix is deliberately insufficient.
export const FREE_TOKEN_MODELS = new Set(["gpt-5.4", "gpt-5.6-sol"]);
export const DAILY_TOKEN_LIMIT_CODE = "stabilize_daily_token_limit";
export const TOKEN_BUDGET_UNAVAILABLE_CODE = "stabilize_token_budget_unavailable";
export const DAILY_TOKEN_LIMIT_MESSAGE =
  "Stabilize's daily AI allowance is unavailable. Please try again after 00:00 UTC.";
export const TOKEN_BUDGET_UNAVAILABLE_MESSAGE =
  "Stabilize's free AI allowance is temporarily unavailable. Please try again later.";

export function freeTokenLimit(env) {
  const allowance = Number(env.OPENAI_FREE_TOKEN_ALLOWANCE);
  const limit = Number(env.OPENAI_FREE_TOKEN_DAILY_LIMIT);
  if (
    env.OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED !== "true" ||
    ![250_000, 1_000_000].includes(allowance) ||
    !Number.isSafeInteger(limit) || limit < 1 ||
    limit > Math.floor(allowance * 0.9)
  ) throw new Error("Free token eligibility or budget is not configured");
  return limit;
}

export function usageTokens(usage) {
  if (!usage || ![usage.input_tokens, usage.output_tokens].every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  )) return null;
  const total = usage.input_tokens + usage.output_tokens;
  if (!Number.isSafeInteger(total)) return null;
  if (usage.total_tokens !== undefined && usage.total_tokens !== total) return null;
  // Cached input still consumes the allowance. Reasoning is already in output.
  return total;
}

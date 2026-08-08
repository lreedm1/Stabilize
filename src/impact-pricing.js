export const IMPACT_PRICING_VERSION = "openai-2026-08-08-v1";
export const IMPACT_PRICING_SOURCE =
  "OpenAI API pricing and Priority Processing checked 2026-08-08";

const LONG_CONTEXT_THRESHOLD = 272_000;

// Rates are USD per one million tokens. The Priority table uses the
// published Priority/Fast processing prices rather than applying a generic
// multiplier. GPT-5.6 cache writes use the published 1.25x uncached-input
// rate. Reasoning tokens are included in output_tokens and are therefore not
// billed a second time.
const MODEL_PRICES = {
  "gpt-5.6-sol": {
    standard: { input: 5, cached: 0.5, cacheWrite: 6.25, output: 30 },
    priority: { input: 10, cached: 1, cacheWrite: 12.5, output: 60 },
    longContext: true,
  },
  "gpt-5.6-terra": {
    standard: { input: 2.5, cached: 0.25, cacheWrite: 3.125, output: 15 },
    priority: { input: 5, cached: 0.5, cacheWrite: 6.25, output: 30 },
    longContext: true,
  },
  "gpt-5.6-luna": {
    standard: { input: 1, cached: 0.1, cacheWrite: 1.25, output: 6 },
    priority: { input: 2, cached: 0.2, cacheWrite: 2.5, output: 12 },
    longContext: true,
  },
  "gpt-5.5": {
    standard: { input: 5, cached: 0.5, cacheWrite: null, output: 30 },
    priority: { input: 12.5, cached: 1.25, cacheWrite: null, output: 75 },
    longContext: true,
  },
  "gpt-5.4": {
    standard: { input: 2.5, cached: 0.25, cacheWrite: null, output: 15 },
    priority: { input: 5, cached: 0.5, cacheWrite: null, output: 30 },
    longContext: true,
  },
  "gpt-5.4-mini": {
    standard: { input: 0.75, cached: 0.075, cacheWrite: null, output: 4.5 },
    priority: { input: 1.5, cached: 0.15, cacheWrite: null, output: 9 },
    longContext: false,
  },
  "gpt-5.2": {
    standard: { input: 1.75, cached: 0.175, cacheWrite: null, output: 14 },
    priority: { input: 3.5, cached: 0.35, cacheWrite: null, output: 28 },
    longContext: false,
  },
  "gpt-5.1": {
    standard: { input: 1.25, cached: 0.125, cacheWrite: null, output: 10 },
    priority: { input: 2.5, cached: 0.25, cacheWrite: null, output: 20 },
    longContext: false,
  },
  "gpt-5": {
    standard: { input: 1.25, cached: 0.125, cacheWrite: null, output: 10 },
    priority: { input: 2.5, cached: 0.25, cacheWrite: null, output: 20 },
    longContext: false,
  },
};

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(number))
    : 0;
}

function canonicalModel(model) {
  const value = String(model || "").trim().toLowerCase();
  if (!value) return "";
  if (value === "gpt-5.6") return "gpt-5.6-sol";
  for (const candidate of Object.keys(MODEL_PRICES).sort(
    (left, right) => right.length - left.length,
  )) {
    if (value === candidate || value.startsWith(candidate + "-")) {
      return candidate;
    }
  }
  return "";
}

function pricingMode(requestedServiceTier, actualServiceTier) {
  const actual = String(actualServiceTier || "").trim().toLowerCase();
  const requested = String(requestedServiceTier || "")
    .trim()
    .toLowerCase();
  const effective = actual || requested || "default";
  return ["priority", "fast"].includes(effective) ? "priority" : "standard";
}

function microsForTokens(tokens, dollarsPerMillion) {
  // $1 per million tokens equals one micro-dollar per token.
  return tokens * Number(dollarsPerMillion || 0);
}

export function estimateChatCostMicros(record = {}) {
  const inputTokens = tokenCount(record.inputTokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    tokenCount(record.cachedInputTokens),
  );
  const cacheWriteTokens = Math.min(
    Math.max(0, inputTokens - cachedInputTokens),
    tokenCount(record.cacheWriteTokens),
  );
  const outputTokens = tokenCount(record.outputTokens);
  const uncachedInputTokens = Math.max(
    0,
    inputTokens - cachedInputTokens - cacheWriteTokens,
  );
  const totalBilledTokens = inputTokens + outputTokens;
  const model = canonicalModel(record.model);
  const mode = pricingMode(
    record.requestedServiceTier,
    record.actualServiceTier,
  );

  if (totalBilledTokens === 0 && cacheWriteTokens === 0) {
    return {
      costMicros: 0,
      status: "no_usage",
      pricingVersion: IMPACT_PRICING_VERSION,
      pricingMode: mode,
      canonicalModel: model || null,
      uncachedInputTokens,
    };
  }

  const modelPrices = MODEL_PRICES[model];
  if (!modelPrices) {
    return {
      costMicros: 0,
      status: "unknown_model",
      pricingVersion: IMPACT_PRICING_VERSION,
      pricingMode: mode,
      canonicalModel: null,
      uncachedInputTokens,
    };
  }

  const prices = modelPrices[mode];
  if (cacheWriteTokens > 0 && !Number.isFinite(prices.cacheWrite)) {
    return {
      costMicros: 0,
      status: "unknown_cache_write_price",
      pricingVersion: IMPACT_PRICING_VERSION,
      pricingMode: mode,
      canonicalModel: model,
      uncachedInputTokens,
    };
  }

  const longContextMultiplier =
    modelPrices.longContext && inputTokens > LONG_CONTEXT_THRESHOLD
      ? { input: 2, output: 1.5 }
      : { input: 1, output: 1 };
  const cost =
    microsForTokens(
      uncachedInputTokens,
      prices.input * longContextMultiplier.input,
    ) +
    microsForTokens(
      cachedInputTokens,
      prices.cached * longContextMultiplier.input,
    ) +
    microsForTokens(
      cacheWriteTokens,
      Number(prices.cacheWrite || 0) * longContextMultiplier.input,
    ) +
    microsForTokens(
      outputTokens,
      prices.output * longContextMultiplier.output,
    );

  return {
    costMicros: Math.max(0, Math.round(cost)),
    status: "priced",
    pricingVersion: IMPACT_PRICING_VERSION,
    pricingMode: mode,
    canonicalModel: model,
    uncachedInputTokens,
  };
}

export function pricingCatalogForTests() {
  return structuredClone(MODEL_PRICES);
}

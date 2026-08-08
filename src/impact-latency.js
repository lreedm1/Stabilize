export const LATENCY_BUCKETS_MS = Object.freeze([
  100,
  200,
  300,
  500,
  750,
  1_000,
  1_500,
  2_000,
  3_000,
  5_000,
  7_500,
  10_000,
  15_000,
  20_000,
  30_000,
  45_000,
  60_000,
  120_000,
  300_000,
  600_000,
]);

const DIMENSIONS = Object.freeze([
  "accountType",
  "messagePosition",
  "model",
  "memorySource",
]);

function boundedLatency(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(600_000, Math.round(number));
}

function dimensionValue(value, fallback = "unknown") {
  const text = String(value || "").trim().slice(0, 128);
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : fallback;
}

export function emptyLatencyHistogram() {
  return {
    count: 0,
    sumMs: 0,
    buckets: Array(LATENCY_BUCKETS_MS.length).fill(0),
  };
}

export function addLatencySample(histogram, value) {
  const milliseconds = boundedLatency(value);
  if (milliseconds === null) return histogram;
  const target = histogram || emptyLatencyHistogram();
  target.count += 1;
  target.sumMs += milliseconds;
  const index = LATENCY_BUCKETS_MS.findIndex(
    (upperBound) => milliseconds <= upperBound,
  );
  target.buckets[index < 0 ? target.buckets.length - 1 : index] += 1;
  return target;
}

export function mergeLatencyHistograms(target, source) {
  const merged = target || emptyLatencyHistogram();
  if (!source) return merged;
  merged.count += Math.max(0, Number(source.count) || 0);
  merged.sumMs += Math.max(0, Number(source.sumMs) || 0);
  for (let index = 0; index < merged.buckets.length; index += 1) {
    merged.buckets[index] += Math.max(
      0,
      Number(source.buckets?.[index]) || 0,
    );
  }
  return merged;
}

export function latencyPercentile(histogram, percentile) {
  const count = Math.max(0, Number(histogram?.count) || 0);
  if (!count) return null;
  const boundedPercentile = Math.min(1, Math.max(0, Number(percentile) || 0));
  const target = Math.max(1, Math.ceil(count * boundedPercentile));
  let cumulative = 0;
  for (let index = 0; index < LATENCY_BUCKETS_MS.length; index += 1) {
    cumulative += Math.max(0, Number(histogram?.buckets?.[index]) || 0);
    if (cumulative >= target) return LATENCY_BUCKETS_MS[index];
  }
  return LATENCY_BUCKETS_MS.at(-1);
}

export function summarizeLatencyHistogram(histogram) {
  const count = Math.max(0, Number(histogram?.count) || 0);
  return {
    count,
    p50Ms: latencyPercentile(histogram, 0.5),
    p95Ms: latencyPercentile(histogram, 0.95),
    averageMs:
      count > 0
        ? Math.round(Math.max(0, Number(histogram?.sumMs) || 0) / count)
        : null,
  };
}

function emptyMetricBreakdown() {
  return {
    overall: emptyLatencyHistogram(),
    accountType: {},
    messagePosition: {},
    model: {},
    memorySource: {},
  };
}

export function emptyLatencyBreakdowns() {
  return {
    firstToken: emptyMetricBreakdown(),
    totalResponse: emptyMetricBreakdown(),
  };
}

function histogramForDimension(metric, dimension, value) {
  const key = dimensionValue(value);
  metric[dimension][key] ||= emptyLatencyHistogram();
  return metric[dimension][key];
}

function addMetricSample(metric, value, dimensions) {
  const milliseconds = boundedLatency(value);
  if (milliseconds === null) return;
  addLatencySample(metric.overall, milliseconds);
  for (const dimension of DIMENSIONS) {
    addLatencySample(
      histogramForDimension(metric, dimension, dimensions[dimension]),
      milliseconds,
    );
  }
}

export function addTurnLatency(breakdowns, row = {}) {
  const target = breakdowns || emptyLatencyBreakdowns();
  const turnIndex = Math.max(0, Number(row.conversationTurnIndex) || 0);
  const dimensions = {
    accountType: dimensionValue(row.accountType),
    messagePosition:
      turnIndex === 1 ? "first" : turnIndex > 1 ? "follow_up" : "unknown",
    model: dimensionValue(row.model),
    memorySource: dimensionValue(row.memorySource),
  };
  addMetricSample(target.firstToken, row.firstTokenMs, dimensions);
  addMetricSample(target.totalResponse, row.totalResponseMs, dimensions);
  return target;
}

function mergeMetricBreakdown(target, source) {
  mergeLatencyHistograms(target.overall, source?.overall);
  for (const dimension of DIMENSIONS) {
    for (const [key, histogram] of Object.entries(source?.[dimension] || {})) {
      target[dimension][key] ||= emptyLatencyHistogram();
      mergeLatencyHistograms(target[dimension][key], histogram);
    }
  }
}

export function mergeLatencyBreakdowns(breakdownsList = []) {
  const merged = emptyLatencyBreakdowns();
  for (const breakdowns of breakdownsList) {
    if (!breakdowns) continue;
    mergeMetricBreakdown(merged.firstToken, breakdowns.firstToken);
    mergeMetricBreakdown(merged.totalResponse, breakdowns.totalResponse);
  }
  return merged;
}

function summarizeMetricBreakdown(metric) {
  const summary = {
    overall: summarizeLatencyHistogram(metric?.overall),
    accountType: {},
    messagePosition: {},
    model: {},
    memorySource: {},
  };
  for (const dimension of DIMENSIONS) {
    for (const [key, histogram] of Object.entries(metric?.[dimension] || {})) {
      summary[dimension][key] = summarizeLatencyHistogram(histogram);
    }
  }
  return summary;
}

export function summarizeLatencyBreakdowns(breakdowns) {
  return {
    firstToken: summarizeMetricBreakdown(breakdowns?.firstToken),
    totalResponse: summarizeMetricBreakdown(breakdowns?.totalResponse),
  };
}

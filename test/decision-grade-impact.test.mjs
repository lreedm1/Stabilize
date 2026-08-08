import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addTurnLatency,
  emptyLatencyBreakdowns,
  latencyPercentile,
  mergeLatencyBreakdowns,
  summarizeLatencyBreakdowns,
} from "../src/impact-latency.js";
import {
  IMPACT_PRICING_VERSION,
  estimateChatCostMicros,
} from "../src/impact-pricing.js";

test("versioned pricing uses provider tokens and the actual Fast tier", () => {
  const priced = estimateChatCostMicros({
    model: "gpt-5.6-sol",
    requestedServiceTier: "fast",
    actualServiceTier: "priority",
    inputTokens: 1_000,
    cachedInputTokens: 400,
    cacheWriteTokens: 100,
    reasoningTokens: 40,
    outputTokens: 100,
  });

  // 500 uncached input * $10/M + 400 cached * $1/M +
  // 100 explicit cache-write * $12.50/M + 100 output * $60/M.
  assert.deepEqual(priced, {
    costMicros: 12_650,
    status: "priced",
    pricingVersion: IMPACT_PRICING_VERSION,
    pricingMode: "priority",
    canonicalModel: "gpt-5.6-sol",
    uncachedInputTokens: 500,
  });

  const withoutReasoningField = estimateChatCostMicros({
    model: "gpt-5.6-sol",
    requestedServiceTier: "fast",
    actualServiceTier: "priority",
    inputTokens: 1_000,
    cachedInputTokens: 400,
    cacheWriteTokens: 100,
    outputTokens: 100,
  });
  assert.equal(
    withoutReasoningField.costMicros,
    priced.costMicros,
    "reasoning tokens are already included in output_tokens and must not be billed twice",
  );
});

test("unknown models remain visibly unpriced rather than receiving a guess", () => {
  assert.deepEqual(
    estimateChatCostMicros({
      model: "future-model-with-no-price",
      requestedServiceTier: "fast",
      inputTokens: 1_000,
      outputTokens: 100,
    }),
    {
      costMicros: 0,
      status: "unknown_model",
      pricingVersion: IMPACT_PRICING_VERSION,
      pricingMode: "priority",
      canonicalModel: null,
      uncachedInputTokens: 1_000,
    },
  );
});

test("latency histograms merge across shards and preserve p50 and p95 segments", () => {
  const firstShard = emptyLatencyBreakdowns();
  for (const [firstTokenMs, totalResponseMs, turn] of [
    [120, 900, 1],
    [180, 1_100, 2],
    [220, 1_300, 3],
  ]) {
    addTurnLatency(firstShard, {
      accountType: "guest",
      messagePosition: turn === 1 ? "first" : "follow_up",
      conversationTurnIndex: turn,
      model: "gpt-5.6-sol",
      memorySource: "guest",
      firstTokenMs,
      totalResponseMs,
    });
  }

  const secondShard = emptyLatencyBreakdowns();
  addTurnLatency(secondShard, {
    accountType: "signed_in",
    conversationTurnIndex: 1,
    model: "gpt-5.6-sol",
    memorySource: "prefetched",
    firstTokenMs: 2_900,
    totalResponseMs: 8_200,
  });

  const merged = mergeLatencyBreakdowns([firstShard, secondShard]);
  const summary = summarizeLatencyBreakdowns(merged);
  assert.equal(summary.firstToken.overall.count, 4);
  assert.equal(summary.firstToken.overall.p50Ms, 200);
  assert.equal(summary.firstToken.overall.p95Ms, 3_000);
  assert.equal(summary.totalResponse.overall.p50Ms, 1_500);
  assert.equal(summary.totalResponse.overall.p95Ms, 10_000);
  assert.equal(summary.firstToken.accountType.guest.count, 3);
  assert.equal(summary.firstToken.accountType.signed_in.count, 1);
  assert.equal(summary.firstToken.messagePosition.first.count, 2);
  assert.equal(summary.firstToken.messagePosition.follow_up.count, 2);
  assert.equal(summary.firstToken.memorySource.prefetched.p95Ms, 3_000);
  assert.equal(
    latencyPercentile(merged.firstToken.overall, 0.95),
    summary.firstToken.overall.p95Ms,
  );
});

test("the runtime carries provider usage into decision-grade impact without chat text", async () => {
  const [
    index,
    chatEvents,
    analytics,
    shards,
    dashboard,
    packageSource,
  ] = await Promise.all([
    readFile("src/index.js", "utf8"),
    readFile("src/chat-latency-events.js", "utf8"),
    readFile("src/impact-analytics-latency.js", "utf8"),
    readFile("src/impact-shards.js", "utf8"),
    readFile("src/impact-dashboard.js", "utf8"),
    readFile("package.json", "utf8"),
  ]);

  for (const field of [
    "requestedServiceTier",
    "actualServiceTier",
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteTokens",
    "reasoningTokens",
    "outputTokens",
  ]) {
    assert.match(index, new RegExp(field));
    assert.match(chatEvents, new RegExp(field));
  }
  assert.match(index, /analytics: analytics \|\| zeroUsageSnapshot\(\)/);
  assert.match(chatEvents, /normalizeUsage\(event\?\.analytics\)/);
  assert.match(chatEvents, /X-Stabilize-Model-Selected/);
  assert.match(chatEvents, /X-Stabilize-Memory-Source/);
  assert.match(analytics, /estimateChatCostMicros/);
  assert.match(analytics, /pricingCoverageRate/);
  assert.match(analytics, /helpfulConversationsPerDollar/);
  assert.match(analytics, /conversation_turn_index/);
  assert.match(shards, /mergeLatencyBreakdowns/);
  assert.match(shards, /mergeDecisionGradeMetrics/);

  for (const label of [
    "First-token p50",
    "First-token p95",
    "Total-response p50",
    "Total-response p95",
    "Helpful conversations / $",
    "Est. cost / helpful conversation",
    "Pricing coverage",
    "Latency breakdown",
    "Model and cost breakdown",
  ]) {
    assert.match(
      dashboard,
      new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /finalize-decision-grade-impact\.mjs$/,
  );
  assert.match(
    packageJson.scripts["test:node"],
    /decision-grade-impact\.test\.mjs/,
  );
  assert.match(
    packageJson.scripts["test:worker"],
    /decision-grade-impact-worker\.test\.mjs/,
  );

  const allImpactSource = `${chatEvents}\n${analytics}\n${shards}`;
  assert.doesNotMatch(
    allImpactSource,
    /userMessage|assistantReply|conversationText|promptText|responseTextStored/,
  );
});

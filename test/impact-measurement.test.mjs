import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  worker,
  events,
  shards,
  dashboard,
  analytics,
  client,
  styles,
  router,
  wrangler,
] = await Promise.all([
  readFile("src/impact-worker.js", "utf8"),
  readFile("src/impact-events.js", "utf8"),
  readFile("src/impact-shards.js", "utf8"),
  readFile("src/impact-dashboard.js", "utf8"),
  readFile("src/impact-analytics.js", "utf8"),
  readFile("public/impact.js", "utf8"),
  readFile("public/impact.css", "utf8"),
  readFile("src/domain-router.js", "utf8"),
  readFile("wrangler.jsonc", "utf8"),
]);

test("orderly impact uses one question and one structured event", () => {
  assert.match(worker, /\/api\/impact-event/);
  assert.match(worker, /\/admin\/impact/);
  assert.match(events, /X-Stabilize-Turn-Id/);
  assert.match(shards, /IMPACT_SHARD_COUNT = 16/);
  assert.doesNotMatch(shards, /global-impact-v1/);
  assert.match(events, /impact\.js\?v=/);

  assert.match(client, /Did you choose a next step\?/);
  assert.match(client, /event: "next_step_reported"/);
  assert.match(client, /\["Yes", "yes"\]/);
  assert.match(client, /\["Partly", "partly"\]/);
  assert.match(client, /\["No", "no"\]/);
  assert.match(client, /URGENT_ROUTES/);
  assert.match(client, /X-Stabilize-Session-Id/);
  assert.match(client, /X-Stabilize-Browser-Id/);
  assert.match(client, /response\.status === 409/);
  assert.match(client, /message text isn’t recorded/);

  assert.doesNotMatch(client, /What are you leaving with\?/);
  assert.doesNotMatch(client, /Did Stabilize respond at the right level\?/);
  assert.doesNotMatch(client, /proportionality_answered/);
  assert.doesNotMatch(client, /clarity_answered/);
  assert.doesNotMatch(client, /outcome_selected/);

  assert.match(events, /const EVENT_TYPE = "next_step_reported"/);
  assert.match(events, /id=\"outcome-measurement\"/);
  assert.match(styles, /\.impact-outcome-card/);
  assert.doesNotMatch(
    `${worker}\n${events}\n${shards}\n${dashboard}`,
    /userMessage|assistantReply|conversationText/,
  );
});

test("one row advances from shown to a first answer", () => {
  assert.match(analytics, /const NEXT_STEP_EVENT = "next_step_reported"/);
  assert.match(analytics, /existing\.event_value !== "shown"/);
  assert.match(analytics, /eventValue === "shown"/);
  assert.match(analytics, /UPDATE impact_events SET/);
  assert.match(analytics, /first answer wins/);
  assert.match(analytics, /reportedResolutionRate/);
  assert.match(analytics, /estimatedCostPerResolutionMicros/);
  assert.match(analytics, /MAX_EVENTS_PER_SESSION_HOUR/);
});

test("the private dashboard has six numbers and one weekly decision", () => {
  assert.equal((dashboard.match(/<div class=\"tile\">/g) || []).length, 6);
  for (const label of [
    "Eligible checks shown",
    "Reports received",
    "Response rate",
    "Reported next-step rate",
    "Est. cost / reported next step",
    "Self-funding ratio",
  ]) {
    assert.match(
      dashboard,
      new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(dashboard, /One decision this week/);
  assert.match(dashboard, /Guardrails that cannot be traded away/);
});

test("Cloudflare exports and binds the impact durable object", () => {
  assert.match(router, /ImpactAnalytics/);
  assert.match(router, /\.\/impact-worker\.js/);
  assert.match(wrangler, /"name": "IMPACT"/);
  assert.match(wrangler, /"class_name": "ImpactAnalytics"/);
  assert.match(wrangler, /"tag": "v4"/);
});

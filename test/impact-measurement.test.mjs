import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [worker, events, shards, dashboard, analytics, client, styles, router, wrangler] = await Promise.all([
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

test("outcome measurement is injected without transcript analytics", () => {
  assert.match(worker, /\/api\/impact-event/);
  assert.match(worker, /\/admin\/impact/);
  assert.match(events, /X-Stabilize-Turn-Id/);
  assert.match(shards, /IMPACT_SHARD_COUNT = 16/);
  assert.doesNotMatch(shards, /global-impact-v1/);
  assert.match(events, /impact\.js\?v=/);
  assert.match(client, /Did this answer what you needed\?/);
  assert.match(client, /Is your next step clearer\?/);
  assert.match(client, /What are you leaving with\?/);
  assert.match(client, /What would help most now\?/);
  assert.match(client, /proportionality_answered/);
  assert.match(client, /X-Stabilize-Session-Id/);
  assert.match(client, /X-Stabilize-Browser-Id/);
  assert.match(client, /response\.status === 409/);
  assert.match(client, /message text isn’t recorded/);
  assert.match(events, /id=\"outcome-measurement\"/);
  assert.match(dashboard, /Orderly impact/);
  assert.doesNotMatch(`${worker}\n${events}\n${shards}\n${dashboard}`, /userMessage|assistantReply|conversationText/);
  assert.doesNotMatch(analytics, /message_content|prompt_body|assistant_reply/);
  assert.match(styles, /\.impact-outcome-card/);
});

test("impact data is structured, bounded, and joined to a server turn", () => {
  assert.match(analytics, /CREATE TABLE IF NOT EXISTS chat_turns/);
  assert.match(analytics, /CREATE TABLE IF NOT EXISTS impact_events/);
  assert.match(analytics, /verified_turn/);
  assert.match(analytics, /MAX_EVENTS_PER_SESSION_HOUR/);
  assert.match(analytics, /reportedResolutionRate/);
  assert.match(analytics, /resolutionLowerBound/);
  assert.match(analytics, /estimatedCostPerResolutionMicros/);
});

test("Cloudflare exports and binds the impact durable object", () => {
  assert.match(router, /ImpactAnalytics/);
  assert.match(router, /\.\/impact-worker\.js/);
  assert.match(wrangler, /"name": "IMPACT"/);
  assert.match(wrangler, /"class_name": "ImpactAnalytics"/);
  assert.match(wrangler, /"tag": "v4"/);
});

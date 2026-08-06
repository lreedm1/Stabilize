import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  client: "public/message-feedback.js",
  css: "public/message-feedback.css",
  events: "src/impact-events.js",
  analytics: "src/impact-analytics.js",
  shards: "src/impact-shards.js",
  worker: "src/impact-worker.js",
  dashboard: "src/impact-dashboard.js",
  endpoint: "src/message-feedback.js",
};

async function source(path) {
  return readFile(path, "utf8");
}

test("each completed assistant response receives private inline feedback", async () => {
  const [client, css, events] = await Promise.all([
    source(files.client),
    source(files.css),
    source(files.events),
  ]);

  assert.match(client, /Was this helpful\?/);
  assert.match(client, /Mark this response helpful/);
  assert.match(client, /Mark this response not helpful/);
  assert.match(client, /message-feedback-reasons/);
  assert.match(client, /MAX_COMMENT_CHARS = 500/);
  assert.match(client, /completedTurns\.push\(turn\)/);
  assert.match(client, /article\.appendChild\(section\)/);
  assert.match(client, /postFeedback\(turn, "shown"\)/);
  assert.match(client, /response\.status === 409/);
  assert.doesNotMatch(client, /assistant(?:Message|Reply|Text)\s*:/);

  assert.match(css, /\.message-feedback \{/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(events, /message-feedback\.css/);
  assert.match(events, /message-feedback\.js/);
  assert.match(events, /optional details; those details are stored privately/);
  assert.match(events, /Did you choose a next step/);
});

test("message feedback is verified against the recorded chat turn", async () => {
  const [endpoint, worker, analytics] = await Promise.all([
    source(files.endpoint),
    source(files.worker),
    source(files.analytics),
  ]);

  assert.match(endpoint, /hashIdentifier\(env, "impact-session"/);
  assert.match(endpoint, /hashIdentifier\(env, "impact-browser"/);
  assert.match(endpoint, /store\.recordMessageFeedback/);
  assert.match(endpoint, /sameOriginRequest\(request\)/);
  assert.match(worker, /url\.pathname === "\/api\/message-feedback"/);
  assert.match(analytics, /CREATE TABLE IF NOT EXISTS message_feedback/);
  assert.match(analytics, /verifiedChat\(turnId, sessionHash, browserHash\)/);
  assert.match(analytics, /async recordMessageFeedback\(record\)/);
  assert.match(analytics, /DELETE FROM message_feedback WHERE occurred_at < \?/);
});

test("the private dashboard exposes engagement, quality, and comment review", async () => {
  const [analytics, shards, dashboard] = await Promise.all([
    source(files.analytics),
    source(files.shards),
    source(files.dashboard),
  ]);

  for (const field of [
    "feedbackResponseRate",
    "helpfulResponseRate",
    "secondMessageRate",
    "returningBrowserRate",
    "averageResponseMs",
    "estimatedCostPerHelpfulMicros",
    "recentFeedbackComments",
  ]) {
    assert.match(analytics, new RegExp(field));
    assert.match(shards, new RegExp(field));
  }

  assert.match(dashboard, /Chats started/);
  assert.match(dashboard, /Second-message rate/);
  assert.match(dashboard, /Helpful response rate/);
  assert.match(dashboard, /Feedback response rate/);
  assert.match(dashboard, /Top feedback reasons/);
  assert.match(dashboard, /Recent written feedback/);
  assert.match(dashboard, /feedbackCommentList\(summary\)/);
  assert.match(dashboard, /escapeHtml\(entry\.comment\)/);
  assert.match(dashboard, /Daily usage/);
});

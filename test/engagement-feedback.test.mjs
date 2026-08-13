import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  client: "public/message-feedback.js",
  outcomeClient: "public/impact.js",
  css: "public/message-feedback.css",
  impactCss: "public/impact.css",
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

test("each completed assistant response receives quiet private feedback", async () => {
  const [client, css, events] = await Promise.all([
    source(files.client),
    source(files.css),
    source(files.events),
  ]);

  assert.doesNotMatch(client, /Was this helpful\?/);
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
  assert.match(
    css,
    /\.message-feedback-choice\s*\{[\s\S]*?-webkit-appearance: none !important;[\s\S]*?background-color: transparent !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;[\s\S]*?font-size: 0;/,
  );
  assert.match(css, /\.message-feedback-choice::before/);
  assert.match(css, /-webkit-mask-image: url\("data:image\/svg\+xml/);
  assert.match(
    css,
    /\.message-feedback-choice\[data-value="down"\]::before\s*\{[\s\S]*?transform: rotate\(180deg\);/,
  );
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(events, /message-feedback\.css/);
  assert.match(events, /message-feedback\.js/);
  assert.match(events, /optional details; those details are stored privately/);
});

test("model-relevant follow-ups move beside the feedback icons", async () => {
  const [feedbackClient, impactClient, css, events] = await Promise.all([
    source(files.client),
    source(files.outcomeClient),
    source(files.css),
    source(files.events),
  ]);

  assert.match(impactClient, /FOLLOWUP_ACTION_EVENT/);
  assert.match(impactClient, /function modelReplyNeedsFollowups\(text, route\)/);
  assert.match(impactClient, /FOLLOWUP_REPLY_PATTERNS/);
  assert.match(impactClient, /FOLLOWUP_CUE_PATTERN/);
  assert.match(impactClient, /new CustomEvent\(FOLLOWUP_ACTION_EVENT/);
  assert.match(impactClient, /buttons: followupButtons/);
  assert.match(impactClient, /postNextStep\(turn, "shown"\)/);
  assert.match(impactClient, /postNextStep\(turn, "yes"\)/);
  assert.doesNotMatch(impactClient, /Did you choose a next step\?/);

  assert.match(feedbackClient, /pendingFollowupActions = new Map\(\)/);
  assert.match(feedbackClient, /followupActionHosts = new Map\(\)/);
  assert.match(feedbackClient, /function flushFollowupActions\(turnId\)/);
  assert.match(feedbackClient, /className = "message-feedback-actions"/);
  assert.match(feedbackClient, /className = "message-feedback-action"/);
  assert.match(feedbackClient, /row\.append\(up, down, actions\)/);

  assert.match(
    css,
    /\.outcome-tray\s*\{[\s\S]*?display: none !important;/,
  );
  assert.match(css, /\.message-feedback-actions \{/);
  assert.match(css, /\.message-feedback-action \{/);
  assert.match(events, /up to three optional action buttons beside/);
});

test("New conversation triggers optional whole-chat feedback only after reset succeeds", async () => {
  const [client, css, events] = await Promise.all([
    source(files.outcomeClient),
    source(files.impactCss),
    source(files.events),
  ]);

  assert.match(client, /Did this conversation help you move forward\?/);
  assert.match(client, /conversation_help_reported/);
  assert.match(client, /conversation-help-v1/);
  assert.match(client, /const previousTurn = latestTurn/);
  assert.match(client, /if \(response\.ok\) \{/);
  assert.match(client, /renderConversationFeedback\(previousTurn\)/);
  assert.doesNotMatch(client, /newConversationButton\.addEventListener/);
  assert.match(client, /URGENT_ROUTES\.has\(turn\.route\)/);
  assert.match(client, /Optional and separate from your new conversation/);
  assert.match(css, /\.impact-conversation-card/);
  assert.match(events, /conversation_help_reported/);
  assert.match(events, /separate non-blocking/);
});

test("engagement uses a rotating privacy-hashed conversation identifier", async () => {
  const [client, events, analytics, shards] = await Promise.all([
    source(files.outcomeClient),
    source(files.events),
    source(files.analytics),
    source(files.shards),
  ]);

  assert.match(client, /CONVERSATION_KEY/);
  assert.match(client, /X-Stabilize-Conversation-Id/);
  assert.match(client, /newConversationRequest\(input\)/);
  assert.match(client, /if \(response\.ok\) \{[\s\S]*rotateConversationId\(\)/);
  assert.match(events, /hashIdentifier\(env, "impact-conversation"/);
  assert.match(events, /conversationHash/);
  assert.match(analytics, /conversation_hash TEXT/);
  assert.match(analytics, /PRAGMA table_info\(chat_turns\)/);
  assert.match(analytics, /ALTER TABLE chat_turns ADD COLUMN conversation_hash TEXT/);
  assert.match(analytics, /COALESCE\(conversation_hash, session_hash\)/);
  assert.match(analytics, /multiTurnConversations/);
  assert.match(shards, /multiTurnConversations/);
  assert.doesNotMatch(shards, /multiTurnSessions/);
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
    "conversationResponseRate",
    "conversationHelpRate",
    "secondMessageRate",
    "returningBrowserRate",
    "averageResponseMs",
    "estimatedCostPerHelpfulMicros",
    "recentFeedbackComments",
  ]) {
    assert.match(analytics, new RegExp(field));
    assert.match(shards, new RegExp(field));
  }

  assert.match(dashboard, /Conversations started/);
  assert.match(dashboard, /Second-message rate/);
  assert.match(dashboard, /Helpful response rate/);
  assert.match(dashboard, /Feedback response rate/);
  assert.match(dashboard, /Conversation help rate/);
  assert.match(dashboard, /Conversation feedback rate/);
  assert.match(dashboard, /Top feedback reasons/);
  assert.match(dashboard, /Recent written feedback/);
  assert.match(dashboard, /feedbackCommentList\(summary\)/);
  assert.match(dashboard, /escapeHtml\(entry\.comment\)/);
  assert.match(dashboard, /Daily usage/);
});

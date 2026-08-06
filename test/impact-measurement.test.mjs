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

test("orderly impact keeps verified next-step and whole-conversation events", () => {
  assert.match(worker, /\/api\/impact-event/);
  assert.match(worker, /\/api\/message-feedback/);
  assert.match(worker, /\/admin\/impact/);
  assert.match(events, /X-Stabilize-Turn-Id/);
  assert.match(events, /conversation_help_reported/);
  assert.match(shards, /IMPACT_SHARD_COUNT = 16/);
  assert.doesNotMatch(shards, /global-impact-v1/);
  assert.match(events, /impact\.js\?v=/);
  assert.match(events, /message-feedback\.js\?v=/);

  assert.match(client, /Did you choose a next step\?/);
  assert.match(client, /"next_step_reported"/);
  assert.match(client, /Did this conversation help you move forward\?/);
  assert.match(client, /"conversation_help_reported"/);
  assert.match(client, /#new-conversation-button/);
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

  assert.match(events, /const EVENT_SCHEMAS =/);
  assert.match(events, /id=\"outcome-measurement\"/);
  assert.match(styles, /\.impact-outcome-card/);
  assert.match(styles, /\.impact-conversation-card/);
  assert.doesNotMatch(
    `${worker}\n${events}\n${shards}\n${dashboard}`,
    /userMessage|assistantReply|conversationText/,
  );
});

test("each structured outcome advances from shown to a first answer", () => {
  assert.match(analytics, /const NEXT_STEP_EVENT = "next_step_reported"/);
  assert.match(
    analytics,
    /const CONVERSATION_HELP_EVENT = "conversation_help_reported"/,
  );
  assert.match(analytics, /STRUCTURED_EVENT_TYPES/);
  assert.match(analytics, /existing\.event_value !== "shown"/);
  assert.match(analytics, /eventValue === "shown"/);
  assert.match(analytics, /UPDATE impact_events SET/);
  assert.match(analytics, /first answer wins/);
  assert.match(analytics, /reportedResolutionRate/);
  assert.match(analytics, /conversationHelpRate/);
  assert.match(analytics, /conversationResponseRate/);
  assert.match(analytics, /estimatedCostPerResolutionMicros/);
  assert.match(analytics, /MAX_EVENTS_PER_SESSION_HOUR/);
});

test("the private dashboard covers outcomes, engagement, quality, reliability, and cost", () => {
  assert.equal((dashboard.match(/<div class=\"tile\">/g) || []).length, 17);
  for (const label of [
    "Eligible checks shown",
    "Reports received",
    "Response rate",
    "Reported next-step rate",
    "Est. cost / reported next step",
    "Self-funding ratio",
    "Chats started",
    "Second-message rate",
    "Helpful response rate",
    "Feedback response rate",
    "Failed responses",
    "Average response time",
    "Returning-browser rate",
    "Est. cost / helpful response",
    "Written comments",
    "Conversation help rate",
    "Conversation feedback rate",
  ]) {
    assert.match(
      dashboard,
      new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(dashboard, /Daily usage/);
  assert.match(dashboard, /Top feedback reasons/);
  assert.match(dashboard, /Recent written feedback/);
  assert.match(dashboard, /feedbackCommentList\(summary\)/);
  assert.match(dashboard, /One decision this week/);
  assert.match(dashboard, /Guardrails that cannot be traded away/);
});

test("the weekly decision panel aligns with the other dashboard sections", () => {
  assert.match(
    dashboard,
    /\.decision\{width:100%;min-width:0;max-width:none;margin:0;padding:19px;border-left:0;text-align:left;justify-self:stretch\}/,
  );
  assert.doesNotMatch(dashboard, /\.decision\{[^}]*border-left:5px/);
  assert.doesNotMatch(dashboard, /\.decision\{[^}]*padding:22px/);
});

test("production dashboard access uses a public hash without committing the password", () => {
  const config = JSON.parse(wrangler);
  const configuredHash = config.vars.IMPACT_ADMIN_PASSWORD_SHA256;

  assert.match(configuredHash, /^(?:[0-9a-f]{8}:){7}[0-9a-f]{8}$/);
  assert.match(configuredHash.replaceAll(":", ""), /^[0-9a-f]{64}$/);
  assert.match(dashboard, /IMPACT_ADMIN_PASSWORD_SHA256/);
  assert.match(dashboard, /crypto\.subtle\.digest\(\s*"SHA-256"/);
  assert.match(dashboard, /adminSigningSecret/);
  assert.match(dashboard, /env\?\.AUTH_SECRET/);
  assert.doesNotMatch(wrangler, /STB-/);
  assert.doesNotMatch(dashboard, /c1926162cf30c39dcab9b52f41993fa981623d4120619aed82b56cb52e19de60/);
});

test("the private dashboard shares the Stabilize background and reading palette", () => {
  assert.equal(
    (
      dashboard.match(
        /guides\.css\?v=20260806-unified-site-theme-1/g,
      ) || []
    ).length,
    2,
  );
  for (const token of [
    "var(--stabilize-reading-surface)",
    "var(--stabilize-reading-text)",
    "var(--stabilize-reading-border)",
    "var(--stabilize-reading-shadow)",
    "var(--stabilize-reading-filter)",
  ]) {
    assert.ok(dashboard.includes(token), `Missing shared theme token ${token}`);
  }
  assert.match(
    dashboard,
    /\.tile,\.panel,\.note\{[^}]*background:var\(--stabilize-reading-surface\)/,
  );
  assert.match(
    dashboard,
    /input\{[^}]*background:var\(--stabilize-reading-surface\)[^}]*color:var\(--stabilize-reading-text\)/,
  );
  assert.doesNotMatch(dashboard, /#eef3ef|#edf3ef|background:#fff|color:#173f31/);
});

test("Cloudflare exports and binds the impact durable object", () => {
  assert.match(router, /ImpactAnalytics/);
  assert.match(router, /\.\/impact-worker\.js/);
  assert.match(wrangler, /"name": "IMPACT"/);
  assert.match(wrangler, /"class_name": "ImpactAnalytics"/);
  assert.match(wrangler, /"tag": "v4"/);
});

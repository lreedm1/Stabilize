import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("foreground browser response time reaches the private impact dashboard without chat text", async () => {
  const [
    client,
    events,
    worker,
    analytics,
    latency,
    shards,
    dashboard,
    packageSource,
    generator,
  ] = await Promise.all([
    read("public/impact.js"),
    read("src/impact-events.js"),
    read("src/impact-worker.js"),
    read("src/impact-analytics-latency.js"),
    read("src/impact-latency.js"),
    read("src/impact-shards.js"),
    read("src/impact-dashboard.js"),
    read("package.json"),
    read("scripts/apply-client-response-time.mjs"),
  ]);

  assert.match(client, /CLIENT_LATENCY_ENDPOINT = "\/api\/client-latency"/);
  assert.match(client, /CLIENT_LATENCY_VERSION = "browser-render-v1"/);
  assert.match(client, /performance\?\.now|performance\.now/);
  assert.match(client, /currentAssistantArticle\(\)/);
  assert.match(client, /afterNextPaint\(/);
  assert.match(client, /window\.requestAnimationFrame/);
  assert.match(client, /document\.visibilityState === "visible"/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /firstVisibleMs/);
  assert.match(client, /completeMs/);
  assert.match(client, /observeClientLatency\(\)/);

  const postStart = client.indexOf("async function postClientLatency(");
  const postEnd = client.indexOf("function queueClientLatencyPaint(", postStart);
  assert.ok(postStart >= 0 && postEnd > postStart);
  const clientPost = client.slice(postStart, postEnd);
  assert.doesNotMatch(
    clientPost,
    /userMessage|assistantReply|conversationText|prompt|messageText|replyText/,
  );

  assert.match(events, /export async function clientLatencyResponse\(/);
  assert.match(events, /CLIENT_LATENCY_VERSION = "browser-render-v1"/);
  assert.match(events, /completeMs < firstVisibleMs/);
  assert.match(events, /recordClientLatency\(/);
  assert.match(events, /tab stays continuously visible/);
  assert.match(worker, /url\.pathname === "\/api\/client-latency"/);

  assert.match(analytics, /client_first_visible_ms/);
  assert.match(analytics, /client_complete_ms/);
  assert.match(analytics, /client_latency_version/);
  assert.match(analytics, /async recordClientLatency\(/);
  assert.match(analytics, /verifiedChat\(turnId, sessionHash, browserHash\)/);
  assert.match(latency, /clientFirstVisible/);
  assert.match(latency, /clientComplete/);
  assert.match(shards, /clientTimingCoverageRate/);

  assert.match(dashboard, /Actual response time/);
  assert.match(dashboard, /Actual first-visible p50/);
  assert.match(dashboard, /Actual fully-rendered p95/);
  assert.match(dashboard, /Browser timing coverage/);
  assert.match(dashboard, /Hidden or backgrounded tabs are excluded/);
  assert.match(dashboard, /Latency breakdown · server/);

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /apply-client-response-time\.mjs && node scripts\/finalize-decision-grade-impact\.mjs && node scripts\/finalize-native-selected-mobile-v24\.mjs && node scripts\/finalize-native-selected-mobile-v24-regressions\.mjs && node scripts\/finalize-mobile-video-handoff-v31\.mjs && node scripts\/finalize-mobile-smooth-v32\.mjs && node scripts\/embed-favicon-fallback\.mjs$/,
  );
  assert.match(
    packageJson.scripts["test:node"],
    /client-response-time\.test\.mjs/,
  );
  assert.match(
    packageJson.scripts["test:worker"],
    /client-response-time-worker\.test\.mjs/,
  );
  assert.match(generator, /foreground browser response-time measurement/);
});

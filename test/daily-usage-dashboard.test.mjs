import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [analytics, shards, dashboard, generator, packageJson] = await Promise.all([
  readFile("src/impact-analytics.js", "utf8"),
  readFile("src/impact-shards.js", "utf8"),
  readFile("src/impact-dashboard.js", "utf8"),
  readFile("scripts/add-daily-usage-metrics.mjs", "utf8"),
  readFile("package.json", "utf8"),
]);

test("impact analytics groups daily users and messages without storing chat text", () => {
  assert.match(analytics, /COUNT\(DISTINCT browser_hash\) AS users/);
  assert.match(analytics, /COUNT\(\*\) AS messages/);
  assert.match(analytics, /GROUP BY day_number/);
  assert.match(analytics, /dailyUsage/);
  assert.doesNotMatch(analytics, /user_message|assistant_message|message_text/);
});

test("daily usage merges across privacy shards and appears in the dashboard", () => {
  assert.match(shards, /dailyUsageByDate/);
  assert.match(shards, /current\.users \+= Number\(day\.users/);
  assert.match(shards, /current\.messages \+= Number\(day\.messages/);
  assert.match(dashboard, /Daily usage/);
  assert.match(dashboard, /Unique browsers and submitted chat messages by UTC day/);
  assert.match(dashboard, />Users</);
  assert.match(dashboard, />Messages</);
  assert.match(dashboard, /dailyUsageTable\(summary\)/);
});

test("the canonical policy preserves the repeatable daily usage implementation", () => {
  const config = JSON.parse(packageJson);
  assert.equal(
    config.scripts["apply:prompt-policy"],
    "node scripts/apply-priority-latency.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs",
  );
  assert.match(generator, /if \(!text\.includes\("function dailyUsageRows"\)\)/);
  assert.match(generator, /if \(!text\.includes\('class="panel usage"'\)\)/);
  assert.match(generator, /if \(!text\.includes\("\.usage-heading\{"\)\)/);
});
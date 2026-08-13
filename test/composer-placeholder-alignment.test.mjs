import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the composer placeholder is centered horizontally while entered text stays left-aligned", async () => {
  const [css, worker, packageSource] = await Promise.all([
    read("public/billing.css"),
    read("src/paid-worker.js"),
    read("package.json"),
  ]);

  assert.match(css, /\/\* Horizontally centered composer placeholder \*\//);
  assert.match(
    css,
    /\.composer-dock textarea\s*\{[\s\S]*?text-align:\s*left;/,
  );
  assert.match(
    css,
    /\.composer-dock textarea::placeholder\s*\{[\s\S]*?text-align:\s*center;/,
  );
  assert.match(
    worker,
    /\/billing\.css\?v=20260808-gpt56-fast-first-1/,
  );

  const config = JSON.parse(packageSource);
  assert.equal(
    config.scripts["apply:prompt-policy"],
    "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/prepare-decision-grade-impact.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs && node scripts/apply-signed-in-prefetch-latency.mjs && node scripts/finalize-signed-in-prefetch-tests.mjs && node scripts/prepare-full-guest-cache-version.mjs && node scripts/remember-full-guest-conversation.mjs && node scripts/finalize-full-guest-conversation.mjs && node scripts/prepare-client-response-time.mjs && node scripts/materialize-mobile-forest-stream.mjs && node scripts/use-mobile-forest-stream.mjs && node scripts/apply-mobile-motion-canvas-v18.mjs && node scripts/apply-decision-grade-impact.mjs && node scripts/apply-client-response-time.mjs && node scripts/finalize-decision-grade-impact.mjs && node scripts/finalize-native-selected-mobile-v24.mjs && node scripts/finalize-native-selected-mobile-v24-regressions.mjs && node scripts/finalize-mobile-video-handoff-v31.mjs && node scripts/finalize-mobile-smooth-v32.mjs",
  );
});
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const POLICY_SCRIPTS = [
  "scripts/apply-4000-character-policy.mjs",
  "scripts/align-4000-character-tests.mjs",
  "scripts/prepare-openai-policy-pass.mjs",
  "scripts/apply-max-reasoning-slim-runtime.mjs",
  "scripts/align-max-reasoning-tests.mjs",
  "scripts/apply-recency-policy.mjs",
  "scripts/apply-streaming-policy.mjs",
  "scripts/align-streaming-compatibility.mjs",
  "scripts/finalize-streaming-handler.mjs",
  "scripts/fix-openai-response-schema.mjs",
  "scripts/use-supported-openai-model.mjs",
  "scripts/apply-adaptive-reasoning.mjs",
  "scripts/apply-new-conversation.mjs",
  "scripts/prepare-stream-hardening.mjs",
  "scripts/harden-openai-streaming.mjs",
  "scripts/restore-adaptive-stream-reasoning.mjs",
  "scripts/prepare-outcome-tray.mjs",
  "scripts/move-outcome-buttons-above-composer.mjs",
  "scripts/finalize-outcome-tray-tests.mjs",
  "scripts/align-outcome-tray-tests.mjs",
  "scripts/compact-outcome-buttons.mjs",
  "scripts/prepare-private-chat-after-outcome-tray.mjs",
  "scripts/apply-private-chat.mjs",
  "scripts/finalize-private-chat.mjs",
  "scripts/apply-consent-before-help.mjs",
  "scripts/compact-final-system-prompt.mjs",
  "scripts/fix-rounded-conversation-test.mjs",
  "scripts/prepare-live-model-usage.mjs",
  "scripts/fix-paid-model-choice.mjs",
  "scripts/add-composer-model-picker.mjs",
  "scripts/enable-free-daily-model-choice.mjs",
  "scripts/fix-live-model-usage-and-catalog.mjs",
  "scripts/set-gpt54-default.mjs",
  "scripts/apply-model-limit-fallback-and-transparent-chat.mjs",
  "scripts/add-model-tile-and-favicon.mjs",
  "scripts/compact-header-and-menu-info.mjs",
  "scripts/align-menu-info-worker-test.mjs",
  "scripts/embed-favicon-fallback.mjs",
  "scripts/finalize-home-menu-and-model-placement.mjs",
  "scripts/add-composer-chat-sections.mjs",
  "scripts/align-composer-chat-section-tests.mjs",
  "scripts/restore-gray-reading-box.mjs",
  "scripts/unify-public-page-theme.mjs",
  "scripts/unify-impact-dashboard-theme.mjs",
  "scripts/add-admin-menu-button.mjs",
  "scripts/add-engagement-feedback.mjs",
  "scripts/add-conversation-outcomes.mjs",
  "scripts/add-daily-usage-metrics.mjs",
  "scripts/inline-followups-with-feedback.mjs",
  "scripts/enforce-model-only-followups.mjs",
  "scripts/finalize-inline-followup-tests.mjs",
  "scripts/add-shareable-next-step.mjs",
  "scripts/add-instant-thinking-menu.mjs",
];
const POLICY_TARGETS = [
  "scripts/favicon-assets/favicon.ico.b64",
  "scripts/favicon-assets/favicon-16x16.png.b64",
  "scripts/favicon-assets/favicon-32x32.png.b64",
  "scripts/favicon-assets/apple-touch-icon.png.b64",
  "src/index.js",
  "src/page.js",
  "src/copy.js",
  "src/session-memory.js",
  "src/paid-worker.js",
  "src/billing.js",
  "src/reasoning-policy.js",
  "src/impact-events.js",
  "src/impact-analytics.js",
  "src/impact-shards.js",
  "src/impact-dashboard.js",
  "public/app.js",
  "public/impact.js",
  "public/message-feedback.js",
  "public/message-feedback.css",
  "public/billing-client.js",
  "public/reasoning-choice.js",
  "public/billing.css",
  "public/styles.css",
  "public/seo.css",
  "public/product.css",
  "public/photo-tuning.css",
  "public/main-box-white.css",
  "public/guides.css",
  "public/about.html",
  "public/floor-first.html",
  "public/how-it-works.html",
  "public/privacy.html",
  "public/safety.html",
  "public/support.html",
  "public/sustainability.html",
  "test/worker.test.mjs",
  "test/paid-worker.test.mjs",
  "test/model-usage-worker.test.mjs",
  "test/paid-model-choice.test.mjs",
  "test/session-memory.test.mjs",
  "test/prompt-submit.test.mjs",
  "test/outcome-followup.test.mjs",
  "test/impact-worker.test.mjs",
  "test/streaming-response.test.mjs",
  "test/product.test.mjs",
  "test/main-box-text-color.test.mjs",
  "test/ui.test.mjs",
  "wrangler.jsonc",
];
const FIXTURES = [...POLICY_SCRIPTS, ...POLICY_TARGETS];

async function copyFixtures(destination) {
  for (const relativePath of FIXTURES) {
    const target = path.join(destination, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(ROOT, relativePath), target);
  }
}

function runPolicy(destination) {
  for (const relativePath of POLICY_SCRIPTS) {
    const result = spawnSync(process.execPath, [relativePath], {
      cwd: destination,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `${relativePath} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

async function policySnapshot(destination) {
  const snapshot = {};
  for (const relativePath of POLICY_TARGETS) {
    const hash = createHash("sha256");
    hash.update(await readFile(path.join(destination, relativePath)));
    snapshot[relativePath] = hash.digest("hex");
  }
  return snapshot;
}

test("the prompt policy pipeline is idempotent", async (context) => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "stabilize-prompt-policy-"),
  );
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  await copyFixtures(fixtureRoot);
  runPolicy(fixtureRoot);
  const firstSnapshot = await policySnapshot(fixtureRoot);

  runPolicy(fixtureRoot);
  const secondSnapshot = await policySnapshot(fixtureRoot);
  const changedPaths = POLICY_TARGETS.filter(
    (relativePath) =>
      firstSnapshot[relativePath] !== secondSnapshot[relativePath],
  );

  assert.deepEqual(
    changedPaths,
    [],
    `Prompt policy changed on its second pass: ${changedPaths.join(", ")}`,
  );
});

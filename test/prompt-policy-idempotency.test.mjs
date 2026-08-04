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
  "scripts/harden-openai-streaming.mjs",
  "scripts/restore-adaptive-stream-reasoning.mjs",
];
const POLICY_TARGETS = [
  "src/index.js",
  "src/page.js",
  "src/copy.js",
  "src/session-memory.js",
  "src/paid-worker.js",
  "src/billing.js",
  "src/reasoning-policy.js",
  "public/app.js",
  "test/worker.test.mjs",
  "test/prompt-submit.test.mjs",
  "test/outcome-followup.test.mjs",
  "test/streaming-response.test.mjs",
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

async function policyDigest(destination) {
  const hash = createHash("sha256");
  for (const relativePath of POLICY_TARGETS) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(destination, relativePath)));
  }
  return hash.digest("hex");
}

test("the prompt policy pipeline is idempotent", async (context) => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "stabilize-prompt-policy-"),
  );
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  await copyFixtures(fixtureRoot);
  runPolicy(fixtureRoot);
  const firstDigest = await policyDigest(fixtureRoot);

  runPolicy(fixtureRoot);
  assert.equal(await policyDigest(fixtureRoot), firstDigest);
});

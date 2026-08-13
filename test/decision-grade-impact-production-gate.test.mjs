import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("successful main deployments verify live decision-grade impact metadata", async () => {
  const [workflow, verifier] = await Promise.all([
    read(".github/workflows/verify-decision-grade-impact-production.yml"),
    read("scripts/verify-decision-grade-impact-production.mjs"),
  ]);

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Deploy Stabilize to Cloudflare/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /verification\/decision-grade-impact/);
  assert.match(
    workflow,
    /node scripts\/verify-decision-grade-impact-production\.mjs/,
  );

  for (const field of [
    "model",
    "requestedServiceTier",
    "actualServiceTier",
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteTokens",
    "reasoningTokens",
    "outputTokens",
  ]) {
    assert.match(verifier, new RegExp(field));
  }
  assert.match(verifier, /requestedServiceTier === "fast"/);
  assert.match(verifier, /\["priority", "fast"\]/);
  assert.match(verifier, /x-stabilize-turn-id/);
  assert.match(verifier, /x-stabilize-impact-version/);
  assert.match(verifier, /next-step-v1/);
  assert.doesNotMatch(verifier, /console\.log\(done\.reply/);
  assert.doesNotMatch(verifier, /console\.log\(streamedText/);
});

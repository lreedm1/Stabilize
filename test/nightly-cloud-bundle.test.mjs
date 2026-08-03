import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  captureCloudState,
  createCloudBundle,
  inferStateTransition,
  loadCloudBundle,
} from "../ops/nightly/cloud-bundle.mjs";
import {
  createPublishingIntent,
  validatePullRequestIdentity,
} from "../ops/nightly/pending-review.mjs";

function temporaryDirectory(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function stateDirectory(root) {
  const stateDir = path.join(root, "state");
  mkdirSync(stateDir, { mode: 0o700 });
  chmodSync(stateDir, 0o700);
  return stateDir;
}

function publishingIntent() {
  return createPublishingIntent({
    branch: "agent/nightly-20260803T021700-123",
    feedbackHead: "a".repeat(40),
    headRefOid: "b".repeat(40),
    runId: "20260803T021700-123",
    changedFile: "public/product.css",
    feedbackCount: 2,
    categoryCounts: { bug: 1, experience: 1, idea: 0, other: 0 },
    createdAt: "2026-08-03T07:17:00.000Z",
  });
}

test("state bundle contains only the bounded files", () => {
  const root = temporaryDirectory("stabilize-bundle-");
  const stateDir = stateDirectory(root);
  writeFileSync(path.join(stateDir, "feedback-checkpoint"), `${"c".repeat(40)}\n`);
  writeFileSync(path.join(stateDir, "raw-feedback.json"), "must not persist\n");
  const bundleDir = path.join(root, "bundle");
  createCloudBundle({
    bundleDir,
    stateDir,
    stateHead: "d".repeat(40),
  });
  const bundle = loadCloudBundle(bundleDir);
  assert.equal(bundle.manifest.kind, "state");
  assert.deepEqual(Object.keys(bundle.state), ["feedback-checkpoint"]);

  writeFileSync(path.join(bundleDir, "extra.log"), "forbidden\n");
  assert.throws(() => loadCloudBundle(bundleDir), /extra path/);
});

test("two simultaneous pending markers are rejected", () => {
  const root = temporaryDirectory("stabilize-bundle-pending-");
  const stateDir = stateDirectory(root);
  writeFileSync(
    path.join(stateDir, "pending-review.json"),
    JSON.stringify(publishingIntent()),
  );
  writeFileSync(
    path.join(stateDir, "pending-private-review.json"),
    JSON.stringify({
      schemaVersion: 1,
      feedbackHead: "e".repeat(40),
      source: "deterministic_filter",
      createdAt: "2026-08-03T07:17:00.000Z",
    }),
  );
  assert.throws(
    () =>
      createCloudBundle({
        bundleDir: path.join(root, "bundle"),
        stateDir,
        stateHead: "f".repeat(40),
      }),
    /two simultaneous pending markers/,
  );
});

test("proposal bundle carries only the tested patch contract", () => {
  const root = temporaryDirectory("stabilize-bundle-proposal-");
  const stateDir = stateDirectory(root);
  const planPath = path.join(root, "plan.json");
  const editResultPath = path.join(root, "edit-result.json");
  const patchPath = path.join(root, "change.patch");
  writeFileSync(
    planPath,
    JSON.stringify({
      outcome: "proposed_change",
      theme: "spacing",
      targetFile: "public/product.css",
      changeKind: "spacing",
      evidenceStrength: "single_clear",
    }),
  );
  writeFileSync(
    editResultPath,
    JSON.stringify({
      outcome: "implemented",
      targetFile: "public/product.css",
      changeKind: "spacing",
    }),
  );
  writeFileSync(patchPath, "diff --git a/public/product.css b/public/product.css\n");
  const bundleDir = path.join(root, "bundle");
  createCloudBundle({
    bundleDir,
    stateDir,
    stateHead: "1".repeat(40),
    proposal: {
      manifest: {
        mainHead: "2".repeat(40),
        feedbackHead: "3".repeat(40),
        diffSha256: "4".repeat(64),
        runId: "20260803T021700-456",
        changedFile: "public/product.css",
        feedbackCount: 1,
        categoryCounts: { bug: 0, experience: 0, idea: 1, other: 0 },
      },
      planPath,
      editResultPath,
      patchPath,
    },
  });
  const bundle = loadCloudBundle(bundleDir);
  assert.equal(bundle.manifest.kind, "proposal");
  assert.equal(bundle.manifest.proposal.changedFile, "public/product.css");
  assert.equal(bundle.state["pending-review.json"], undefined);
});

test("pull request identity requires the same repository owner", () => {
  const intent = publishingIntent();
  const pullRequest = {
    number: 99,
    url: "https://github.com/lreedm1/Stabilize/pull/99",
    state: "OPEN",
    isDraft: true,
    isCrossRepository: false,
    headRepositoryOwner: { login: "lreedm1" },
    baseRefName: "main",
    headRefName: intent.headRefName,
    headRefOid: intent.headRefOid,
  };
  assert.equal(validatePullRequestIdentity(intent, pullRequest), pullRequest);
  assert.throws(
    () =>
      validatePullRequestIdentity(intent, {
        ...pullRequest,
        isCrossRepository: true,
        headRepositoryOwner: { login: "attacker" },
      }),
    /identity does not match/,
  );
});

test("state bundles record one exact atomic transition", () => {
  const root = temporaryDirectory("stabilize-bundle-transition-");
  const stateDir = stateDirectory(root);
  writeFileSync(path.join(stateDir, "feedback-checkpoint"), `${"5".repeat(40)}\n`);
  const initialState = captureCloudState(stateDir);
  writeFileSync(path.join(stateDir, "feedback-checkpoint"), `${"6".repeat(40)}\n`);
  const bundleDir = path.join(root, "bundle");
  createCloudBundle({
    bundleDir,
    stateDir,
    stateHead: "7".repeat(40),
    initialState,
  });
  const bundle = loadCloudBundle(bundleDir);
  assert.equal(bundle.manifest.transition.kind, "advance_checkpoint");
  assert.notEqual(
    bundle.manifest.transition.fromSha256,
    bundle.manifest.transition.toSha256,
  );

  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.transition.toSha256 = "8".repeat(64);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => loadCloudBundle(bundleDir), /transition digest/);
});

test("proposal feedback totals must match their category counts", () => {
  const root = temporaryDirectory("stabilize-bundle-counts-");
  const stateDir = stateDirectory(root);
  const planPath = path.join(root, "plan.json");
  const editResultPath = path.join(root, "edit-result.json");
  const patchPath = path.join(root, "change.patch");
  writeFileSync(planPath, JSON.stringify({
    outcome: "proposed_change",
    theme: "spacing",
    targetFile: "public/product.css",
    changeKind: "spacing",
    evidenceStrength: "repeated",
  }));
  writeFileSync(editResultPath, JSON.stringify({
    outcome: "implemented",
    targetFile: "public/product.css",
    changeKind: "spacing",
  }));
  writeFileSync(patchPath, "diff --git a/public/product.css b/public/product.css\n");
  assert.throws(
    () => createCloudBundle({
      bundleDir: path.join(root, "bundle"),
      stateDir,
      stateHead: "9".repeat(40),
      proposal: {
        manifest: {
          mainHead: "a".repeat(40),
          feedbackHead: "b".repeat(40),
          diffSha256: "c".repeat(64),
          runId: "20260803T021700-789",
          changedFile: "public/product.css",
          feedbackCount: 2,
          categoryCounts: { bug: 0, experience: 0, idea: 1, other: 0 },
        },
        planPath,
        editResultPath,
        patchPath,
      },
    }),
    /proposal manifest is invalid/,
  );
});

test("publication recovery transitions cannot be combined with another state action", () => {
  const intent = publishingIntent();
  const review = {
    ...intent,
    phase: "review",
    pullRequest: 91,
    url: "https://github.com/lreedm1/Stabilize/pull/91",
  };
  const publishingState = {
    "feedback-checkpoint": `${"1".repeat(40)}\n`,
    "pending-review.json": `${JSON.stringify(intent, null, 2)}\n`,
  };
  const reviewState = {
    "feedback-checkpoint": `${"1".repeat(40)}\n`,
    "pending-review.json": `${JSON.stringify(review, null, 2)}\n`,
  };
  assert.equal(
    inferStateTransition({ initialState: publishingState, finalState: reviewState }).kind,
    "complete_publication",
  );
  assert.equal(
    inferStateTransition({
      initialState: reviewState,
      finalState: { "feedback-checkpoint": `${intent.feedbackHead}\n` },
    }).kind,
    "complete_review",
  );
  assert.equal(
    inferStateTransition({
      initialState: publishingState,
      finalState: { "feedback-checkpoint": `${"1".repeat(40)}\n` },
    }).kind,
    "abandon_publication",
  );
  assert.throws(
    () => inferStateTransition({
      initialState: reviewState,
      finalState: { "feedback-checkpoint": `${"f".repeat(40)}\n` },
      proposal: true,
    }),
    /cannot also change durable review state/,
  );
});

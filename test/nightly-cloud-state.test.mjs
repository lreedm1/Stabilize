import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  restoreCloudState,
  sanitizePrivateReview,
  snapshotCloudState,
  stageBoundedStateChanges,
  validateCheckpoint,
} from "../ops/nightly/cloud-state.mjs";

function temporaryDirectory(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initializeStateRepository(root) {
  const storageRepo = path.join(root, "storage");
  execFileSync("git", ["init", "-b", "automation/nightly-state", storageRepo]);
  execFileSync("git", ["-C", storageRepo, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", storageRepo, "config", "user.email", "test@example.invalid"]);
  mkdirSync(path.join(storageRepo, ".nightly-state"));
  writeFileSync(
    path.join(storageRepo, ".nightly-state", "README.md"),
    "Bounded test state.\n",
  );
  execFileSync("git", ["-C", storageRepo, "add", ".nightly-state/README.md"]);
  execFileSync("git", ["-C", storageRepo, "commit", "-m", "Initialize state"]);
  return storageRepo;
}

test("checkpoint validation accepts only a full SHA", () => {
  assert.equal(validateCheckpoint(` ${"A".repeat(40)}\n`), "a".repeat(40));
  assert.throws(() => validateCheckpoint("main"), /checkpoint is invalid/);
});

test("private cloud state drops identifiers, paths, and reasons", () => {
  const value = sanitizePrivateReview({
    schemaVersion: 1,
    feedbackHead: "b".repeat(40),
    source: "deterministic_filter",
    items: [{ id: "private-id", filePath: "feedback/private.json", reasons: ["security_report"] }],
    createdAt: "2026-08-03T12:00:00.000Z",
  });
  assert.deepEqual(value, {
    schemaVersion: 1,
    feedbackHead: "b".repeat(40),
    source: "deterministic_filter",
    createdAt: "2026-08-03T12:00:00.000Z",
  });
});

test("snapshot and restore persist only bounded state", () => {
  const root = temporaryDirectory("stabilize-cloud-state-");
  const stateDir = path.join(root, "state");
  const storageRepo = initializeStateRepository(root);
  mkdirSync(stateDir);
  writeFileSync(path.join(stateDir, "feedback-checkpoint"), `${"c".repeat(40)}\n`);
  writeFileSync(path.join(stateDir, "pending-private-review.json"), JSON.stringify({
    schemaVersion: 1,
    feedbackHead: "d".repeat(40),
    source: "read_only_classifier",
    items: [{ id: "do-not-persist", filePath: "feedback/x.json", reasons: ["security_report"] }],
    createdAt: "2026-08-03T12:00:00.000Z",
  }));
  writeFileSync(path.join(stateDir, "raw-feedback.json"), "must not persist");

  snapshotCloudState({ stateDir, storageRepo });
  const stored = readFileSync(
    path.join(storageRepo, ".nightly-state", "pending-private-review.json"),
    "utf8",
  );
  assert.doesNotMatch(stored, /do-not-persist|feedback\/x|security_report/);

  const restored = path.join(root, "restored");
  restoreCloudState({ stateDir: restored, storageRepo });
  assert.equal(
    readFileSync(path.join(restored, "feedback-checkpoint"), "utf8"),
    `${"c".repeat(40)}\n`,
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(restored, "pending-private-review.json"), "utf8")).feedbackHead,
    "d".repeat(40),
  );
});

test("tracked paths outside the exact state allowlist are rejected", () => {
  const root = temporaryDirectory("stabilize-cloud-extra-");
  const storageRepo = initializeStateRepository(root);
  const stateDir = path.join(root, "state");
  mkdirSync(stateDir);
  writeFileSync(path.join(storageRepo, ".nightly-state", "raw-feedback.json"), "{}\n");
  execFileSync("git", ["-C", storageRepo, "add", ".nightly-state/raw-feedback.json"]);
  execFileSync("git", ["-C", storageRepo, "commit", "-m", "Add forbidden state"]);
  assert.throws(
    () => snapshotCloudState({ stateDir, storageRepo }),
    /out-of-scope path or mode/,
  );
});

test("symlinked state files are rejected", () => {
  const root = temporaryDirectory("stabilize-cloud-symlink-");
  const storageRepo = initializeStateRepository(root);
  const stateDir = path.join(root, "state");
  mkdirSync(stateDir);
  symlinkSync(
    path.join(root, "outside"),
    path.join(storageRepo, ".nightly-state", "feedback-checkpoint"),
  );
  assert.throws(
    () => snapshotCloudState({ stateDir, storageRepo }),
    /not a regular file/,
  );
});

test("first state write stages only the file that exists", () => {
  const root = temporaryDirectory("stabilize-cloud-first-sync-");
  const storageRepo = initializeStateRepository(root);
  writeFileSync(
    path.join(storageRepo, ".nightly-state", "feedback-checkpoint"),
    `${"9".repeat(40)}\n`,
  );
  assert.deepEqual(stageBoundedStateChanges(storageRepo), [
    ".nightly-state/feedback-checkpoint",
  ]);
  assert.equal(
    execFileSync("git", ["-C", storageRepo, "diff", "--cached", "--name-only"], {
      encoding: "utf8",
    }).trim(),
    ".nightly-state/feedback-checkpoint",
  );
});

test("durable state rejects simultaneous public and private pending markers", () => {
  const root = temporaryDirectory("stabilize-cloud-pending-conflict-");
  const storageRepo = initializeStateRepository(root);
  const stateDir = path.join(root, "state");
  mkdirSync(stateDir);
  writeFileSync(path.join(stateDir, "pending-review.json"), "{}\n");
  writeFileSync(path.join(stateDir, "pending-private-review.json"), "{}\n");
  assert.throws(
    () => snapshotCloudState({ stateDir, storageRepo }),
    /two simultaneous pending markers/,
  );

  writeFileSync(path.join(storageRepo, ".nightly-state", "pending-review.json"), "{}\n");
  writeFileSync(
    path.join(storageRepo, ".nightly-state", "pending-private-review.json"),
    "{}\n",
  );
  execFileSync("git", ["-C", storageRepo, "add", ".nightly-state"]);
  execFileSync("git", ["-C", storageRepo, "commit", "-m", "Conflicting state"]);
  assert.throws(
    () => restoreCloudState({ stateDir: path.join(root, "restored"), storageRepo }),
    /two simultaneous pending markers/,
  );
});

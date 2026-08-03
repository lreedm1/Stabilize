import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  expectedFeedbackPath,
  feedbackPathsBetween,
  protectedReasons,
  validateFeedbackRecord,
} from "../ops/nightly/collect-feedback.mjs";
import {
  validateAnalysisPlan,
  validateCssAdditions,
  validateCssChangeShape,
  validateEditResult,
  verifyChange,
} from "../ops/nightly/verify-change.mjs";
import {
  completePublishingIntent,
  createPublishingIntent,
  validatePullRequestIdentity,
} from "../ops/nightly/pending-review.mjs";
import { resolvePrivateStateDirectory } from "../ops/nightly/state-path.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function validFeedback(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "123e4567-e89b-42d3-a456-426614174000",
    submittedAt: "2026-08-03T07:15:00.000Z",
    source: "stabilize.info",
    signedIn: true,
    category: "idea",
    categoryLabel: "Idea",
    message: "Increase the guide text spacing a little.",
    ...overrides,
  };
}

function createCssRepo() {
  const root = temporaryDirectory("stabilize-nightly-test-");
  const repo = path.join(root, "repo");
  mkdirSync(path.join(repo, "public"), { recursive: true });
  writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
  writeFileSync(path.join(repo, "public", "product.css"), ".card {\n  padding: 12px;\n}\n");
  writeFileSync(path.join(repo, "public", "guides.css"), ".guide {\n  line-height: 1.5;\n}\n");
  execFileSync("git", ["init", "-b", "main", repo]);
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "base"]);
  return { root, repo, head: git(repo, ["rev-parse", "HEAD"]) };
}

function planAndResult(root, values = {}) {
  const plan = {
    outcome: "proposed_change",
    theme: "spacing",
    targetFile: "public/product.css",
    changeKind: "spacing",
    evidenceStrength: "single_clear",
    ...values.plan,
  };
  const result = {
    outcome: "implemented",
    targetFile: "public/product.css",
    changeKind: "spacing",
    ...values.result,
  };
  const planPath = path.join(root, "plan.json");
  const resultPath = path.join(root, "result.json");
  writeFileSync(planPath, JSON.stringify(plan));
  writeFileSync(resultPath, JSON.stringify(result));
  return { plan, result, planPath, resultPath };
}

test("feedback schema and path are validated exactly", () => {
  const record = validFeedback();
  const filePath = expectedFeedbackPath(record);
  assert.equal(
    filePath,
    "feedback/2026/08/03/2026-08-03T07-15-00Z-123e4567-e89b-42d3-a456-426614174000.json",
  );
  assert.deepEqual(validateFeedbackRecord(record, filePath), {
    filePath,
    id: record.id,
    submittedAt: record.submittedAt,
    category: "idea",
    message: record.message,
    protectedReasons: [],
  });
  assert.throws(
    () => validateFeedbackRecord({ ...record, unexpected: true }, filePath),
    /unexpected schema keys/,
  );
});

test("feedback history accepts only canonical append-only JSON records", () => {
  const repo = temporaryDirectory("stabilize-feedback-history-");
  execFileSync("git", ["init", "-b", "feedback-inbox", repo]);
  writeFileSync(path.join(repo, ".gitignore"), ".DS_Store\n");
  mkdirSync(path.join(repo, "feedback"));
  writeFileSync(path.join(repo, "feedback", "README.md"), "# Feedback inbox\n");
  git(repo, ["add", ".gitignore", "feedback/README.md"]);
  git(repo, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "base",
  ]);
  const base = git(repo, ["rev-parse", "HEAD"]);
  const record = validFeedback();
  const feedbackPath = expectedFeedbackPath(record);
  mkdirSync(path.dirname(path.join(repo, feedbackPath)), { recursive: true });
  writeFileSync(path.join(repo, feedbackPath), `${JSON.stringify(record)}\n`);
  git(repo, ["add", feedbackPath]);
  git(repo, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "feedback",
  ]);
  const validHead = git(repo, ["rev-parse", "HEAD"]);
  assert.deepEqual(feedbackPathsBetween(repo, base, validHead), [feedbackPath]);
  assert.deepEqual(feedbackPathsBetween(repo, null, validHead), [feedbackPath]);

  writeFileSync(path.join(repo, "unexpected.txt"), "not feedback\n");
  git(repo, ["add", "unexpected.txt"]);
  git(repo, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "unexpected",
  ]);
  const invalidHead = git(repo, ["rev-parse", "HEAD"]);
  assert.throws(
    () => feedbackPathsBetween(repo, validHead, invalidHead),
    /not a canonical append/,
  );

  const secondRecord = validFeedback({
    id: "123e4567-e89b-42d3-a456-426614174001",
    submittedAt: "2026-08-03T07:16:00.000Z",
  });
  const secondPath = expectedFeedbackPath(secondRecord);
  mkdirSync(path.dirname(path.join(repo, secondPath)), { recursive: true });
  writeFileSync(path.join(repo, secondPath), `${JSON.stringify(secondRecord)}\n`);
  git(repo, ["add", secondPath]);
  git(repo, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "temporary feedback",
  ]);
  rmSync(path.join(repo, secondPath));
  git(repo, ["add", "-u", secondPath]);
  git(repo, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "delete feedback",
  ]);
  const deletedHead = git(repo, ["rev-parse", "HEAD"]);
  assert.throws(
    () => feedbackPathsBetween(repo, invalidHead, deletedHead),
    /not a canonical append/,
  );
});

test("protected feedback is quarantined before model analysis", () => {
  const reasons = protectedReasons(
    "My email is reed@example.com; there is an XSS vulnerability and github_pat_abcdefghijklmnopqrstuvwxyz1234.",
  );
  assert.deepEqual(reasons, [
    "contact_or_identifying_information",
    "credential_or_secret",
    "security_report",
  ]);
  assert.deepEqual(protectedReasons("I am suicidal and this contains my medication history."), [
    "individual_health_or_crisis_disclosure",
  ]);
});

test("analysis plans are enum-only and internally consistent", () => {
  assert.deepEqual(
    validateAnalysisPlan({
      outcome: "no_change",
      theme: "none",
      targetFile: "none",
      changeKind: "none",
      evidenceStrength: "weak",
    }).outcome,
    "no_change",
  );
  assert.throws(
    () =>
      validateAnalysisPlan({
        outcome: "no_change",
        theme: "spacing",
        targetFile: "public/product.css",
        changeKind: "spacing",
        evidenceStrength: "single_clear",
      }),
    /contains editing instructions/,
  );
});

test("dangerous CSS additions are rejected", () => {
  for (const addition of [
    "+@import url(https://example.invalid/a.css);",
    "+  display: none;",
    "+  opacity: 0;",
    "+  position: fixed;",
    "+  pointer-events: none !important;",
    "+  content: \"copied feedback\";",
  ]) {
    assert.throws(() => validateCssAdditions(`diff --git a/x b/x\n${addition}\n`), /Disallowed CSS/);
  }
  assert.throws(
    () =>
      validateCssChangeShape(
        "diff --git a/x b/x\n+.new-selector {\n+  padding: 12px;\n+}\n",
        "spacing",
      ),
    /escapes, braces, or comments/,
  );
  assert.throws(
    () => validateCssChangeShape("diff --git a/x b/x\n+  color: #111;\n", "spacing"),
    /outside the approved change kind/,
  );
  assert.throws(
    () => validateCssChangeShape("diff --git a/x b/x\n+  line-height: 9;\n", "line_height"),
    /bounded range/,
  );
  assert.throws(
    () =>
      validateCssChangeShape(
        "diff --git a/x b/x\n+  padding: 12px; transform: scale(0);\n",
        "spacing",
      ),
    /exactly one declaration/,
  );
  assert.throws(
    () => validateCssAdditions("diff --git a/x b/x\n+  transform: scale(1.2);\n"),
    /Disallowed CSS/,
  );
  assert.throws(
    () =>
      validateCssChangeShape(
        "diff --git a/x b/x\n+  padding: 12px; } .crisis { d\\69splay: none; } .tail { padding: 12px;\n",
        "spacing",
      ),
    /escapes, braces, or comments/,
  );
  for (const value of ["1e9px", "1e2px", "var(--space)"]) {
    assert.throws(
      () =>
        validateCssChangeShape(
          `diff --git a/x b/x\n+  padding: ${value};\n`,
          "spacing",
        ),
      /bounded length values/,
    );
  }
  for (const declaration of ["outline-style: none", "box-shadow: none"]) {
    assert.throws(
      () =>
        validateCssChangeShape(
          `diff --git a/x b/x\n+  ${declaration};\n`,
          "focus_outline",
        ),
      /visible bounded value/,
    );
  }
});

test("one small safe CSS change passes with an exact digest", () => {
  const { root, repo, head } = createCssRepo();
  const { planPath, resultPath } = planAndResult(root);
  writeFileSync(path.join(repo, "public", "product.css"), ".card {\n  padding: 14px;\n}\n");
  const verified = verifyChange({
    repo,
    planPath,
    resultPath,
    expectedHead: head,
    strictUntracked: true,
  });
  assert.deepEqual(verified.changedFiles, ["public/product.css"]);
  assert.match(verified.diffSha256, /^[0-9a-f]{64}$/);
  assert.equal(verified.result.outcome, "implemented");
});

test("ignored dependency payloads fail before any test execution", () => {
  const { root, repo, head } = createCssRepo();
  const { planPath, resultPath } = planAndResult(root);
  writeFileSync(path.join(repo, "public", "product.css"), ".card {\n  padding: 14px;\n}\n");
  mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
  writeFileSync(path.join(repo, "node_modules", ".bin", "vitest"), "poison");
  assert.throws(
    () =>
      verifyChange({
        repo,
        planPath,
        resultPath,
        expectedHead: head,
        strictUntracked: true,
      }),
    /Untracked or ignored files/,
  );
});

test("mode changes and edits outside the approved file fail", () => {
  const { root, repo, head } = createCssRepo();
  const { planPath, resultPath } = planAndResult(root);
  writeFileSync(path.join(repo, "public", "guides.css"), ".guide {\n  line-height: 1.6;\n}\n");
  assert.throws(
    () => verifyChange({ repo, planPath, resultPath, expectedHead: head }),
    /Out-of-scope change/,
  );

  git(repo, ["restore", "."]);
  chmodSync(path.join(repo, "public", "product.css"), 0o755);
  assert.throws(
    () => verifyChange({ repo, planPath, resultPath, expectedHead: head }),
    /Mode, rename, or file-type changes/,
  );
});

test("same-size edits produce different post-test hashes", () => {
  const first = createCssRepo();
  const firstFiles = planAndResult(first.root);
  writeFileSync(path.join(first.repo, "public", "product.css"), ".card {\n  padding: 14px;\n}\n");
  const firstHash = verifyChange({
    repo: first.repo,
    planPath: firstFiles.planPath,
    resultPath: firstFiles.resultPath,
    expectedHead: first.head,
  }).diffSha256;

  const second = createCssRepo();
  const secondFiles = planAndResult(second.root);
  writeFileSync(path.join(second.repo, "public", "product.css"), ".card {\n  padding: 16px;\n}\n");
  const secondHash = verifyChange({
    repo: second.repo,
    planPath: secondFiles.planPath,
    resultPath: secondFiles.resultPath,
    expectedHead: second.head,
  }).diffSha256;
  assert.notEqual(firstHash, secondHash);
});

test("unable edits must leave no diff and no target", () => {
  assert.deepEqual(
    validateEditResult(
      { outcome: "unable", targetFile: "none", changeKind: "none" },
      {
        outcome: "proposed_change",
        theme: "spacing",
        targetFile: "public/product.css",
        changeKind: "spacing",
        evidenceStrength: "single_clear",
      },
      false,
    ).outcome,
    "unable",
  );

  const { root, repo, head } = createCssRepo();
  const { planPath, resultPath } = planAndResult(root, {
    result: { outcome: "unable", targetFile: "none", changeKind: "none" },
  });
  const verified = verifyChange({
    repo,
    planPath,
    resultPath,
    expectedHead: head,
    strictUntracked: true,
  });
  assert.deepEqual(verified.changedFiles, []);
  assert.equal(verified.changedLines, 0);
  assert.equal(verified.result.outcome, "unable");
});

test("publishing intent recovers only the exact pull request identity", () => {
  const intent = createPublishingIntent({
    branch: "agent/nightly-20260803T021700-1234",
    feedbackHead: "a".repeat(40),
    headRefOid: "b".repeat(40),
    runId: "20260803T021700-1234",
    changedFile: "public/product.css",
    feedbackCount: 2,
    categoryCounts: { bug: 1, experience: 0, idea: 1, other: 0 },
    createdAt: "2026-08-03T07:17:00.000Z",
  });
  const pullRequest = {
    number: 72,
    url: "https://github.com/lreedm1/Stabilize/pull/72",
    state: "OPEN",
    isDraft: true,
    mergedAt: null,
    isCrossRepository: false,
    headRepositoryOwner: { login: "lreedm1" },
    baseRefName: "main",
    headRefName: intent.headRefName,
    headRefOid: intent.headRefOid,
  };
  const review = completePublishingIntent(intent, pullRequest);
  assert.equal(review.phase, "review");
  assert.equal(review.pullRequest, 72);
  assert.equal(validatePullRequestIdentity(review, pullRequest).number, 72);
  assert.throws(
    () => validatePullRequestIdentity(review, { ...pullRequest, headRefOid: "c".repeat(40) }),
    /does not match the persisted publishing intent/,
  );
});

test("state directory validation rejects broad, linked, and repository paths", () => {
  const root = temporaryDirectory("stabilize-state-path-");
  const home = path.join(root, "home");
  const repoRoot = path.join(root, "repo");
  const tempRoot = path.join(root, "temp");
  for (const directory of [home, repoRoot, tempRoot]) {
    mkdirSync(directory, { mode: 0o700 });
  }
  const options = { home, repoRoot, tempRoot, uid: process.getuid() };
  const safe = path.join(home, "Library", "Application Support", "Stabilize Nightly");
  assert.equal(resolvePrivateStateDirectory(safe, options), safe);
  for (const unsafe of [home, repoRoot, path.join(repoRoot, "state"), tempRoot]) {
    assert.throws(
      () => resolvePrivateStateDirectory(unsafe, options),
      /broad or repository-overlapping/,
    );
  }
  const linked = path.join(home, "linked-state");
  symlinkSync(repoRoot, linked);
  assert.throws(
    () => resolvePrivateStateDirectory(linked, options),
    /cannot be a symbolic link/,
  );
});

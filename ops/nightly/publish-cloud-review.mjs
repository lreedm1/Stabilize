import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertStateTransition,
  captureCloudState,
  loadCloudBundle,
  restoreBundledState,
} from "./cloud-bundle.mjs";
import { restoreCloudState, syncCloudState } from "./cloud-state.mjs";
import {
  completePublishingIntent,
  createPublishingIntent,
  validatePendingReview,
  validatePullRequestIdentity,
} from "./pending-review.mjs";
import { verifyChange } from "./verify-change.mjs";

const REPOSITORY = "lreedm1/Stabilize";
const REPOSITORY_URL = "https://github.com/lreedm1/Stabilize.git";
const STATE_REF = "refs/heads/automation/nightly-state";
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_BUFFER = 16 * 1024 * 1024;

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: options.cwd,
    env: process.env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: options.timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    if (options.allowFailure) return result;
    throw new Error(`${options.label || binary} failed`);
  }
  return result;
}

function git(repo, args, options = {}) {
  return command("git", ["-C", repo, ...args], {
    ...options,
    label: options.label || "git command",
  });
}

function gitOutput(repo, args) {
  return git(repo, args).stdout.trim();
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function assertStateIdentity(stateRepo, stateHead) {
  const localHead = gitOutput(stateRepo, ["rev-parse", "HEAD"]);
  const remoteLine = gitOutput(stateRepo, [
    "ls-remote",
    "--heads",
    "origin",
    STATE_REF,
  ]);
  if (
    !SHA_PATTERN.test(stateHead) ||
    localHead !== stateHead ||
    remoteLine !== `${stateHead}\t${STATE_REF}`
  ) {
    throw new Error("Cloud review state changed after the read-only preparation job");
  }
}

function pullRequestFields() {
  return "number,url,state,isDraft,mergedAt,baseRefName,headRefName,headRefOid,isCrossRepository,headRepositoryOwner";
}

function pullRequestView(reference, allowMissing = false) {
  if (allowMissing) {
    const result = command(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        REPOSITORY,
        "--state",
        "all",
        "--head",
        String(reference),
        "--limit",
        "10",
        "--json",
        pullRequestFields(),
      ],
      { label: "Pull request recovery lookup" },
    );
    const matches = JSON.parse(result.stdout).filter(
      (pullRequest) =>
        pullRequest.isCrossRepository === false &&
        pullRequest.headRepositoryOwner?.login === "lreedm1" &&
        pullRequest.headRefName === String(reference),
    );
    if (matches.length > 1) {
      throw new Error("Pull request recovery lookup returned multiple same-repository matches");
    }
    return matches[0] || null;
  }
  const result = command(
    "gh",
    [
      "pr",
      "view",
      String(reference),
      "--repo",
      REPOSITORY,
      "--json",
      pullRequestFields(),
    ],
    { label: "Pull request lookup" },
  );
  return JSON.parse(result.stdout);
}

function stateCheckpoint(state) {
  const value = state["feedback-checkpoint"];
  if (value === undefined) return null;
  const checkpoint = value.trim().toLowerCase();
  if (!SHA_PATTERN.test(checkpoint)) throw new Error("Cloud feedback checkpoint is invalid");
  return checkpoint;
}

function statePending(state) {
  const value = state["pending-review.json"];
  return value === undefined ? null : validatePendingReview(JSON.parse(value));
}

function statePrivate(state) {
  const value = state["pending-private-review.json"];
  return value === undefined ? null : JSON.parse(value);
}

function validateFeedbackAdvance({ previousHead, nextHead, workDir, requireAdvance = true }) {
  if (!SHA_PATTERN.test(nextHead || "")) {
    throw new Error("Cloud transition has an invalid feedback commit");
  }
  if (requireAdvance && previousHead === nextHead) {
    throw new Error("Cloud transition did not advance the feedback checkpoint");
  }
  const repository = path.join(workDir, `feedback-proof-${nextHead.slice(0, 12)}`);
  command("git", ["init", repository], { label: "Feedback proof repository initialization" });
  git(repository, ["remote", "add", "origin", REPOSITORY_URL]);
  git(repository, [
    "fetch",
    "--no-tags",
    "--force",
    "origin",
    "refs/heads/feedback-inbox:refs/remotes/origin/feedback-inbox",
  ]);
  const liveHead = gitOutput(repository, ["rev-parse", "refs/remotes/origin/feedback-inbox"]);
  git(repository, ["cat-file", "-e", `${nextHead}^{commit}`]);
  git(repository, ["merge-base", "--is-ancestor", nextHead, liveHead]);
  if (previousHead) {
    git(repository, ["cat-file", "-e", `${previousHead}^{commit}`]);
    git(repository, ["merge-base", "--is-ancestor", previousHead, nextHead]);
  }
}

function validateTransitionEvidence({ bundle, initialState, workDir }) {
  const finalState = bundle.state;
  const transition = bundle.manifest.transition;
  assertStateTransition({
    transition,
    initialState,
    finalState,
    proposal: bundle.manifest.kind === "proposal",
  });

  const beforePending = statePending(initialState);
  const afterPending = statePending(finalState);
  const beforeCheckpoint = stateCheckpoint(initialState);
  const afterCheckpoint = stateCheckpoint(finalState);
  switch (transition.kind) {
    case "noop":
      return;
    case "proposal":
      validateFeedbackAdvance({
        previousHead: beforeCheckpoint,
        nextHead: bundle.manifest.proposal.feedbackHead,
        workDir,
      });
      return;
    case "advance_checkpoint":
      validateFeedbackAdvance({
        previousHead: beforeCheckpoint,
        nextHead: afterCheckpoint,
        workDir,
      });
      return;
    case "open_private_review":
      validateFeedbackAdvance({
        previousHead: beforeCheckpoint,
        nextHead: statePrivate(finalState).feedbackHead,
        workDir,
      });
      return;
    case "complete_publication": {
      const pullRequest = pullRequestView(afterPending.pullRequest);
      validatePullRequestIdentity(beforePending, pullRequest);
      validatePullRequestIdentity(afterPending, pullRequest);
      return;
    }
    case "complete_review": {
      const pullRequest = pullRequestView(beforePending.pullRequest);
      validatePullRequestIdentity(beforePending, pullRequest);
      if (!pullRequest.mergedAt) {
        throw new Error("Cloud review state can advance automatically only after a verified merge");
      }
      validateFeedbackAdvance({
        previousHead: beforeCheckpoint,
        nextHead: afterCheckpoint,
        workDir,
      });
      return;
    }
    case "abandon_publication":
      if (
        remoteBranchOid(beforePending.headRefName) ||
        pullRequestView(beforePending.headRefName, true)
      ) {
        throw new Error("Cannot abandon a publication while its branch or pull request exists");
      }
      return;
    default:
      throw new Error("Unsupported cloud state transition");
  }
}

function findOpenNightlyPullRequest() {
  const result = command(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      REPOSITORY,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,url,headRefName,isCrossRepository,headRepositoryOwner",
    ],
    { label: "Open nightly pull request check" },
  );
  return JSON.parse(result.stdout).find(
    (pullRequest) =>
      pullRequest.isCrossRepository === false &&
      pullRequest.headRepositoryOwner?.login === "lreedm1" &&
      String(pullRequest.headRefName || "").startsWith("agent/nightly-"),
  );
}

function pullRequestBody(pending) {
  const categories = Object.entries(pending.categoryCounts)
    .map(([category, count]) => `${category}: ${count}`)
    .join(", ");
  return [
    "## Automated nightly proposal",
    "",
    `Reviewed ${pending.feedbackCount} validated feedback item(s) (${categories}).`,
    "Raw feedback and model prose are intentionally omitted from this public pull request.",
    "",
    "The proposal is limited to one existing presentation CSS file. It does not change prompts, safety routing, privacy, authentication, memory, billing, dependencies, tests, configuration, or deployment.",
    "",
    "### Changed file",
    "",
    `- \`${pending.changedFile}\``,
    "",
    "### Verification",
    "",
    "- isolated read-only feedback classification",
    "- raw feedback excluded from the coding workspace",
    "- pre-test CSS scope and safety gate passed",
    "- tests and Cloudflare dry run passed on a read-only-token runner",
    "- publication revalidated the exact tested patch on a fresh runner",
    "",
    "A person must inspect the visual diff and decide whether to merge it.",
    "",
    `<!-- stabilize-nightly-feedback-head: ${pending.feedbackHead} -->`,
    "",
  ].join("\n");
}

function createDraftFromIntent(intent, workDir) {
  const bodyPath = path.join(workDir, `${intent.runId}-pr-body.md`);
  writeFileSync(bodyPath, pullRequestBody(intent), { encoding: "utf8", mode: 0o600 });
  command(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      REPOSITORY,
      "--base",
      intent.baseRefName,
      "--head",
      intent.headRefName,
      "--draft",
      "--title",
      `Nightly presentation improvement ${intent.runId.slice(0, 8)}`,
      "--body-file",
      bodyPath,
    ],
    { label: "Draft pull request creation" },
  );
  rmSync(bodyPath, { force: true });
  const pullRequest = pullRequestView(intent.headRefName);
  validatePullRequestIdentity(intent, pullRequest);
  if (pullRequest.state !== "OPEN" || pullRequest.isDraft !== true) {
    throw new Error("Created pull request is not an open draft");
  }
  return pullRequest;
}

function remoteBranchOid(branch) {
  const output = command(
    "git",
    ["ls-remote", "--heads", REPOSITORY_URL, `refs/heads/${branch}`],
    { label: "Remote nightly branch lookup" },
  ).stdout.trim();
  if (!output) return null;
  const [oid, ref, ...extra] = output.split(/\s+/);
  if (extra.length || !SHA_PATTERN.test(oid) || ref !== `refs/heads/${branch}`) {
    throw new Error("Remote nightly branch lookup returned an unexpected identity");
  }
  return oid;
}

function recoverPublishingIntent(stateDir, pending, workDir) {
  validatePendingReview(pending);
  if (pending.phase !== "publishing") return pending;
  const remoteOid = remoteBranchOid(pending.headRefName);
  if (remoteOid !== pending.headRefOid) {
    throw new Error("Persisted publication intent has no matching same-repository branch");
  }
  let pullRequest = pullRequestView(pending.headRefName, true);
  if (pullRequest) {
    validatePullRequestIdentity(pending, pullRequest);
  } else {
    pullRequest = createDraftFromIntent(pending, workDir);
  }
  const completed = completePublishingIntent(pending, pullRequest);
  writeJson(path.join(stateDir, "pending-review.json"), completed);
  return completed;
}

function cloneMain(destination, expectedHead) {
  command(
    "git",
    [
      "clone",
      "--no-tags",
      "--single-branch",
      "--branch",
      "main",
      "--depth",
      "1",
      REPOSITORY_URL,
      destination,
    ],
    { label: "Fresh publication clone" },
  );
  if (gitOutput(destination, ["rev-parse", "HEAD"]) !== expectedHead) {
    throw new Error("main changed after the read-only preparation job");
  }
}

function publishProposal({ bundle, bundleDir, stateDir, stateRepo, workDir }) {
  if (existsSync(path.join(stateDir, "pending-review.json"))) {
    throw new Error("Cannot publish a new cloud proposal while another review is pending");
  }
  const blocker = findOpenNightlyPullRequest();
  if (blocker) throw new Error(`Nightly pull request #${blocker.number} is already open`);

  const proposal = bundle.manifest.proposal;
  const publicationRepo = path.join(workDir, "publication-repository");
  cloneMain(publicationRepo, proposal.mainHead);
  command(
    "git",
    [
      "-C",
      publicationRepo,
      "apply",
      "--whitespace=error-all",
      path.join(bundleDir, "change.patch"),
    ],
    { label: "Publication patch application" },
  );
  const verified = verifyChange({
    repo: publicationRepo,
    planPath: path.join(bundleDir, "plan.json"),
    resultPath: path.join(bundleDir, "edit-result.json"),
    expectedHead: proposal.mainHead,
    strictUntracked: true,
  });
  if (
    verified.diffSha256 !== proposal.diffSha256 ||
    verified.changedFiles.length !== 1 ||
    verified.changedFiles[0] !== proposal.changedFile
  ) {
    throw new Error("Publication patch does not match the exact tested proposal");
  }

  const branch = `agent/nightly-${proposal.runId}`;
  if (remoteBranchOid(branch)) {
    throw new Error("Refusing to overwrite an existing nightly branch");
  }
  git(publicationRepo, ["switch", "-c", branch]);
  git(publicationRepo, ["add", "--", proposal.changedFile]);
  git(publicationRepo, [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "user.name=Stabilize Nightly",
    "-c",
    "user.email=nightly@stabilize.invalid",
    "commit",
    "--no-verify",
    "-m",
    `Nightly presentation improvement ${proposal.runId.slice(0, 8)}`,
  ]);
  const intent = createPublishingIntent({
    branch,
    feedbackHead: proposal.feedbackHead,
    headRefOid: gitOutput(publicationRepo, ["rev-parse", "HEAD"]),
    runId: proposal.runId,
    changedFile: proposal.changedFile,
    feedbackCount: proposal.feedbackCount,
    categoryCounts: proposal.categoryCounts,
  });
  writeJson(path.join(stateDir, "pending-review.json"), intent);
  syncCloudState({ stateDir, storageRepo: stateRepo });

  git(publicationRepo, [
    "-c",
    "core.hooksPath=/dev/null",
    "push",
    "--no-verify",
    "--set-upstream",
    "origin",
    branch,
  ]);
  const pullRequest = createDraftFromIntent(intent, workDir);
  writeJson(
    path.join(stateDir, "pending-review.json"),
    completePublishingIntent(intent, pullRequest),
  );
  syncCloudState({ stateDir, storageRepo: stateRepo });
  process.stdout.write(`Created draft PR ${pullRequest.url}.\n`);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--bundle-dir", "--state-repo", "--work-dir"].includes(name) || !value) {
      throw new Error("Usage: publish-cloud-review.mjs --bundle-dir PATH --state-repo PATH --work-dir PATH");
    }
    values[name.slice(2)] = value;
  }
  for (const name of ["bundle-dir", "state-repo", "work-dir"]) {
    if (!values[name] || !path.isAbsolute(values[name])) {
      throw new Error("Cloud publication paths must be absolute");
    }
  }
  return values;
}

export function publishCloudReview({ bundleDir, stateRepo, workDir }) {
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const preview = loadCloudBundle(bundleDir);
  assertStateIdentity(stateRepo, preview.manifest.stateHead);
  const stateDir = path.join(workDir, "state");
  restoreCloudState({ stateDir, storageRepo: stateRepo });
  const initialState = captureCloudState(stateDir);
  validateTransitionEvidence({ bundle: preview, initialState, workDir });
  const bundle = restoreBundledState({ bundleDir, stateDir });

  const pendingPath = path.join(stateDir, "pending-review.json");
  if (bundle.manifest.kind === "state") {
    if (existsSync(pendingPath)) {
      const pending = validatePendingReview(JSON.parse(readFileSync(pendingPath, "utf8")));
      recoverPublishingIntent(stateDir, pending, workDir);
    }
    syncCloudState({ stateDir, storageRepo: stateRepo });
    process.stdout.write("Published bounded nightly state; no new code proposal was created.\n");
    return;
  }
  publishProposal({ bundle, bundleDir, stateDir, stateRepo, workDir });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  publishCloudReview({
    bundleDir: args["bundle-dir"],
    stateRepo: args["state-repo"],
    workDir: args["work-dir"],
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

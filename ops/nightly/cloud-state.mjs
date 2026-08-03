import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validatePendingReview } from "./pending-review.mjs";

const REPOSITORY_URL = "https://github.com/lreedm1/Stabilize.git";
const STATE_REF = "refs/heads/automation/nightly-state";
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const STATE_FILES = [
  "feedback-checkpoint",
  "pending-review.json",
  "pending-private-review.json",
];
const STATE_PATHS = STATE_FILES.map((filename) => `.nightly-state/${filename}`);
const README_PATH = ".nightly-state/README.md";
export const CLOUD_STATE_README = "# Stabilize nightly state\n\nThis branch is machine-managed. Its HEAD tree is intentionally limited to this README and the three validated state files documented in `ops/nightly/CLOUD.md` on `main`.\n";
const STORED_PATH_LIMITS = new Map([
  [README_PATH, Buffer.byteLength(CLOUD_STATE_README)],
  [".nightly-state/feedback-checkpoint", 128],
  [".nightly-state/pending-review.json", 8192],
  [".nightly-state/pending-private-review.json", 1024],
]);
const LOCAL_PRIVATE_REVIEW_LIMIT = 64 * 1024;
const ALLOWED_TREE_PATHS = new Set([README_PATH, ...STATE_PATHS]);
const ALLOWED_STATE_PATHS = new Set(STATE_PATHS);

function git(repo, args, options = {}) {
  const output = execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
  });
  return options.raw ? output : output.trim();
}

function statOrNull(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertDirectory(directory, label, { create = false } = {}) {
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = statOrNull(directory);
  if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular directory`);
  }
  chmodSync(directory, 0o700);
}

function regularFileExists(filePath, label) {
  const stats = statOrNull(filePath);
  if (!stats) return false;
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file`);
  }
  return true;
}

function readText(filePath, label, maximumBytes) {
  if (!regularFileExists(filePath, label)) throw new Error(`${label} is missing`);
  const size = lstatSync(filePath).size;
  if (!Number.isSafeInteger(maximumBytes) || size > maximumBytes) {
    throw new Error(`${label} exceeds its bounded size`);
  }
  return readFileSync(filePath, "utf8");
}

function readJson(filePath, label, maximumBytes) {
  return JSON.parse(readText(filePath, label, maximumBytes));
}

function writeSecure(filePath, value) {
  const existing = statOrNull(filePath);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error(`Refusing to replace a non-regular state file: ${filePath}`);
  }
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  const noFollow = constants.O_NOFOLLOW || 0;
  let descriptor = null;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
    writeFileSync(descriptor, value, { encoding: "utf8" });
    closeSync(descriptor);
    descriptor = null;
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, filePath);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function writeJson(filePath, value) {
  writeSecure(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function removeIfPresent(filePath, label) {
  if (!regularFileExists(filePath, label)) return;
  rmSync(filePath);
}

function assertOnePendingMarker(directory, label) {
  const pending = regularFileExists(
    path.join(directory, "pending-review.json"),
    `${label} pending review`,
  );
  const privatePending = regularFileExists(
    path.join(directory, "pending-private-review.json"),
    `${label} private-review marker`,
  );
  if (pending && privatePending) {
    throw new Error(`${label} cannot contain two simultaneous pending markers`);
  }
}

export function validateCheckpoint(value) {
  const checkpoint = String(value).trim();
  if (!SHA_PATTERN.test(checkpoint)) {
    throw new Error("Cloud feedback checkpoint is invalid");
  }
  return checkpoint.toLowerCase();
}

export function sanitizePrivateReview(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    !SHA_PATTERN.test(value.feedbackHead) ||
    !["deterministic_filter", "read_only_classifier"].includes(value.source) ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new Error("Protected-review state is invalid");
  }
  return {
    schemaVersion: 1,
    feedbackHead: value.feedbackHead.toLowerCase(),
    source: value.source,
    createdAt: value.createdAt,
  };
}

export function validateStoredPrivateReview(value) {
  const expectedKeys = ["createdAt", "feedbackHead", "schemaVersion", "source"].sort();
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)
  ) {
    throw new Error("Stored protected-review state does not match the exact durable shape");
  }
  return sanitizePrivateReview(value);
}

function assertStateTree(storageRepo) {
  assertDirectory(storageRepo, "Cloud-state checkout");
  if (git(storageRepo, ["rev-parse", "--is-inside-work-tree"], { quiet: true }) !== "true") {
    throw new Error("Cloud-state checkout is not a Git worktree");
  }
  const entries = git(storageRepo, ["ls-tree", "-r", "-l", "-z", "HEAD"], {
    quiet: true,
    raw: true,
  })
    .split("\0")
    .filter(Boolean);
  const seen = new Set();
  for (const entry of entries) {
    const match = entry.match(
      /^([0-9]{6}) ([a-z]+) ([0-9a-f]{40,64})\s+([0-9]+)\t([\s\S]+)$/,
    );
    if (!match) throw new Error("Cloud-state branch contains an invalid tree entry");
    const [, mode, type, , sizeText, filePath] = match;
    if (mode !== "100644" || type !== "blob" || !ALLOWED_TREE_PATHS.has(filePath)) {
      throw new Error(`Cloud-state branch contains an out-of-scope path or mode: ${filePath}`);
    }
    const size = Number(sizeText);
    const maximumSize = STORED_PATH_LIMITS.get(filePath);
    if (
      !Number.isSafeInteger(size) ||
      size > maximumSize ||
      (filePath === README_PATH && size !== maximumSize)
    ) {
      throw new Error(`Cloud-state branch contains an out-of-bounds blob: ${filePath}`);
    }
    seen.add(filePath);
  }
  if (!seen.has(README_PATH)) {
    throw new Error("Cloud-state branch is missing its fixed README placeholder");
  }
}

function validateStorageDirectory(storageRepo) {
  assertStateTree(storageRepo);
  const storageDirectory = path.join(storageRepo, ".nightly-state");
  assertDirectory(storageDirectory, "Cloud-state storage directory");
  for (const filePath of [README_PATH, ...STATE_PATHS]) {
    const absolutePath = path.join(storageRepo, filePath);
    if (statOrNull(absolutePath)) {
      regularFileExists(absolutePath, `Cloud-state path ${filePath}`);
      if (lstatSync(absolutePath).size > STORED_PATH_LIMITS.get(filePath)) {
        throw new Error(`Cloud-state path exceeds its bounded size: ${filePath}`);
      }
    }
  }
  const readme = readText(
    path.join(storageRepo, README_PATH),
    "Cloud-state README",
    STORED_PATH_LIMITS.get(README_PATH),
  );
  if (readme !== CLOUD_STATE_README) {
    throw new Error("Cloud-state branch has an unexpected fixed README placeholder");
  }
  assertOnePendingMarker(storageDirectory, "Cloud-state storage");
  return storageDirectory;
}

export function restoreCloudState({ stateDir, storageRepo }) {
  assertDirectory(stateDir, "Private state directory", { create: true });
  const storageDirectory = validateStorageDirectory(storageRepo);

  for (const filename of STATE_FILES) {
    removeIfPresent(path.join(stateDir, filename), `Private state file ${filename}`);
  }

  const checkpointPath = path.join(storageDirectory, "feedback-checkpoint");
  if (regularFileExists(checkpointPath, "Stored feedback checkpoint")) {
    writeSecure(
      path.join(stateDir, "feedback-checkpoint"),
      `${validateCheckpoint(readText(checkpointPath, "Stored feedback checkpoint", 128))}\n`,
    );
  }

  const pendingPath = path.join(storageDirectory, "pending-review.json");
  if (regularFileExists(pendingPath, "Stored pending review")) {
    writeJson(
      path.join(stateDir, "pending-review.json"),
      validatePendingReview(readJson(pendingPath, "Stored pending review", 8192)),
    );
  }

  const privatePath = path.join(storageDirectory, "pending-private-review.json");
  if (regularFileExists(privatePath, "Stored private-review marker")) {
    writeJson(
      path.join(stateDir, "pending-private-review.json"),
      validateStoredPrivateReview(
        readJson(privatePath, "Stored private-review marker", 1024),
      ),
    );
  }
}

export function snapshotCloudState({ stateDir, storageRepo }) {
  assertDirectory(stateDir, "Private state directory");
  assertOnePendingMarker(stateDir, "Private state");
  const storageDirectory = validateStorageDirectory(storageRepo);
  const checkpointPath = path.join(stateDir, "feedback-checkpoint");
  if (regularFileExists(checkpointPath, "Private feedback checkpoint")) {
    writeSecure(
      path.join(storageDirectory, "feedback-checkpoint"),
      `${validateCheckpoint(readText(checkpointPath, "Private feedback checkpoint", 128))}\n`,
    );
  } else {
    removeIfPresent(
      path.join(storageDirectory, "feedback-checkpoint"),
      "Stored feedback checkpoint",
    );
  }

  const pendingPath = path.join(stateDir, "pending-review.json");
  if (regularFileExists(pendingPath, "Private pending review")) {
    writeJson(
      path.join(storageDirectory, "pending-review.json"),
      validatePendingReview(readJson(pendingPath, "Private pending review", 8192)),
    );
  } else {
    removeIfPresent(path.join(storageDirectory, "pending-review.json"), "Stored pending review");
  }

  const privatePath = path.join(stateDir, "pending-private-review.json");
  if (regularFileExists(privatePath, "Private protected-review marker")) {
    writeJson(
      path.join(storageDirectory, "pending-private-review.json"),
      sanitizePrivateReview(
        readJson(privatePath, "Private protected-review marker", LOCAL_PRIVATE_REVIEW_LIMIT),
      ),
    );
  } else {
    removeIfPresent(
      path.join(storageDirectory, "pending-private-review.json"),
      "Stored private-review marker",
    );
  }
}

function assertExpectedRepository(storageRepo) {
  const origin = git(storageRepo, ["remote", "get-url", "origin"], { quiet: true });
  if (!/^https:\/\/github\.com\/lreedm1\/Stabilize(?:\.git)?\/?$/i.test(origin)) {
    throw new Error(`Refusing unexpected cloud-state origin: ${origin}`);
  }

  const localHead = git(storageRepo, ["rev-parse", "HEAD"], { quiet: true });
  const remoteLine = git(storageRepo, ["ls-remote", "--heads", "origin", STATE_REF], {
    quiet: true,
  });
  const expectedRemoteLine = `${localHead}\t${STATE_REF}`;
  if (!SHA_PATTERN.test(localHead) || remoteLine !== expectedRemoteLine) {
    throw new Error("Cloud-state checkout is stale or points at an unexpected commit");
  }
  assertStateTree(storageRepo);
}

function assertOnlyStateChanges(storageRepo) {
  const status = git(
    storageRepo,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { quiet: true, raw: true },
  );
  const records = status.split("\0").filter(Boolean);
  for (const record of records) {
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Cloud-state sync found an invalid Git status record");
    }
    const statusCode = record.slice(0, 2);
    const filePath = record.slice(3);
    if (/[RC]/.test(statusCode) || !ALLOWED_STATE_PATHS.has(filePath)) {
      throw new Error(`Cloud-state sync found an out-of-scope change: ${filePath}`);
    }
    const absolutePath = path.join(storageRepo, filePath);
    if (statOrNull(absolutePath)) regularFileExists(absolutePath, `Changed state path ${filePath}`);
  }
  return records.map((record) => record.slice(3));
}

export function stageBoundedStateChanges(storageRepo) {
  const changedPaths = assertOnlyStateChanges(storageRepo);
  if (!changedPaths.length) return [];
  git(storageRepo, ["add", "-A", "--", ...changedPaths]);
  const stagedPaths = git(
    storageRepo,
    ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACDMRTUXB"],
    { quiet: true, raw: true },
  )
    .split("\0")
    .filter(Boolean);
  const expected = [...new Set(changedPaths)].sort();
  if (JSON.stringify(stagedPaths.sort()) !== JSON.stringify(expected)) {
    throw new Error("Cloud-state staged paths do not match the exact bounded change set");
  }
  return expected;
}

export function syncCloudState({ stateDir, storageRepo }) {
  assertExpectedRepository(storageRepo);
  if (git(storageRepo, ["status", "--porcelain=v1"], { quiet: true })) {
    throw new Error("Cloud-state checkout was not clean before synchronization");
  }
  snapshotCloudState({ stateDir, storageRepo });
  if (!stageBoundedStateChanges(storageRepo).length) return false;
  git(storageRepo, [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "user.name=Stabilize Nightly",
    "-c",
    "user.email=nightly@stabilize.invalid",
    "commit",
    "--no-verify",
    "-m",
    "[skip ci] Update nightly review state",
  ]);
  assertStateTree(storageRepo);
  git(storageRepo, [
    "-c",
    "core.hooksPath=/dev/null",
    "push",
    "--no-verify",
    "origin",
    `HEAD:${STATE_REF}`,
  ]);
  if (git(storageRepo, ["status", "--porcelain=v1"], { quiet: true })) {
    throw new Error("Cloud-state checkout was not clean after synchronization");
  }
  return true;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["restore", "snapshot", "sync"].includes(command)) {
    throw new Error(
      "Usage: cloud-state.mjs <restore|snapshot|sync> --state-dir PATH --storage-repo PATH",
    );
  }
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index];
    if (!["--state-dir", "--storage-repo"].includes(name) || !rest[index + 1]) {
      throw new Error(`Invalid cloud-state argument: ${name}`);
    }
    args[name.slice(2)] = rest[index + 1];
    index += 1;
  }
  if (!args["state-dir"] || !args["storage-repo"]) {
    throw new Error("Both --state-dir and --storage-repo are required");
  }
  for (const value of [args["state-dir"], args["storage-repo"]]) {
    if (!path.isAbsolute(value)) throw new Error("Cloud-state paths must be absolute");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    stateDir: args["state-dir"],
    storageRepo: args["storage-repo"],
  };
  if (args.command === "restore") restoreCloudState(options);
  if (args.command === "snapshot") snapshotCloudState(options);
  if (args.command === "sync") syncCloudState(options);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

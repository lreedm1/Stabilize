import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createCloudBundle,
  loadCloudBundle,
  restoreBundledState,
} from "./cloud-bundle.mjs";
import { verifyChange } from "./verify-change.mjs";

const REPOSITORY_URL = "https://github.com/lreedm1/Stabilize.git";
const OPS_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: options.timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${options.label || binary} failed`);
  }
  return result;
}

function git(repo, args) {
  return command("git", ["-C", repo, ...args], { label: "git command" });
}

function gitOutput(repo, args) {
  return git(repo, args).stdout.trim();
}

function privateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function safeEnvironment(verificationRoot) {
  const home = path.join(verificationRoot, "home");
  const cache = path.join(verificationRoot, "npm-cache");
  const temporaryDirectory = path.join(verificationRoot, "tmp");
  for (const directory of [home, cache, temporaryDirectory]) privateDirectory(directory);
  const username = os.userInfo().username;
  return {
    HOME: home,
    USER: username,
    LOGNAME: username,
    PATH: process.env.PATH || DEFAULT_PATH,
    SHELL: "/bin/zsh",
    TMPDIR: temporaryDirectory,
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    CI: "1",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
    NPM_CONFIG_CACHE: cache,
    npm_config_cache: cache,
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
  };
}

function runSandboxed(binary, args, verificationRoot, options = {}) {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) {
    throw new Error("Cloud verification requires macOS sandbox-exec");
  }
  const profilePath = path.join(OPS_DIR, "verification.sb");
  const canonicalVerificationRoot = realpathSync(verificationRoot);
  return command(
    "/usr/bin/sandbox-exec",
    ["-D", `WRITABLE_ROOT=${canonicalVerificationRoot}`, "-f", profilePath, binary, ...args],
    options,
  );
}

function nulList(value) {
  return value
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function diffDigest(repo) {
  const diffText = git(repo, ["diff", "--no-ext-diff", "--binary", "HEAD", "--"]).stdout;
  return {
    diffText,
    sha256: createHash("sha256").update(diffText).digest("hex"),
  };
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
    { label: "Fresh cloud verification clone" },
  );
  if (gitOutput(destination, ["rev-parse", "HEAD"]) !== expectedHead) {
    throw new Error("main changed before isolated verification");
  }
}

function verifyProposal({ candidateDir, bundle, verificationRoot }) {
  const proposal = bundle.manifest.proposal;
  const verificationRepo = path.join(verificationRoot, "repository");
  cloneMain(verificationRepo, proposal.mainHead);
  const environment = safeEnvironment(verificationRoot);

  command("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: verificationRepo,
    env: environment,
    timeout: 15 * 60 * 1000,
    label: "Trusted dependency installation",
  });
  for (const [label, args] of [
    ["Trusted policy normalization", ["run", "apply:prompt-policy"]],
    ["Trusted type normalization", ["run", "types"]],
  ]) {
    runSandboxed("npm", args, verificationRoot, {
      cwd: verificationRepo,
      env: environment,
      timeout: 10 * 60 * 1000,
      label,
    });
  }
  const baselineFiles = nulList(
    git(verificationRepo, ["diff", "HEAD", "--name-only", "-z", "--"]).stdout,
  );
  if (baselineFiles.some((filePath) => ["public/product.css", "public/guides.css"].includes(filePath))) {
    throw new Error("Trusted normalization touched a nightly-editable CSS file");
  }
  const firstBaseline = diffDigest(verificationRepo);
  for (const [label, args] of [
    ["Trusted policy idempotence check", ["run", "apply:prompt-policy"]],
    ["Trusted type idempotence check", ["run", "types"]],
  ]) {
    runSandboxed("npm", args, verificationRoot, {
      cwd: verificationRepo,
      env: environment,
      timeout: 10 * 60 * 1000,
      label,
    });
  }
  if (diffDigest(verificationRepo).sha256 !== firstBaseline.sha256) {
    throw new Error("Trusted normalization is not idempotent");
  }
  if (gitOutput(verificationRepo, ["ls-files", "--others", "--exclude-standard"])) {
    throw new Error("Trusted normalization created an unexpected file");
  }

  command(
    "git",
    [
      "-C",
      verificationRepo,
      "apply",
      "--whitespace=error-all",
      path.join(candidateDir, "change.patch"),
    ],
    { label: "Verified patch application" },
  );
  const beforeTests = diffDigest(verificationRepo);
  const gated = verifyChange({
    repo: verificationRepo,
    planPath: path.join(candidateDir, "plan.json"),
    resultPath: path.join(candidateDir, "edit-result.json"),
    expectedHead: proposal.mainHead,
    strictUntracked: false,
  });
  if (
    gated.diffSha256 !== proposal.diffSha256 ||
    gated.changedFiles.length !== 1 ||
    gated.changedFiles[0] !== proposal.changedFile
  ) {
    throw new Error("Candidate patch does not match its bounded manifest");
  }

  for (const [label, args, timeout] of [
    ["Tests", ["test"], 25 * 60 * 1000],
    ["Cloudflare dry run", ["run", "check"], 20 * 60 * 1000],
  ]) {
    runSandboxed("npm", args, verificationRoot, {
      cwd: verificationRepo,
      env: environment,
      timeout,
      label,
    });
  }
  if (diffDigest(verificationRepo).sha256 !== beforeTests.sha256) {
    throw new Error("Validation changed the exact generated baseline or proposed diff");
  }
  if (baselineFiles.length) {
    git(verificationRepo, ["restore", "--source=HEAD", "--", ...baselineFiles]);
  }
  const final = verifyChange({
    repo: verificationRepo,
    planPath: path.join(candidateDir, "plan.json"),
    resultPath: path.join(candidateDir, "edit-result.json"),
    expectedHead: proposal.mainHead,
    strictUntracked: false,
  });
  if (final.diffSha256 !== proposal.diffSha256) {
    throw new Error("Final clean proposal differs from the exact candidate patch");
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--candidate-dir", "--verified-dir", "--work-dir"].includes(name) || !value) {
      throw new Error(
        "Usage: verify-cloud-review.mjs --candidate-dir PATH --verified-dir PATH --work-dir PATH",
      );
    }
    values[name.slice(2)] = value;
  }
  for (const name of ["candidate-dir", "verified-dir", "work-dir"]) {
    if (!values[name] || !path.isAbsolute(values[name])) {
      throw new Error("Cloud verification paths must be absolute");
    }
  }
  return values;
}

export function verifyCloudReview({ candidateDir, verifiedDir, workDir }) {
  privateDirectory(workDir);
  const stateDir = path.join(workDir, "state");
  const bundle = restoreBundledState({ bundleDir: candidateDir, stateDir });
  if (bundle.manifest.kind === "proposal") {
    const verificationRoot = path.join(workDir, "verification-sandbox");
    privateDirectory(verificationRoot);
    verifyProposal({ candidateDir, bundle, verificationRoot });
  }
  createCloudBundle({
    bundleDir: verifiedDir,
    stateDir,
    stateHead: bundle.manifest.stateHead,
    transition: bundle.manifest.transition,
    proposal:
      bundle.manifest.kind === "proposal"
        ? {
            manifest: bundle.manifest.proposal,
            patchPath: path.join(candidateDir, "change.patch"),
            planPath: path.join(candidateDir, "plan.json"),
            editResultPath: path.join(candidateDir, "edit-result.json"),
          }
        : null,
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  verifyCloudReview({
    candidateDir: args["candidate-dir"],
    verifiedDir: args["verified-dir"],
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

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateAnalysisPlan,
  verifyChange,
} from "./verify-change.mjs";
import {
  completePublishingIntent,
  createPublishingIntent,
  validatePendingReview,
  validatePullRequestIdentity,
} from "./pending-review.mjs";
import { resolvePrivateStateDirectory } from "./state-path.mjs";
import { captureCloudState, createCloudBundle } from "./cloud-bundle.mjs";

const REPOSITORY = "lreedm1/Stabilize";
const REPOSITORY_URL = "https://github.com/lreedm1/Stabilize.git";
const OPS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(OPS_DIR, "../..");
const DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const MAX_COMMAND_BUFFER = 16 * 1024 * 1024;
const MINIMUM_CODEX_VERSION = [0, 138, 0];

let activeRunDirectory = null;
let preserveRunDirectory = false;
let codexProxyStopped = false;
let cloudProposal = null;

function cloudPrepareMode() {
  return Boolean(process.env.STABILIZE_NIGHTLY_BUNDLE_DIR);
}

function usage() {
  process.stdout.write("Usage: ops/nightly/run.zsh [--dry-run] [--acknowledge-pending] [--state-dir PATH]\n\n");
  process.stdout.write("  --dry-run              Validate access and feedback without calling Codex or changing state.\n");
  process.stdout.write("  --acknowledge-pending   After human review, acknowledge a protected item or closed PR.\n");
  process.stdout.write("  --state-dir             Override the private local state directory.\n");
}

function parseArgs(argv) {
  const args = { dryRun: false, acknowledgePending: false, stateDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--dry-run") {
      args.dryRun = true;
    } else if (argv[index] === "--acknowledge-pending") {
      args.acknowledgePending = true;
    } else if (argv[index] === "--state-dir") {
      if (!argv[index + 1]) throw new Error("--state-dir requires an absolute path");
      args.stateDir = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--scheduled") {
      // Marker used by launchd; behavior remains identical.
    } else if (argv[index] === "--help" || argv[index] === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  if (args.dryRun && args.acknowledgePending) {
    throw new Error("Choose either --dry-run or --acknowledge-pending");
  }
  return args;
}

function privateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function atomicWrite(filePath, value, mode = 0o600) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, value, { encoding: "utf8", mode });
  chmodSync(temporaryPath, mode);
  renameSync(temporaryPath, filePath);
}

function writeJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function safeEnvironment(home = os.homedir(), { includeCodexProxy = false } = {}) {
  const username = os.userInfo().username;
  const environment = {
    HOME: home,
    USER: username,
    LOGNAME: username,
    PATH: process.env.PATH || DEFAULT_PATH,
    SHELL: "/bin/zsh",
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    CI: "1",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
  };
  if (includeCodexProxy && process.env.STABILIZE_NIGHTLY_CODEX_PROXY === "1") {
    if (codexProxyStopped) {
      throw new Error("The cloud Codex proxy has already been stopped");
    }
    if (!process.env.CODEX_HOME || !path.isAbsolute(process.env.CODEX_HOME)) {
      throw new Error("Cloud Codex runs require an absolute CODEX_HOME");
    }
    environment.CODEX_HOME = process.env.CODEX_HOME;
  }
  return environment;
}

function saveCommandLogs(basePath, result) {
  if (!basePath) return;
  if (result.stdout) atomicWrite(`${basePath}.stdout.log`, result.stdout);
  if (result.stderr) atomicWrite(`${basePath}.stderr.log`, result.stderr);
}

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: options.cwd || REPO_ROOT,
    env: options.env || process.env,
    encoding: "utf8",
    maxBuffer: options.maxBuffer || MAX_COMMAND_BUFFER,
    timeout: options.timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  saveCommandLogs(options.privateLogBase, result);
  if (result.error || result.status !== 0) {
    if (options.allowFailure) return result;
    const label = options.label || `${binary} ${args[0] || ""}`.trim();
    const logHint = options.privateLogBase
      ? ` Private logs: ${options.privateLogBase}.*.log`
      : "";
    throw new Error(`${label} failed.${logHint}`);
  }
  return result;
}

function git(repo, args, options = {}) {
  return command("git", ["-C", repo, ...args], {
    ...options,
    label: options.label || "git command",
  });
}

function gitOutput(repo, args, options = {}) {
  return git(repo, args, options).stdout.trim();
}

function nulList(value) {
  return value
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function diffDigest(repo, filePaths = []) {
  const args = ["diff", "--no-ext-diff", "--binary", "HEAD", "--"];
  if (filePaths.length) args.push(...filePaths);
  const diffText = git(repo, args).stdout;
  return {
    diffText,
    sha256: createHash("sha256").update(diffText).digest("hex"),
  };
}

function writeReport(reportsDir, runId, outcome, values = {}) {
  const output = path.join(reportsDir, `${runId}-${outcome}.json`);
  writeJson(output, {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    outcome,
    ...values,
  });
  return output;
}

function appleScriptString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function notify(title, body) {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/osascript")) return;
  spawnSync(
    "/usr/bin/osascript",
    [
      "-e",
      `display notification "${appleScriptString(body)}" with title "${appleScriptString(title)}"`,
    ],
    { stdio: "ignore" },
  );
}

function originIsExpected(origin) {
  return /^https:\/\/github\.com\/lreedm1\/Stabilize(?:\.git)?\/?$/i.test(origin);
}

function versionAtLeast(actual, required) {
  for (let index = 0; index < required.length; index += 1) {
    if (actual[index] > required[index]) return true;
    if (actual[index] < required[index]) return false;
  }
  return true;
}

function preflight(runLogsDir) {
  for (const [binary, commandArgs] of [
    ["git", ["--version"]],
    ["node", ["--version"]],
    ["npm", ["--version"]],
    ["gh", ["--version"]],
  ]) {
    command(binary, commandArgs, { label: `${binary} availability check` });
  }
  if (Number(process.versions.node.split(".")[0]) < 22) {
    throw new Error("Node.js 22 or newer is required");
  }

  const skipCodex = process.env.STABILIZE_NIGHTLY_SKIP_CODEX === "1";
  if (!skipCodex) {
    const codexVersionResult = command("codex", ["--version"], {
      label: "Codex availability check",
    });
    const versionMatch = codexVersionResult.stdout.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!versionMatch) throw new Error("Could not determine the Codex CLI version");
    const codexVersion = versionMatch.slice(1).map(Number);
    if (!versionAtLeast(codexVersion, MINIMUM_CODEX_VERSION)) {
      throw new Error("Codex CLI 0.138.0 or newer is required for scoped permission profiles");
    }
  }

  const origin = gitOutput(REPO_ROOT, ["remote", "get-url", "origin"]);
  if (!originIsExpected(origin)) {
    throw new Error(`Refusing to run against unexpected origin: ${origin}`);
  }
  if (skipCodex) {
    // Acknowledgement never calls a model and does not require Codex authentication.
  } else if (process.env.STABILIZE_NIGHTLY_CODEX_PROXY !== "1") {
    command("codex", ["login", "status"], {
      env: safeEnvironment(),
      label: "Codex authentication check",
      privateLogBase: path.join(runLogsDir, "codex-auth"),
    });
  } else {
    safeEnvironment(os.homedir(), { includeCodexProxy: true });
  }
  command("gh", ["auth", "status"], {
    label: "GitHub authentication check",
    privateLogBase: path.join(runLogsDir, "github-auth"),
  });
  const repoCheck = command(
    "gh",
    ["repo", "view", REPOSITORY, "--json", "nameWithOwner"],
    {
      label: "GitHub repository access check",
      privateLogBase: path.join(runLogsDir, "github-repo"),
    },
  );
  if (JSON.parse(repoCheck.stdout).nameWithOwner !== REPOSITORY) {
    throw new Error("GitHub returned an unexpected repository");
  }
}

function acquireLock(lockDir) {
  try {
    mkdirSync(lockDir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let stale = true;
    try {
      const pid = Number(readFileSync(path.join(lockDir, "pid"), "utf8"));
      if (Number.isInteger(pid) && pid > 1) {
        process.kill(pid, 0);
        stale = false;
      }
    } catch (lockError) {
      if (lockError.code === "EPERM") stale = false;
    }
    if (!stale) return false;
    rmSync(lockDir, { recursive: true, force: true });
    mkdirSync(lockDir, { mode: 0o700 });
  }
  atomicWrite(path.join(lockDir, "pid"), `${process.pid}\n`);
  return true;
}

function releaseLock(lockDir) {
  rmSync(lockDir, { recursive: true, force: true });
}

function cleanupRunDirectory() {
  if (!activeRunDirectory || preserveRunDirectory) return;
  rmSync(activeRunDirectory, { recursive: true, force: true });
  activeRunDirectory = null;
}

function currentCheckpoint(checkpointPath) {
  if (!existsSync(checkpointPath)) return null;
  const checkpoint = readFileSync(checkpointPath, "utf8").trim();
  if (!/^[0-9a-f]{40}$/i.test(checkpoint)) {
    throw new Error("Stored feedback checkpoint is invalid");
  }
  return checkpoint;
}

function writeCheckpoint(checkpointPath, sha) {
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("Refusing invalid checkpoint");
  atomicWrite(checkpointPath, `${sha}\n`);
  syncCloudState(path.dirname(checkpointPath));
}

function syncCloudState(stateDir) {
  const storageRepo = process.env.STABILIZE_NIGHTLY_STATE_REPO;
  if (!storageRepo) return;
  if (!path.isAbsolute(storageRepo)) {
    throw new Error("Cloud state repository path must be absolute");
  }
  command(
    "node",
    [
      path.join(OPS_DIR, "cloud-state.mjs"),
      "sync",
      "--state-dir",
      stateDir,
      "--storage-repo",
      storageRepo,
    ],
    {
      label: "Durable cloud-state synchronization",
      privateLogBase: activeRunDirectory
        ? path.join(activeRunDirectory, "logs", "cloud-state-sync")
        : null,
    },
  );
}

function ensureFeedbackRepository(feedbackRepo, runLogsDir) {
  if (!existsSync(path.join(feedbackRepo, ".git"))) {
    command(
      "git",
      [
        "clone",
        "--no-checkout",
        "--no-tags",
        "--single-branch",
        "--branch",
        "feedback-inbox",
        REPOSITORY_URL,
        feedbackRepo,
      ],
      {
        label: "Feedback repository clone",
        privateLogBase: path.join(runLogsDir, "feedback-clone"),
      },
    );
  } else {
    const origin = gitOutput(feedbackRepo, ["remote", "get-url", "origin"]);
    if (!originIsExpected(origin)) throw new Error("Feedback cache has an unexpected origin");
  }
  git(
    feedbackRepo,
    [
      "fetch",
      "--prune",
      "origin",
      "+refs/heads/feedback-inbox:refs/remotes/origin/feedback-inbox",
      "+refs/heads/main:refs/remotes/origin/main",
    ],
    {
      label: "Feedback branch fetch",
      privateLogBase: path.join(runLogsDir, "feedback-fetch"),
    },
  );
  return gitOutput(feedbackRepo, ["rev-parse", "origin/feedback-inbox"]);
}

function ensureAppendOnlyCheckpoint(feedbackRepo, checkpoint, feedbackHead) {
  if (!checkpoint) return;
  const exists = git(feedbackRepo, ["cat-file", "-e", `${checkpoint}^{commit}`], {
    allowFailure: true,
  });
  if (exists.status !== 0) {
    throw new Error("Stored feedback checkpoint is no longer available");
  }
  const ancestor = git(
    feedbackRepo,
    ["merge-base", "--is-ancestor", checkpoint, feedbackHead],
    { allowFailure: true },
  );
  if (ancestor.status !== 0) {
    throw new Error("Feedback branch history changed; private human review is required");
  }
}

function collectFeedback(feedbackRepo, checkpoint, feedbackHead, analysisDir, runLogsDir) {
  privateDirectory(analysisDir);
  const inputPath = path.join(analysisDir, "input.json");
  const commandArgs = [
    path.join(OPS_DIR, "collect-feedback.mjs"),
    "--repo",
    feedbackRepo,
  ];
  if (checkpoint) commandArgs.push("--from", checkpoint);
  commandArgs.push("--to", feedbackHead, "--output", inputPath);
  command("node", commandArgs, {
    env: safeEnvironment(),
    label: "Feedback validation",
    privateLogBase: path.join(runLogsDir, "collect-feedback"),
  });
  return { inputPath, input: readJson(inputPath) };
}

function codexPermissionArgs(mode) {
  const profile = mode === "read" ? "nightly_read" : "nightly_edit";
  const access = mode === "read" ? "read" : "write";
  const args = [
    "--ask-for-approval",
    "never",
    "--ephemeral",
  ];
  if (process.env.STABILIZE_NIGHTLY_CODEX_PROXY !== "1") {
    args.push("--ignore-user-config");
  }
  args.push(
    "--color",
    "never",
    "-c",
    "allow_login_shell=false",
    "-c",
    'shell_environment_policy.inherit="none"',
    "-c",
    "shell_environment_policy.ignore_default_excludes=false",
    "-c",
    'history.persistence="none"',
    "-c",
    'web_search="disabled"',
    "-c",
    "analytics.enabled=false",
    "-c",
    `default_permissions="${profile}"`,
  );
  if (mode === "write") {
    args.push("-c", `permissions.${profile}.extends=":workspace"`);
  }
  args.push(
    "-c",
    `permissions.${profile}.filesystem={":root"="deny",":minimal"="read",":workspace_roots"={"."="${access}"}}`,
    "-c",
    `permissions.${profile}.network.enabled=false`,
  );
  return args;
}

function stopCodexProxy(runLogsDir) {
  if (process.env.STABILIZE_NIGHTLY_CODEX_PROXY !== "1" || codexProxyStopped) return;
  if (!process.env.CODEX_HOME || !path.isAbsolute(process.env.CODEX_HOME)) {
    throw new Error("Cloud Codex runs require an absolute CODEX_HOME");
  }
  const runId = process.env.GITHUB_RUN_ID || "";
  if (!/^[1-9][0-9]*$/.test(runId)) {
    throw new Error("Cloud Codex proxy shutdown requires a valid GITHUB_RUN_ID");
  }
  const serverInfoPath = path.join(process.env.CODEX_HOME, `${runId}.json`);
  const serverInfoStats = lstatSync(serverInfoPath);
  if (!serverInfoStats.isFile() || serverInfoStats.isSymbolicLink()) {
    throw new Error("Cloud Codex proxy server info is not a regular file");
  }
  const serverInfo = readJson(serverInfoPath);
  if (
    !Number.isInteger(serverInfo.port) ||
    serverInfo.port < 1 ||
    serverInfo.port > 65535 ||
    !Number.isInteger(serverInfo.pid) ||
    serverInfo.pid < 2
  ) {
    throw new Error("Cloud Codex proxy server info is invalid");
  }
  const curl = "/usr/bin/curl";
  if (!existsSync(curl)) throw new Error("Cloud Codex proxy shutdown requires curl");
  command(
    curl,
    [
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "5",
      `http://127.0.0.1:${serverInfo.port}/shutdown`,
    ],
    {
      env: safeEnvironment(),
      label: "Cloud Codex proxy shutdown",
      privateLogBase: path.join(runLogsDir, "codex-proxy-shutdown"),
    },
  );
  codexProxyStopped = true;
}

function runAnalysis(analysisDir, runLogsDir) {
  const planPath = path.join(analysisDir, "plan.json");
  const prompt = readFileSync(path.join(OPS_DIR, "analyze.prompt.md"), "utf8");
  command(
    "codex",
    [
      "exec",
      "-C",
      analysisDir,
      "--skip-git-repo-check",
      ...codexPermissionArgs("read"),
      "--output-schema",
      path.join(OPS_DIR, "analyze.schema.json"),
      "-o",
      planPath,
      prompt,
    ],
    {
      cwd: analysisDir,
      env: safeEnvironment(os.homedir(), { includeCodexProxy: true }),
      timeout: 30 * 60 * 1000,
      label: "Read-only feedback classification",
      privateLogBase: path.join(runLogsDir, "codex-analysis"),
    },
  );
  if (!existsSync(planPath)) throw new Error("Codex did not create an analysis plan");
  chmodSync(planPath, 0o600);
  return { planPath, plan: validateAnalysisPlan(readJson(planPath)) };
}

function cloneMain(destination, expectedHead, runLogsDir, label) {
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
    {
      label,
      privateLogBase: path.join(runLogsDir, label.replaceAll(" ", "-")),
    },
  );
  const actualHead = gitOutput(destination, ["rev-parse", "HEAD"]);
  if (actualHead !== expectedHead) {
    throw new Error("main changed during the nightly run; retry on the next run");
  }
}

function runEdit(editRepo, plan, runDirectory, runLogsDir) {
  git(editRepo, ["remote", "remove", "origin"]);
  const resultPath = path.join(runDirectory, "edit-result.json");
  const basePrompt = readFileSync(path.join(OPS_DIR, "edit.prompt.md"), "utf8");
  const prompt = `${basePrompt}\n\nTrusted enum-only plan:\n${JSON.stringify(plan)}\n`;
  command(
    "codex",
    [
      "exec",
      "-C",
      editRepo,
      ...codexPermissionArgs("write"),
      "--output-schema",
      path.join(OPS_DIR, "edit.schema.json"),
      "-o",
      resultPath,
      prompt,
    ],
    {
      cwd: editRepo,
      env: safeEnvironment(os.homedir(), { includeCodexProxy: true }),
      timeout: 30 * 60 * 1000,
      label: "Bounded CSS edit",
      privateLogBase: path.join(runLogsDir, "codex-edit"),
    },
  );
  if (!existsSync(resultPath)) throw new Error("Codex did not create an edit result");
  chmodSync(resultPath, 0o600);
  return resultPath;
}

function runWithoutNetwork(binary, args, options = {}) {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) {
    throw new Error("Trusted verification requires macOS sandbox-exec");
  }
  const profilePath = path.join(OPS_DIR, "verification.sb");
  if (!existsSync(profilePath)) throw new Error("Trusted verification profile is missing");
  if (!options.writableRoot || !path.isAbsolute(options.writableRoot)) {
    throw new Error("Trusted verification requires an absolute disposable writable root");
  }
  const { writableRoot, ...commandOptions } = options;
  return command(
    "/usr/bin/sandbox-exec",
    ["-D", `WRITABLE_ROOT=${writableRoot}`, "-f", profilePath, binary, ...args],
    commandOptions,
  );
}

function verificationEnvironment(verificationRoot) {
  const home = path.join(verificationRoot, "home");
  const cache = path.join(verificationRoot, "npm-cache");
  const temporaryDirectory = path.join(verificationRoot, "tmp");
  privateDirectory(home);
  privateDirectory(cache);
  privateDirectory(temporaryDirectory);
  return {
    ...safeEnvironment(home),
    TMPDIR: temporaryDirectory,
    NPM_CONFIG_CACHE: cache,
    npm_config_cache: cache,
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
  };
}

function cleanBaseline(verificationRepo, verificationRoot, runLogsDir) {
  const environment = verificationEnvironment(verificationRoot);
  command("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: verificationRepo,
    env: environment,
    timeout: 15 * 60 * 1000,
    label: "Trusted dependency installation",
    privateLogBase: path.join(runLogsDir, "npm-ci"),
  });
  runWithoutNetwork("npm", ["run", "apply:prompt-policy"], {
    cwd: verificationRepo,
    env: environment,
    timeout: 10 * 60 * 1000,
    label: "Trusted policy normalization",
    privateLogBase: path.join(runLogsDir, "policy-baseline"),
    writableRoot: verificationRoot,
  });
  runWithoutNetwork("npm", ["run", "types"], {
    cwd: verificationRepo,
    env: environment,
    timeout: 10 * 60 * 1000,
    label: "Trusted type normalization",
    privateLogBase: path.join(runLogsDir, "types-baseline"),
    writableRoot: verificationRoot,
  });
  const baselineFiles = nulList(
    git(verificationRepo, ["diff", "HEAD", "--name-only", "-z", "--"]).stdout,
  );
  if (baselineFiles.some((filePath) => ["public/product.css", "public/guides.css"].includes(filePath))) {
    throw new Error("Trusted policy normalization touched a nightly-editable CSS file");
  }
  const firstBaseline = diffDigest(verificationRepo);
  runWithoutNetwork("npm", ["run", "apply:prompt-policy"], {
    cwd: verificationRepo,
    env: environment,
    timeout: 10 * 60 * 1000,
    label: "Trusted policy idempotence check",
    privateLogBase: path.join(runLogsDir, "policy-idempotence"),
    writableRoot: verificationRoot,
  });
  runWithoutNetwork("npm", ["run", "types"], {
    cwd: verificationRepo,
    env: environment,
    timeout: 10 * 60 * 1000,
    label: "Trusted type idempotence check",
    privateLogBase: path.join(runLogsDir, "types-idempotence"),
    writableRoot: verificationRoot,
  });
  const secondBaseline = diffDigest(verificationRepo);
  if (firstBaseline.sha256 !== secondBaseline.sha256) {
    throw new Error("Trusted policy normalization is not idempotent");
  }
  const untracked = gitOutput(
    verificationRepo,
    ["ls-files", "--others", "--exclude-standard"],
  );
  if (untracked) {
    throw new Error("Trusted policy normalization created an unexpected file");
  }
  return { environment, baselineFiles };
}

function validateInFreshClone({
  verificationRepo,
  planPath,
  editResultPath,
  patchPath,
  expectedHead,
  expectedDiffHash,
  verificationRoot,
  runLogsDir,
}) {
  const { environment, baselineFiles } = cleanBaseline(
    verificationRepo,
    verificationRoot,
    runLogsDir,
  );
  command("git", ["-C", verificationRepo, "apply", "--whitespace=error-all", patchPath], {
    label: "Verified patch application",
  });
  const plan = validateAnalysisPlan(readJson(planPath));
  const appliedAgentDiff = diffDigest(verificationRepo, [plan.targetFile]);
  if (appliedAgentDiff.sha256 !== expectedDiffHash) {
    throw new Error("Fresh-clone diff does not match the gated agent diff");
  }
  const combinedBeforeTests = diffDigest(verificationRepo);

  for (const [label, commandArgs, timeout, logName] of [
    ["Tests", ["test"], 25 * 60 * 1000, "npm-test"],
    ["Cloudflare dry run", ["run", "check"], 20 * 60 * 1000, "npm-check"],
  ]) {
    runWithoutNetwork("npm", commandArgs, {
      cwd: verificationRepo,
      env: environment,
      timeout,
      label,
      privateLogBase: path.join(runLogsDir, logName),
      writableRoot: verificationRoot,
    });
  }
  const combinedAfterTests = diffDigest(verificationRepo);
  if (combinedAfterTests.sha256 !== combinedBeforeTests.sha256) {
    throw new Error("Validation changed the exact generated baseline or proposed diff");
  }
  if (baselineFiles.length) {
    git(verificationRepo, ["restore", "--source=HEAD", "--", ...baselineFiles]);
  }
  const afterTests = verifyChange({
    repo: verificationRepo,
    planPath,
    resultPath: editResultPath,
    expectedHead,
    strictUntracked: false,
  });
  if (afterTests.diffSha256 !== expectedDiffHash) {
    throw new Error("Final clean proposal does not match the exact gated diff");
  }
  return afterTests;
}

function prepareFreshPublicationClone({
  destination,
  planPath,
  editResultPath,
  patchPath,
  expectedHead,
  expectedDiffHash,
  runLogsDir,
}) {
  cloneMain(destination, expectedHead, runLogsDir, "fresh publication clone");
  command("git", ["-C", destination, "apply", "--whitespace=error-all", patchPath], {
    label: "Publication patch application",
  });
  const verified = verifyChange({
    repo: destination,
    planPath,
    resultPath: editResultPath,
    expectedHead,
    strictUntracked: true,
  });
  if (verified.diffSha256 !== expectedDiffHash) {
    throw new Error("Fresh publication clone does not match the exact tested diff");
  }
  return verified;
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
      "- `npm test` passed with external network access denied",
      "- `npm run check` passed with external network access denied",
      "- exact post-test diff hash matched",
      "",
      "A person must inspect the visual diff and decide whether to merge it.",
      "",
      `<!-- stabilize-nightly-feedback-head: ${pending.feedbackHead} -->`,
      "",
    ].join("\n");
}

function pullRequestView(reference, runLogsDir, allowMissing = false) {
  const result = command(
    "gh",
    [
      "pr",
      "view",
      String(reference),
      "--repo",
      REPOSITORY,
      "--json",
      "number,url,state,isDraft,mergedAt,baseRefName,headRefName,headRefOid,isCrossRepository,headRepositoryOwner",
    ],
    {
      allowFailure: allowMissing,
      label: "Pull request lookup",
      privateLogBase: path.join(runLogsDir, "pending-pr"),
    },
  );
  if (allowMissing && result.status !== 0) return null;
  return JSON.parse(result.stdout);
}

function createDraftFromIntent(intent, pendingPath, runLogsDir) {
  const bodyPath = path.join(path.dirname(pendingPath), `${intent.runId}-pr-body.md`);
  atomicWrite(bodyPath, pullRequestBody(intent));
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
    {
      label: "Draft pull request creation",
      privateLogBase: path.join(runLogsDir, "create-pr"),
    },
  );
  const pullRequest = pullRequestView(intent.headRefName, runLogsDir);
  validatePullRequestIdentity(intent, pullRequest);
  if (pullRequest.state !== "OPEN" || pullRequest.isDraft !== true) {
    throw new Error("Created pull request is not an open draft");
  }
  unlinkSync(bodyPath);
  return pullRequest;
}

function createPullRequest({
  verificationRepo,
  branch,
  feedbackInput,
  changedFiles,
  runId,
  pendingPath,
  reportsDir,
  runLogsDir,
}) {
  const title = `Nightly presentation improvement ${runId.slice(0, 8)}`;
  git(verificationRepo, ["switch", "-c", branch]);
  git(verificationRepo, ["add", "--", ...changedFiles]);
  git(
    verificationRepo,
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Stabilize Nightly",
      "-c",
      "user.email=nightly@stabilize.invalid",
      "commit",
      "--no-verify",
      "-m",
      title,
    ],
  );
  const intent = createPublishingIntent({
    branch,
    feedbackHead: feedbackInput.feedbackHead,
    headRefOid: gitOutput(verificationRepo, ["rev-parse", "HEAD"]),
    runId,
    changedFile: changedFiles[0],
    feedbackCount: feedbackInput.count,
    categoryCounts: feedbackInput.categoryCounts,
  });
  // Persist the exact publication identity before the first external write.
  writeJson(pendingPath, intent);
  syncCloudState(path.dirname(pendingPath));
  git(
    verificationRepo,
    [
      "-c",
      "core.hooksPath=/dev/null",
      "push",
      "--no-verify",
      "--set-upstream",
      "origin",
      branch,
    ],
    { label: "Draft branch push" },
  );

  const pullRequest = createDraftFromIntent(intent, pendingPath, runLogsDir);
  writeJson(pendingPath, completePublishingIntent(intent, pullRequest));
  syncCloudState(path.dirname(pendingPath));
  const report = writeReport(reportsDir, runId, "draft_pr", {
    pullRequest: pullRequest.number,
    url: pullRequest.url,
    feedbackHead: intent.feedbackHead,
    feedbackCount: intent.feedbackCount,
    changedFile: changedFiles[0],
  });
  return { pullRequest, report };
}

function createPrivatePending(pendingPrivatePath, input, source) {
  writeJson(pendingPrivatePath, {
    schemaVersion: 1,
    feedbackHead: input.feedbackHead,
    source,
    items: input.items.map((item) => ({
      id: item.id,
      filePath: item.filePath,
      reasons: item.protectedReasons,
    })),
    createdAt: new Date().toISOString(),
  });
  syncCloudState(path.dirname(pendingPrivatePath));
}

function remoteBranchOid(branch, runLogsDir) {
  const result = command(
    "git",
    ["ls-remote", "--heads", REPOSITORY_URL, `refs/heads/${branch}`],
    {
      label: "Remote nightly branch lookup",
      privateLogBase: path.join(runLogsDir, "pending-branch"),
    },
  );
  const output = result.stdout.trim();
  if (!output) return null;
  const [oid, ref, ...extra] = output.split(/\s+/);
  if (extra.length || !/^[0-9a-f]{40}$/i.test(oid) || ref !== `refs/heads/${branch}`) {
    throw new Error("Remote nightly branch lookup returned an unexpected identity");
  }
  return oid;
}

function pendingPullRequestState(pendingPath, runLogsDir) {
  let pending = validatePendingReview(readJson(pendingPath));
  let publicationCompleted = false;
  if (pending.phase === "publishing") {
    let pullRequest = pullRequestView(pending.headRefName, runLogsDir, true);
    if (!pullRequest) {
      const remoteOid = remoteBranchOid(pending.headRefName, runLogsDir);
      if (!remoteOid) {
        unlinkSync(pendingPath);
        syncCloudState(path.dirname(pendingPath));
        return { pending: null, pullRequest: null, retry: true };
      }
      if (remoteOid !== pending.headRefOid) {
        throw new Error("Remote nightly branch does not match the persisted publishing intent");
      }
      if (cloudPrepareMode()) {
        return { pending, pullRequest: null, retry: false, recovery: true };
      }
      pullRequest = createDraftFromIntent(pending, pendingPath, runLogsDir);
    }
    pending = completePublishingIntent(pending, pullRequest);
    writeJson(pendingPath, pending);
    syncCloudState(path.dirname(pendingPath));
    publicationCompleted = true;
  }
  const pullRequest = pullRequestView(pending.pullRequest, runLogsDir);
  validatePullRequestIdentity(pending, pullRequest);
  return {
    pending,
    pullRequest,
    retry: false,
    recovery: false,
    publicationCompleted,
  };
}

function resolvePendingReview(pendingPath, checkpointPath, runLogsDir) {
  if (!existsSync(pendingPath)) return false;
  const {
    pending,
    pullRequest,
    retry,
    recovery,
    publicationCompleted,
  } = pendingPullRequestState(pendingPath, runLogsDir);
  if (retry) {
    process.stdout.write(
      cloudPrepareMode()
        ? "Recovered an interrupted pre-push run; persisting the bounded recovery state.\n"
        : "Recovered an interrupted pre-push run; retrying the feedback batch.\n",
    );
    return cloudPrepareMode();
  }
  if (recovery) {
    process.stdout.write("A previous publication needs recovery on the write-only runner.\n");
    return true;
  }
  if (publicationCompleted && cloudPrepareMode()) {
    process.stdout.write("Persisting the recovered pull request identity before its disposition.\n");
    return true;
  }
  if (pullRequest.state === "OPEN") {
    process.stdout.write(`Draft PR #${pending.pullRequest} still awaits human review.\n`);
    return true;
  }
  if (pullRequest.mergedAt) {
    writeCheckpoint(checkpointPath, pending.feedbackHead);
    unlinkSync(pendingPath);
    syncCloudState(path.dirname(pendingPath));
    return cloudPrepareMode();
  }
  process.stdout.write(
    `PR #${pending.pullRequest} was closed without merge. Run --acknowledge-pending after reviewing that disposition.\n`,
  );
  return true;
}

function acknowledgePending({
  pendingPath,
  pendingPrivatePath,
  checkpointPath,
  runLogsDir,
}) {
  if (existsSync(pendingPrivatePath)) {
    const pending = readJson(pendingPrivatePath);
    if (!/^[0-9a-f]{40}$/i.test(pending.feedbackHead)) {
      throw new Error("Protected-review state is invalid");
    }
    writeCheckpoint(checkpointPath, pending.feedbackHead);
    unlinkSync(pendingPrivatePath);
    syncCloudState(path.dirname(pendingPrivatePath));
    process.stdout.write("Acknowledged the protected feedback review checkpoint.\n");
    return;
  }
  if (existsSync(pendingPath)) {
    const { pending, pullRequest, retry } = pendingPullRequestState(pendingPath, runLogsDir);
    if (retry) {
      throw new Error("Interrupted publication had no remote branch; run the nightly review again");
    }
    if (pullRequest.state === "OPEN") {
      throw new Error("The draft PR is still open; review it before acknowledging");
    }
    writeCheckpoint(checkpointPath, pending.feedbackHead);
    unlinkSync(pendingPath);
    syncCloudState(path.dirname(pendingPath));
    process.stdout.write("Acknowledged the closed pull request disposition.\n");
    return;
  }
  throw new Error("There is no pending review to acknowledge");
}

function findOpenNightlyPullRequest(runLogsDir) {
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
      "number,url,headRefName,isDraft,isCrossRepository,headRepositoryOwner",
    ],
    {
      label: "Open pull request check",
      privateLogBase: path.join(runLogsDir, "open-prs"),
    },
  );
  return JSON.parse(result.stdout).find(
    (pullRequest) =>
      pullRequest.isCrossRepository === false &&
      pullRequest.headRepositoryOwner?.login === "lreedm1" &&
      String(pullRequest.headRefName || "").startsWith("agent/nightly-"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof process.getuid !== "function" || process.getuid() === 0) {
    throw new Error("Run the nightly reviewer as a normal user, never as root");
  }
  const stateDir = resolvePrivateStateDirectory(
    args.stateDir ||
      process.env.STABILIZE_NIGHTLY_STATE_DIR ||
      path.join(os.homedir(), "Library", "Application Support", "Stabilize Nightly"),
    {
      home: os.homedir(),
      repoRoot: REPO_ROOT,
      tempRoot: os.tmpdir(),
      uid: process.getuid(),
    },
  );
  const reportsDir = path.join(stateDir, "reports");
  const feedbackRepo = path.join(stateDir, "feedback-repository");
  const checkpointPath = path.join(stateDir, "feedback-checkpoint");
  const pendingPath = path.join(stateDir, "pending-review.json");
  const pendingPrivatePath = path.join(stateDir, "pending-private-review.json");
  const lockDir = path.join(stateDir, "run.lock");
  const runId = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${process.pid}`;
  activeRunDirectory = path.join(stateDir, "runs", runId);
  const runLogsDir = path.join(activeRunDirectory, "logs");

  privateDirectory(stateDir);
  privateDirectory(reportsDir);
  privateDirectory(path.dirname(activeRunDirectory));
  privateDirectory(activeRunDirectory);
  privateDirectory(runLogsDir);
  if (!acquireLock(lockDir)) {
    process.stdout.write("Another nightly review is already running.\n");
    return;
  }

  const cloudInitialState = cloudPrepareMode() ? captureCloudState(stateDir) : null;

  let completed = false;
  try {
    preflight(runLogsDir);
    if (args.acknowledgePending) {
      acknowledgePending({
        pendingPath,
        pendingPrivatePath,
        checkpointPath,
        runLogsDir,
      });
      completed = true;
      return;
    }
    if (existsSync(pendingPrivatePath)) {
      process.stdout.write(
        "Protected feedback still awaits human review. Use --acknowledge-pending only after reviewing it.\n",
      );
      completed = true;
      return;
    }
    if (resolvePendingReview(pendingPath, checkpointPath, runLogsDir)) {
      completed = true;
      return;
    }
    const openPullRequest = findOpenNightlyPullRequest(runLogsDir);
    if (openPullRequest) {
      writeReport(reportsDir, runId, "skipped_open_pr", {
        pullRequest: openPullRequest.number,
        url: openPullRequest.url,
      });
      process.stdout.write(`Nightly review skipped: PR #${openPullRequest.number} is open.\n`);
      completed = true;
      return;
    }

    git(
      REPO_ROOT,
      ["fetch", "--prune", "origin", "+refs/heads/main:refs/remotes/origin/main"],
      { label: "main branch fetch" },
    );
    const mainHead = gitOutput(REPO_ROOT, ["rev-parse", "origin/main"]);
    const feedbackHead = ensureFeedbackRepository(feedbackRepo, runLogsDir);
    const checkpoint = currentCheckpoint(checkpointPath);
    ensureAppendOnlyCheckpoint(feedbackRepo, checkpoint, feedbackHead);
    if (checkpoint === feedbackHead) {
      writeReport(reportsDir, runId, "no_new_feedback", { feedbackHead });
      process.stdout.write("No new feedback.\n");
      completed = true;
      return;
    }

    const analysisDir = path.join(activeRunDirectory, "analysis");
    if (!checkpoint) {
      const { input: existingInput } = collectFeedback(
        feedbackRepo,
        null,
        feedbackHead,
        analysisDir,
        runLogsDir,
      );
      if (!args.dryRun) writeCheckpoint(checkpointPath, feedbackHead);
      writeReport(reportsDir, runId, args.dryRun ? "dry_run" : "baseline_initialized", {
        feedbackHead,
        validatedExistingFeedbackCount: existingInput.count,
      });
      process.stdout.write(
        args.dryRun
          ? `Dry run validated ${existingInput.count} existing feedback item(s); the first scheduled run will establish the baseline.\n`
          : "Initialized the feedback baseline. New submissions will be reviewed on the next run.\n",
      );
      completed = true;
      return;
    }
    const { input, inputPath } = collectFeedback(
      feedbackRepo,
      checkpoint,
      feedbackHead,
      analysisDir,
      runLogsDir,
    );
    if (input.count === 0) {
      if (!args.dryRun) writeCheckpoint(checkpointPath, feedbackHead);
      writeReport(reportsDir, runId, args.dryRun ? "dry_run" : "no_new_feedback", {
        feedbackHead,
        validatedFeedbackCount: 0,
      });
      process.stdout.write("No new validated feedback records.\n");
      completed = true;
      return;
    }
    if (args.dryRun) {
      writeReport(reportsDir, runId, "dry_run", {
        feedbackHead,
        validatedFeedbackCount: input.count,
        categoryCounts: input.categoryCounts,
        protectedItemCount: input.items.filter((item) => item.protectedReasons.length).length,
      });
      process.stdout.write(`Dry run passed with ${input.count} validated feedback item(s).\n`);
      completed = true;
      return;
    }
    if (input.hasProtectedContent) {
      createPrivatePending(pendingPrivatePath, input, "deterministic_filter");
      writeReport(reportsDir, runId, "private_review", {
        feedbackHead,
        feedbackCount: input.count,
        protectedItems: input.items
          .filter((item) => item.protectedReasons.length)
          .map((item) => ({ id: item.id, filePath: item.filePath, reasons: item.protectedReasons })),
      });
      notify("Stabilize nightly review", "Protected feedback needs private human review; no code change was made.");
      process.stdout.write("Protected feedback routed to private human review.\n");
      completed = true;
      return;
    }

    const { planPath, plan } = runAnalysis(analysisDir, runLogsDir);
    if (plan.outcome === "private_review") {
      createPrivatePending(pendingPrivatePath, input, "read_only_classifier");
      writeReport(reportsDir, runId, "private_review", {
        feedbackHead,
        feedbackCount: input.count,
        items: input.items.map((item) => ({ id: item.id, filePath: item.filePath })),
      });
      notify("Stabilize nightly review", "Protected feedback needs private human review; no code change was made.");
      process.stdout.write("Feedback classifier requested private human review.\n");
      completed = true;
      return;
    }
    if (plan.outcome === "no_change") {
      writeCheckpoint(checkpointPath, feedbackHead);
      writeReport(reportsDir, runId, "no_change", {
        feedbackHead,
        feedbackCount: input.count,
        categoryCounts: input.categoryCounts,
        plan,
      });
      notify("Stabilize nightly review", "Review completed with no code change.");
      process.stdout.write("Nightly review completed with no code change.\n");
      completed = true;
      return;
    }

    const editRepo = path.join(activeRunDirectory, "edit-repository");
    cloneMain(editRepo, mainHead, runLogsDir, "isolated edit clone");
    const editResultPath = runEdit(editRepo, plan, activeRunDirectory, runLogsDir);
    // Repository code never runs while the API-key-bearing local proxy is live.
    stopCodexProxy(runLogsDir);
    const gatedEdit = verifyChange({
      repo: editRepo,
      planPath,
      resultPath: editResultPath,
      expectedHead: mainHead,
      strictUntracked: true,
    });
    if (gatedEdit.result.outcome === "unable") {
      writeCheckpoint(checkpointPath, feedbackHead);
      writeReport(reportsDir, runId, "no_change", {
        feedbackHead,
        feedbackCount: input.count,
        reason: "bounded_edit_unavailable",
        plan,
      });
      process.stdout.write("Bounded edit was unavailable; no code change was made.\n");
      completed = true;
      return;
    }
    const patchPath = path.join(activeRunDirectory, "gated-change.patch");
    atomicWrite(patchPath, gatedEdit.diffText);

    if (cloudPrepareMode()) {
      cloudProposal = {
        manifest: {
          mainHead,
          feedbackHead,
          diffSha256: gatedEdit.diffSha256,
          runId,
          changedFile: gatedEdit.changedFiles[0],
          feedbackCount: input.count,
          categoryCounts: input.categoryCounts,
        },
        patchPath,
        planPath,
        editResultPath,
      };
      writeReport(reportsDir, runId, "proposal_prepared", {
        feedbackHead,
        feedbackCount: input.count,
        changedFile: gatedEdit.changedFiles[0],
        diffSha256: gatedEdit.diffSha256,
      });
      process.stdout.write("Prepared a gated proposal for isolated verification.\n");
      completed = true;
      return;
    }

    const verificationRoot = path.join(activeRunDirectory, "verification-sandbox");
    privateDirectory(verificationRoot);
    const verificationRepo = path.join(verificationRoot, "repository");
    cloneMain(verificationRepo, mainHead, runLogsDir, "fresh verification clone");
    const verified = validateInFreshClone({
      verificationRepo,
      planPath,
      editResultPath,
      patchPath,
      expectedHead: mainHead,
      expectedDiffHash: gatedEdit.diffSha256,
      verificationRoot,
      runLogsDir,
    });
    const publicationRepo = path.join(activeRunDirectory, "publication-repository");
    const publicationVerified = prepareFreshPublicationClone({
      destination: publicationRepo,
      planPath,
      editResultPath,
      patchPath,
      expectedHead: mainHead,
      expectedDiffHash: gatedEdit.diffSha256,
      runLogsDir,
    });
    if (JSON.stringify(publicationVerified.changedFiles) !== JSON.stringify(verified.changedFiles)) {
      throw new Error("Fresh publication clone changed the verified file identity");
    }
    const branch = `agent/nightly-${runId}`;
    const { pullRequest, report } = createPullRequest({
      verificationRepo: publicationRepo,
      branch,
      feedbackInput: input,
      changedFiles: publicationVerified.changedFiles,
      runId,
      pendingPath,
      reportsDir,
      runLogsDir,
    });
    notify("Stabilize nightly review", `Draft PR #${pullRequest.number} is ready for review.`);
    process.stdout.write(`Created draft PR ${pullRequest.url}. Report: ${report}\n`);
    completed = true;
  } catch (error) {
    preserveRunDirectory = Boolean(activeRunDirectory);
    const failureReport = writeReport(reportsDir, runId, "failed", {
      message: error.message,
      preservedRunDirectory: activeRunDirectory,
    });
    notify("Stabilize nightly review", "The nightly review stopped safely; no production change was made.");
    process.stderr.write(`${error.message}\nFailure report: ${failureReport}\n`);
    if (activeRunDirectory) {
      process.stderr.write(`Private run directory preserved for inspection: ${activeRunDirectory}\n`);
    }
    process.exitCode = 1;
  } finally {
    if (process.env.STABILIZE_NIGHTLY_CODEX_PROXY === "1" && !codexProxyStopped) {
      try {
        stopCodexProxy(runLogsDir);
      } catch (error) {
        preserveRunDirectory = Boolean(activeRunDirectory);
        completed = false;
        process.exitCode = 1;
        process.stderr.write(`Failed to stop the protected Codex proxy: ${error.message}\n`);
      }
    }
    if (completed && cloudPrepareMode()) {
      try {
        const bundleDir = process.env.STABILIZE_NIGHTLY_BUNDLE_DIR;
        const stateHead = process.env.STABILIZE_NIGHTLY_STATE_HEAD || "";
        if (!path.isAbsolute(bundleDir)) {
          throw new Error("Cloud bundle directory must be absolute");
        }
        createCloudBundle({
          bundleDir,
          stateDir,
          stateHead,
          proposal: cloudProposal,
          initialState: cloudInitialState,
        });
      } catch (error) {
        preserveRunDirectory = Boolean(activeRunDirectory);
        completed = false;
        process.exitCode = 1;
        process.stderr.write(`Failed to create the bounded cloud bundle: ${error.message}\n`);
      }
    }
    if (completed) cleanupRunDirectory();
    releaseLock(lockDir);
  }
}

await main();

import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_FILE_BYTES = 8_192;
const MAX_ITEMS = 200;
const MAX_TOTAL_BYTES = 512 * 1024;
const CATEGORY_LABELS = new Map([
  ["bug", "Bug"],
  ["idea", "Idea"],
  ["experience", "Experience"],
  ["other", "Other"],
]);
const EXPECTED_KEYS = [
  "category",
  "categoryLabel",
  "id",
  "message",
  "schemaVersion",
  "signedIn",
  "source",
  "submittedAt",
].sort();

function git(repo, args, options = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function nulList(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function protectedReasons(message) {
  const reasons = new Set();
  const value = String(message);
  if (
    /(?:github_pat_|ghp_|sk-[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:password|passcode|api[_ -]?key|access[_ -]?token)\b\s*[:=])/i.test(
      value,
    )
  ) {
    reasons.add("credential_or_secret");
  }
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) ||
    /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(value) ||
    /\b\d{3}-\d{2}-\d{4}\b/.test(value)
  ) {
    reasons.add("contact_or_identifying_information");
  }
  if (
    /\b(?:vulnerability|security bug|exploit|cross[- ]site|xss|csrf|injection|account takeover|bypass authentication|data leak)\b/i.test(
      value,
    )
  ) {
    reasons.add("security_report");
  }
  if (
    /\b(?:suicid(?:e|al)|self[- ]harm|overdose|abuse|assault|my (?:medication|diagnosis|therapist|doctor)|medical record|crisis disclosure)\b/i.test(
      value,
    )
  ) {
    reasons.add("individual_health_or_crisis_disclosure");
  }
  return [...reasons].sort();
}

export function expectedFeedbackPath(record) {
  const submittedAt = new Date(record.submittedAt);
  const year = String(submittedAt.getUTCFullYear());
  const month = String(submittedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(submittedAt.getUTCDate()).padStart(2, "0");
  const timestamp = submittedAt
    .toISOString()
    .replaceAll(":", "-")
    .replace(".000Z", "Z");
  return `feedback/${year}/${month}/${day}/${timestamp}-${record.id}.json`;
}

export function validateFeedbackRecord(record, filePath) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`${filePath}: record must be an object`);
  }

  const keys = Object.keys(record).sort();
  if (JSON.stringify(keys) !== JSON.stringify(EXPECTED_KEYS)) {
    throw new Error(`${filePath}: unexpected schema keys`);
  }
  if (record.schemaVersion !== 1) {
    throw new Error(`${filePath}: unsupported schema version`);
  }
  if (!validUuid(record.id)) {
    throw new Error(`${filePath}: invalid identifier`);
  }
  const submittedAt = new Date(record.submittedAt);
  if (
    typeof record.submittedAt !== "string" ||
    !Number.isFinite(submittedAt.getTime()) ||
    submittedAt.toISOString() !== record.submittedAt
  ) {
    throw new Error(`${filePath}: invalid timestamp`);
  }
  if (record.source !== "stabilize.info" || record.signedIn !== true) {
    throw new Error(`${filePath}: invalid source metadata`);
  }
  if (
    !CATEGORY_LABELS.has(record.category) ||
    CATEGORY_LABELS.get(record.category) !== record.categoryLabel
  ) {
    throw new Error(`${filePath}: invalid category`);
  }
  if (
    typeof record.message !== "string" ||
    record.message.length < 10 ||
    record.message.length > 2_000 ||
    record.message.trim() !== record.message ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(record.message)
  ) {
    throw new Error(`${filePath}: invalid message`);
  }
  if (expectedFeedbackPath(record) !== filePath) {
    throw new Error(`${filePath}: path does not match record metadata`);
  }

  return {
    filePath,
    id: record.id,
    submittedAt: record.submittedAt,
    category: record.category,
    message: record.message,
    protectedReasons: protectedReasons(record.message),
  };
}

export function feedbackPathsBetween(repo, fromCommit, toCommit) {
  if (!/^[0-9a-f]{40}$/i.test(toCommit)) {
    throw new Error("Feedback head must be a full commit SHA");
  }

  let paths;
  if (fromCommit) {
    if (!/^[0-9a-f]{40}$/i.test(fromCommit)) {
      throw new Error("Checkpoint must be a full commit SHA");
    }
    const commits = git(repo, [
      "rev-list",
      "--reverse",
      "--topo-order",
      `${fromCommit}..${toCommit}`,
    ])
      .trim()
      .split("\n")
      .filter(Boolean);
    if (commits.length > MAX_ITEMS) {
      throw new Error(`Feedback history exceeds the ${MAX_ITEMS}-commit review limit`);
    }
    paths = [];
    for (const commit of commits) {
      const parents = git(repo, ["rev-list", "--parents", "-n", "1", commit])
        .trim()
        .split(/\s+/);
      if (parents.length !== 2) {
        throw new Error(`Feedback history contains a merge or root commit: ${commit}`);
      }
      const entries = nulList(
        git(
          repo,
          [
            "diff-tree",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-z",
            "--no-renames",
            parents[1],
            commit,
          ],
          { encoding: "buffer", maxBuffer: MAX_TOTAL_BYTES },
        ),
      );
      if (entries.length === 0 || entries.length % 2 !== 0) {
        throw new Error(`Feedback commit has an invalid or empty status stream: ${commit}`);
      }
      for (let index = 0; index < entries.length; index += 2) {
        const status = entries[index];
        const filePath = entries[index + 1];
        if (
          status !== "A" ||
          !/^feedback\/\d{4}\/\d{2}\/\d{2}\/[0-9T.Z-]+-[0-9a-f-]{36}\.json$/i.test(
            filePath,
          ) ||
          paths.includes(filePath)
        ) {
          throw new Error(`Feedback branch delta is not a canonical append: ${status} ${filePath}`);
        }
        paths.push(filePath);
      }
    }
  } else {
    const treePaths = nulList(
      git(
        repo,
        ["ls-tree", "-r", "--name-only", "-z", toCommit, "--", "feedback"],
        { encoding: "buffer" },
      ),
    );
    paths = [];
    for (const filePath of treePaths) {
      if (filePath === "feedback/README.md") continue;
      if (
        !/^feedback\/\d{4}\/\d{2}\/\d{2}\/[0-9T.Z-]+-[0-9a-f-]{36}\.json$/i.test(
          filePath,
        )
      ) {
        throw new Error(`Feedback tree contains an unexpected path: ${filePath}`);
      }
      paths.push(filePath);
    }
  }

  return paths.sort();
}

export function collectFeedback({ repo, fromCommit, toCommit }) {
  const paths = feedbackPathsBetween(repo, fromCommit, toCommit);
  if (paths.length > MAX_ITEMS) {
    throw new Error(`Feedback batch exceeds the ${MAX_ITEMS}-item review limit`);
  }
  const items = [];
  let totalBytes = 0;

  for (const filePath of paths) {
    if (
      !/^feedback\/\d{4}\/\d{2}\/\d{2}\/[0-9T.Z-]+-[0-9a-f-]{36}\.json$/i.test(
        filePath,
      )
    ) {
      throw new Error(`${filePath}: invalid feedback path`);
    }
    const objectName = `${toCommit}:${filePath}`;
    const size = Number(git(repo, ["cat-file", "-s", objectName]).trim());
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
      throw new Error(`${filePath}: invalid file size`);
    }
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Feedback batch exceeds the aggregate size limit");
    }
    const raw = git(repo, ["show", objectName], { maxBuffer: MAX_FILE_BYTES + 1 });
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      throw new Error(`${filePath}: invalid JSON`);
    }
    items.push(validateFeedbackRecord(record, filePath));
  }

  const categoryCounts = Object.fromEntries(
    [...CATEGORY_LABELS.keys()].map((category) => [
      category,
      items.filter((item) => item.category === category).length,
    ]),
  );

  return {
    schemaVersion: 1,
    checkpoint: fromCommit || null,
    feedbackHead: toCommit,
    count: items.length,
    totalBytes,
    categoryCounts,
    hasProtectedContent: items.some((item) => item.protectedReasons.length > 0),
    items,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!["--repo", "--from", "--to", "--output"].includes(name)) {
      throw new Error(`Unknown argument: ${name}`);
    }
    args[name.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!args.repo || !args.to || !args.output) {
    throw new Error("Usage: collect-feedback.mjs --repo PATH [--from SHA] --to SHA --output FILE");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = collectFeedback({
    repo: args.repo,
    fromCommit: args.from || null,
    toCommit: args.to,
  });
  writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(args.output, 0o600);
  process.stdout.write(`${result.count}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

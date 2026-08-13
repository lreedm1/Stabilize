const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const MAX_FEEDBACK_CHARS = 2_000;
const MIN_FEEDBACK_CHARS = 10;
const REPOSITORY_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._\/-]{1,128}$/;
const PATH_PATTERN = /^[A-Za-z0-9._\/-]{1,128}$/;
const TOKEN_PATTERN = /^(?:github_pat_|ghp_)[A-Za-z0-9_]{20,}$/;
const CATEGORY_LABELS = new Map([
  ["bug", "Bug"],
  ["idea", "Idea"],
  ["experience", "Experience"],
  ["other", "Other"],
]);

export class FeedbackConfigurationError extends Error {
  constructor(message = "Feedback storage is not configured") {
    super(message);
    this.name = "FeedbackConfigurationError";
  }
}

export class FeedbackRequestError extends Error {
  constructor(message = "Feedback could not be saved", status = 502) {
    super(message);
    this.name = "FeedbackRequestError";
    this.status = status;
  }
}

function boundedText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function cleanPath(value, fallback) {
  const text = boundedText(value || fallback, 128)
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  return PATH_PATTERN.test(text) ? text : null;
}

function configuration(env = {}) {
  const token = String(env.GITHUB_FEEDBACK_TOKEN || "").trim();
  const repository = boundedText(env.FEEDBACK_REPOSITORY || "lreedm1/Stabilize", 128);
  const branch = boundedText(env.FEEDBACK_BRANCH || "feedback-inbox", 128);
  const directory = cleanPath(env.FEEDBACK_PATH, "feedback");
  const match = repository.match(REPOSITORY_PATTERN);

  if (
    !TOKEN_PATTERN.test(token) ||
    !match ||
    !BRANCH_PATTERN.test(branch) ||
    !directory
  ) {
    throw new FeedbackConfigurationError();
  }

  return {
    token,
    owner: match[1],
    repository: match[2],
    branch,
    directory,
  };
}

export function feedbackConfigured(env = {}) {
  try {
    configuration(env);
    return true;
  } catch {
    return false;
  }
}

export function normalizeFeedback(input = {}) {
  const category = CATEGORY_LABELS.has(input.category) ? input.category : "other";
  const message = String(input.message || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_FEEDBACK_CHARS);

  if (message.length < MIN_FEEDBACK_CHARS) {
    throw new FeedbackRequestError(
      `Feedback must be at least ${MIN_FEEDBACK_CHARS} characters.`,
      400,
    );
  }

  return {
    category,
    categoryLabel: CATEGORY_LABELS.get(category),
    message,
  };
}

export function feedbackFilePath(record, directory = "feedback") {
  const submittedAt = new Date(record.submittedAt);
  if (!Number.isFinite(submittedAt.getTime())) {
    throw new FeedbackRequestError("Feedback timestamp is invalid.", 400);
  }
  const id = boundedText(record.id, 64);
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    throw new FeedbackRequestError("Feedback identifier is invalid.", 400);
  }

  const year = String(submittedAt.getUTCFullYear());
  const month = String(submittedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(submittedAt.getUTCDate()).padStart(2, "0");
  const timestamp = submittedAt
    .toISOString()
    .replaceAll(":", "-")
    .replace(".000Z", "Z");
  return `${directory}/${year}/${month}/${day}/${timestamp}-${id}.json`;
}

export function createFeedbackRecord(feedback, now = new Date(), id = crypto.randomUUID()) {
  return {
    schemaVersion: 1,
    id,
    submittedAt: now.toISOString(),
    source: "stabilize.info",
    signedIn: true,
    category: feedback.category,
    categoryLabel: feedback.categoryLabel,
    message: feedback.message,
  };
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function commitFeedback(env, record, fetchImpl = fetch) {
  const config = configuration(env);
  const path = feedbackFilePath(record, config.directory);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const endpoint = `${GITHUB_API_BASE}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/contents/${encodedPath}`;
  const body = {
    message: `Add ${record.category} feedback ${record.id.slice(0, 8)}`,
    branch: config.branch,
    content: base64Utf8(JSON.stringify(record, null, 2) + "\n"),
  };

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "User-Agent": "stabilize-feedback-worker",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new FeedbackRequestError("GitHub could not be reached.", 503);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(JSON.stringify({
      event: "feedback_git_commit_failed",
      status: response.status,
      requestId: response.headers.get("x-github-request-id") || null,
      documentationUrl: boundedText(result?.documentation_url, 256) || null,
    }));
    const status = response.status === 422 ? 429 : 502;
    throw new FeedbackRequestError("GitHub rejected the feedback submission.", status);
  }

  const commitSha = boundedText(result?.commit?.sha, 64);
  return {
    path,
    commitSha: /^[a-f0-9]{40}$/i.test(commitSha) ? commitSha : null,
  };
}

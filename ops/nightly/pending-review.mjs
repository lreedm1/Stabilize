const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const BRANCH_PATTERN = /^agent\/nightly-[0-9A-Za-z-]+$/;
const ALLOWED_FILES = new Set(["public/product.css", "public/guides.css"]);
const CATEGORY_KEYS = ["bug", "experience", "idea", "other"];

function validCategories(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(CATEGORY_KEYS) &&
    Object.values(value).every((count) => Number.isSafeInteger(count) && count >= 0)
  );
}

export function createPublishingIntent({
  branch,
  feedbackHead,
  headRefOid,
  runId,
  changedFile,
  feedbackCount,
  categoryCounts,
  createdAt = new Date().toISOString(),
}) {
  return validatePendingReview({
    schemaVersion: 2,
    phase: "publishing",
    pullRequest: null,
    url: null,
    baseRefName: "main",
    headRefName: branch,
    headRefOid,
    feedbackHead,
    runId,
    changedFile,
    feedbackCount,
    categoryCounts,
    createdAt,
  });
}

export function validatePendingReview(value) {
  const expectedKeys = [
    "baseRefName",
    "categoryCounts",
    "changedFile",
    "createdAt",
    "feedbackCount",
    "feedbackHead",
    "headRefName",
    "headRefOid",
    "phase",
    "pullRequest",
    "runId",
    "schemaVersion",
    "url",
  ].sort();
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)
  ) {
    throw new Error("Pending review state does not match the required shape");
  }
  if (
    value.schemaVersion !== 2 ||
    !["publishing", "review"].includes(value.phase) ||
    value.baseRefName !== "main" ||
    !BRANCH_PATTERN.test(value.headRefName) ||
    !SHA_PATTERN.test(value.headRefOid) ||
    !SHA_PATTERN.test(value.feedbackHead) ||
    !/^[0-9]{8}T[0-9]{6}-[0-9]+$/.test(value.runId) ||
    !ALLOWED_FILES.has(value.changedFile) ||
    !Number.isSafeInteger(value.feedbackCount) ||
    value.feedbackCount < 1 ||
    !validCategories(value.categoryCounts) ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new Error("Pending review state contains an invalid field");
  }
  if (value.phase === "publishing") {
    if (value.pullRequest !== null || value.url !== null) {
      throw new Error("Publishing intent cannot already contain a pull request");
    }
  } else if (
    !Number.isSafeInteger(value.pullRequest) ||
    value.pullRequest < 1 ||
    value.url !== `https://github.com/lreedm1/Stabilize/pull/${value.pullRequest}`
  ) {
    throw new Error("Review state has an invalid pull request identity");
  }
  return value;
}

export function validatePullRequestIdentity(pending, pullRequest) {
  validatePendingReview(pending);
  if (
    !pullRequest ||
    pullRequest.baseRefName !== pending.baseRefName ||
    pullRequest.headRefName !== pending.headRefName ||
    pullRequest.headRefOid !== pending.headRefOid
  ) {
    throw new Error("Pull request identity does not match the persisted publishing intent");
  }
  if (
    pending.phase === "review" &&
    (pullRequest.number !== pending.pullRequest || pullRequest.url !== pending.url)
  ) {
    throw new Error("Pull request number or URL changed unexpectedly");
  }
  return pullRequest;
}

export function completePublishingIntent(intent, pullRequest) {
  validatePullRequestIdentity(intent, pullRequest);
  if (!Number.isSafeInteger(pullRequest.number) || pullRequest.number < 1) {
    throw new Error("Created pull request has an invalid number");
  }
  if (pullRequest.url !== `https://github.com/lreedm1/Stabilize/pull/${pullRequest.number}`) {
    throw new Error("Created pull request has an unexpected URL");
  }
  return validatePendingReview({
    ...intent,
    phase: "review",
    pullRequest: pullRequest.number,
    url: pullRequest.url,
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const {
  commitFeedback,
  createFeedbackRecord,
  feedbackConfigured,
  feedbackFilePath,
  normalizeFeedback,
} = await import("../src/feedback.js");

const configuredEnv = {
  GITHUB_FEEDBACK_TOKEN: "github_pat_1234567890abcdefghijklmnop",
  FEEDBACK_REPOSITORY: "lreedm1/Stabilize",
  FEEDBACK_BRANCH: "feedback-inbox",
  FEEDBACK_PATH: "feedback",
};

test("feedback configuration requires a scoped-looking GitHub token", () => {
  assert.equal(feedbackConfigured(configuredEnv), true);
  assert.equal(feedbackConfigured({ ...configuredEnv, GITHUB_FEEDBACK_TOKEN: "" }), false);
  assert.equal(feedbackConfigured({ ...configuredEnv, FEEDBACK_REPOSITORY: "invalid" }), false);
});

test("feedback is normalized without collecting identity fields", () => {
  const feedback = normalizeFeedback({
    category: "bug",
    message: "  The menu freezes\u0000 after I submit feedback.  ",
  });
  assert.deepEqual(feedback, {
    category: "bug",
    categoryLabel: "Bug",
    message: "The menu freezes after I submit feedback.",
  });

  const record = createFeedbackRecord(
    feedback,
    new Date("2026-08-02T21:00:00.000Z"),
    "123e4567-e89b-12d3-a456-426614174000",
  );
  assert.equal(record.signedIn, true);
  assert.equal(record.accountKey, undefined);
  assert.equal(record.email, undefined);
  assert.equal(record.ip, undefined);
  assert.equal(record.userAgent, undefined);
  assert.equal(
    feedbackFilePath(record),
    "feedback/2026/08/02/2026-08-02T21-00-00Z-123e4567-e89b-12d3-a456-426614174000.json",
  );
});

test("feedback commits one JSON file to the isolated inbox branch", async () => {
  const record = createFeedbackRecord(
    normalizeFeedback({ category: "idea", message: "Add a clearer model comparison." }),
    new Date("2026-08-02T21:00:00.000Z"),
    "123e4567-e89b-12d3-a456-426614174000",
  );
  let captured;
  const result = await commitFeedback(configuredEnv, record, async (url, init) => {
    captured = { url, init };
    return Response.json({ commit: { sha: "a".repeat(40) } }, { status: 201 });
  });

  assert.match(captured.url, /api\.github\.com\/repos\/lreedm1\/Stabilize\/contents\/feedback\//);
  assert.equal(captured.init.method, "PUT");
  assert.equal(captured.init.headers.Authorization, `Bearer ${configuredEnv.GITHUB_FEEDBACK_TOKEN}`);
  assert.equal(captured.init.headers["X-GitHub-Api-Version"], "2026-03-10");

  const body = JSON.parse(captured.init.body);
  assert.equal(body.branch, "feedback-inbox");
  const committed = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
  assert.deepEqual(committed, record);
  assert.equal(result.commitSha, "a".repeat(40));
  assert.equal(result.path, feedbackFilePath(record));
});

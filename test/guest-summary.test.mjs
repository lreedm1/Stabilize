import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("guest chats retain eight recent messages plus a 5,000-token rolling summary", async () => {
  const [packageSource, clientSource, workerSource, copySource, privacy, publicPrivacy, readme, generator] =
    await Promise.all([
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../public/app.js", import.meta.url), "utf8"),
      readFile(new URL("../src/index.js", import.meta.url), "utf8"),
      readFile(new URL("../src/copy.js", import.meta.url), "utf8"),
      readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
      readFile(new URL("../public/privacy.html", import.meta.url), "utf8"),
      readFile(new URL("../README.md", import.meta.url), "utf8"),
      readFile(new URL("../scripts/add-guest-summary.mjs", import.meta.url), "utf8"),
    ]);

  assert.match(packageSource, /add-guest-summary\.mjs/);
  assert.match(clientSource, /MAX_GUEST_THREAD_MESSAGES = 8/);
  assert.match(clientSource, /MAX_GUEST_SUMMARY_CHARS = 30_000/);
  assert.match(clientSource, /MAX_GUEST_SUMMARY_BATCH_MESSAGES = 12/);
  assert.match(clientSource, /GUEST_THREAD_STORAGE_KEY = "stabilize:guest-thread:v2"/);
  assert.match(clientSource, /summaryMessages: guestSummaryMessages/);
  assert.match(clientSource, /guestSummaryUpdated/);
  assert.match(clientSource, /beginLocalThreadSnapshot/);
  assert.match(clientSource, /applyGuestSummaryResult/);
  assert.doesNotMatch(clientSource, /localStorage/);

  assert.match(workerSource, /MAX_GUEST_SUMMARY_OUTPUT_TOKENS = 5_000/);
  assert.match(workerSource, /max_output_tokens: MAX_GUEST_SUMMARY_OUTPUT_TOKENS/);
  assert.match(workerSource, /function guestModelInput/);
  assert.match(workerSource, /async function generateGuestSummary/);
  assert.match(workerSource, /guestSummaryPromise/);
  assert.match(workerSource, /guestSummaryFields/);
  assert.match(copySource, /guestSummaryPrompt/);
  assert.match(copySource, /at most 5,000 tokens/);

  for (const source of [privacy, publicPrivacy, readme]) {
    assert.match(source, /eight/i);
    assert.match(source, /5,000/);
    assert.match(source, /current (?:browser )?tab/i);
  }
  assert.match(generator, /MAX_GUEST_SUMMARY_OUTPUT_TOKENS = 5_000/);
});

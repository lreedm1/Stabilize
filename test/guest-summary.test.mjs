import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("guest chats retain the full current-tab conversation without compaction", async () => {
  const [
    packageSource,
    clientSource,
    workerSource,
    privacy,
    publicPrivacy,
    readme,
    finalizer,
  ] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
    readFile(new URL("../public/privacy.html", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/remember-full-guest-conversation.mjs", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(packageSource, /remember-full-guest-conversation\.mjs/);
  assert.equal(
    packageSource.includes("node scripts/add-guest-summary.mjs"),
    false,
  );

  assert.match(clientSource, /stabilize:guest-thread:v3/);
  assert.match(clientSource, /MAX_GUEST_THREAD_MESSAGE_CHARS = 4_000/);
  assert.match(clientSource, /MAX_CHAT_REQUEST_BYTES = 1_900_000/);
  assert.match(clientSource, /return normalizeGuestMessages\(messages\);/);
  assert.match(clientSource, /legacySummary: guestLegacySummary/);
  assert.doesNotMatch(clientSource, /MAX_GUEST_THREAD_MESSAGES = 8/);
  assert.doesNotMatch(clientSource, /messages\.shift\(\)/);
  assert.doesNotMatch(clientSource, /applyGuestSummaryResult/);
  assert.doesNotMatch(clientSource, /localStorage/);

  assert.match(workerSource, /MAX_BODY_BYTES = 2_000_000/);
  assert.match(workerSource, /function normalizeGuestConversation/);
  assert.match(workerSource, /function guestConversationInput/);
  assert.match(workerSource, /const guestSummaryPromise = null/);

  for (const source of [privacy, publicPrivacy, readme]) {
    assert.match(source, /full|complete/i);
    assert.match(source, /current (?:browser )?tab/i);
    assert.match(source, /not silently|does not silently/i);
  }
  assert.match(finalizer, /full guest conversation/i);
});

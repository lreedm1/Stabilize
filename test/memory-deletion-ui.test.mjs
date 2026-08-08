import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, client, worker, memory, copy, privacy, publicPrivacy, packageJson] =
  await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/session-memory.js", import.meta.url), "utf8"),
    readFile(new URL("../src/copy.js", import.meta.url), "utf8"),
    readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
    readFile(new URL("../public/privacy.html", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

test("signed-in users receive an explicit remembered-context deletion control", () => {
  assert.match(page, /id="delete-memory-button"/);
  assert.match(page, /id="delete-memory-status"/);
  assert.match(copy, /deleteMemoryButton: "Delete remembered context"/);
  assert.match(copy, /Billing and usage records are not affected/);
  assert.match(client, /fetch\("\/api\/account\/memory", \{/);
  assert.match(client, /method: "DELETE"/);
  assert.match(client, /window\.confirm\(copy\.deleteMemoryConfirm\)/);
  assert.match(client, /setMemoryDeleteStatus\(copy\.deleteMemorySuccess\)/);
});

test("deletion resets the visible chat and aborts an older browser request", () => {
  assert.match(client, /let activeChatController = null/);
  assert.match(client, /let conversationResetVersion = 0/);
  assert.match(client, /activeChatController\.abort\(\)/);
  assert.match(client, /signal: controller\.signal/);
  assert.match(client, /requestResetVersion !== conversationResetVersion/);
  assert.match(client, /resetConversationView\(\);\n    setPending\(false\);/);
});

test("the Worker exposes authenticated same-origin deletion with a generation fence", () => {
  assert.match(worker, /url\.pathname === "\/api\/account\/memory"/);
  assert.match(worker, /request\.method !== "DELETE"/);
  assert.match(worker, /sameOriginOrNonBrowser\(request\)/);
  assert.match(worker, /COPY\.api\.signInRequired/);
  assert.match(worker, /stub\.deleteRememberedContext\(\)/);
  assert.match(worker, /memory\.generation/);
  assert.match(worker, /snapshot\.generation/);

  assert.match(memory, /CREATE TABLE IF NOT EXISTS memory_generation/);
  assert.match(memory, /async deleteRememberedContext\(\)/);
  assert.match(memory, /await this\.ctx\.storage\.deleteAlarm\(\)/);
  assert.match(memory, /generation = memory_generation\.generation \+ 1/);
  assert.match(memory, /expectedGeneration/);
  assert.match(memory, /accepted: false/);
});

test("privacy copy matches the 1,000-character runtime and deletion boundary", () => {
  assert.match(privacy, /rolling summary of at most 1,000 characters/);
  assert.doesNotMatch(privacy, /1,600 characters/);
  assert.match(privacy, /non-content generation counter/);
  assert.match(privacy, /Billing and usage records are stored separately/);
  assert.match(publicPrivacy, /rolling summary of at most 1,000 characters/);
  assert.match(publicPrivacy, /Delete remembered[\s\S]*context/);
  assert.match(publicPrivacy, /does not delete subscription or usage records/);
});

test("the final materialization pass and regression suites include deletion", () => {
  const parsed = JSON.parse(packageJson);
  assert.match(
    parsed.scripts["apply:prompt-policy"],
    /scripts\/apply-memory-deletion\.mjs$/,
  );
  assert.match(parsed.scripts["test:node"], /memory-deletion-ui\.test\.mjs/);
  assert.match(
    parsed.scripts["test:worker"],
    /memory-deletion-worker\.test\.mjs/,
  );
});

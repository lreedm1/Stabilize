import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("memory deletion and guest tab continuity stay wired through the final pipeline", async () => {
  const [
    packageSource,
    generator,
    sessionMemory,
    workerSource,
    pageSource,
    clientScript,
    privacyMarkdown,
    privacyPage,
    seoStyles,
  ] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../scripts/add-memory-deletion-and-guest-session.mjs",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src/session-memory.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
    readFile(new URL("../public/privacy.html", import.meta.url), "utf8"),
    readFile(new URL("../public/seo.css", import.meta.url), "utf8"),
  ]);

  assert.match(packageSource, /add-memory-deletion-and-guest-session\.mjs/);
  assert.match(generator, /deleteRememberedContext/);
  assert.match(sessionMemory, /CREATE TABLE IF NOT EXISTS memory_control/);
  assert.match(sessionMemory, /readContextForRequest/);
  assert.match(sessionMemory, /expectedGeneration/);
  assert.match(sessionMemory, /deleteAlarm\(\)/);
  assert.match(workerSource, /\/api\/account\/memory/);
  assert.match(workerSource, /signedOut/);
  assert.match(pageSource, /data-signed-in/);
  assert.match(pageSource, /delete-memory-button/);
  assert.match(clientScript, /GUEST_THREAD_STORAGE_KEY/);
  assert.match(clientScript, /activeLocalThreadMessages/);
  assert.match(clientScript, /MAX_CHAT_REQUEST_BYTES/);
  assert.match(seoStyles, /Signed-in remembered-context controls/);
  assert.match(privacyMarkdown, /generation counter/i);
  assert.match(privacyPage, /Delete remembered context/);
  assert.doesNotMatch(privacyMarkdown, /1,600 characters/);
});

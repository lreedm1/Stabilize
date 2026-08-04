import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("signed-in memory controls are visible, bounded, and provider-honest", async () => {
  const [
    pageSource,
    memoryPage,
    memoryClient,
    memoryStyles,
    workerSource,
    memorySource,
    privacyPage,
  ] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/memory-page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/memory.js", import.meta.url), "utf8"),
    readFile(new URL("../public/memory.css", import.meta.url), "utf8"),
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/session-memory.js", import.meta.url), "utf8"),
    readFile(new URL("../public/privacy.html", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /const memoryMenuLink = signedIn/);
  assert.match(pageSource, /href="\/memory"/);
  assert.match(pageSource, /page\.chat\.memoryControlsLabel/);

  assert.match(memoryPage, /id="memory-enabled"/);
  assert.match(memoryPage, /id="memory-summary"[\s\S]*maxlength="1000"/);
  assert.match(memoryPage, /id="recent-memory-list"/);
  assert.match(memoryPage, /id="clear-recent-memory"/);
  assert.match(memoryPage, /id="delete-all-memory"/);
  assert.match(memoryPage, /Provider processing still applies/i);
  assert.match(memoryPage, /Guest chats do not enter Stabilize account memory/i);

  assert.match(memoryClient, /request\("\/api\/memory"/);
  assert.match(memoryClient, /method: "PATCH"/);
  assert.match(memoryClient, /method: "DELETE"/);
  assert.match(memoryClient, /\/api\/memory\/recent\/\$\{sequence\}/);
  assert.match(memoryClient, /window\.confirm/);
  assert.doesNotMatch(memoryClient, /localStorage|sessionStorage|innerHTML\s*=/);

  assert.match(memoryStyles, /\.memory-status-card/);
  assert.match(memoryStyles, /\.danger-zone/);
  assert.match(memoryStyles, /@media \(max-width: 640px\)/);

  assert.match(workerSource, /renderMemoryPage/);
  assert.match(workerSource, /async function handleMemoryRequest/);
  assert.match(workerSource, /url\.pathname === "\/api\/memory"/);
  assert.match(workerSource, /sameOriginOrNonBrowser\(request\)/);
  assert.match(workerSource, /await readMemoryEnabledForChat\(accountStub\)/);

  assert.match(memorySource, /CREATE TABLE IF NOT EXISTS memory_preferences/);
  assert.match(memorySource, /async readMemorySettings\(\)/);
  assert.match(memorySource, /async setMemoryEnabled\(enabled\)/);
  assert.match(memorySource, /async replaceMemorySummary\(summary\)/);
  assert.match(memorySource, /async deleteRecentMemory\(sequence\)/);
  assert.match(memorySource, /async clearRecentMemory\(\)/);
  assert.match(memorySource, /async deleteAllMemory\(\)/);
  assert.match(memorySource, /if \(!this\.memoryEnabledValue\(\)\) return emptyContext\(\)/);

  assert.match(privacyPage, /Memory controls/i);
  assert.match(privacyPage, /turn memory off/i);
  assert.match(privacyPage, /cannot recall.*provider/is);
});

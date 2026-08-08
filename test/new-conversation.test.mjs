import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("New conversation stays out of the hamburger menu while remaining functional", async () => {
  const [pageSource, clientSource, menuStyles, workerSource, memorySource] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/app.js", import.meta.url), "utf8"),
      readFile(new URL("../public/seo.css", import.meta.url), "utf8"),
      readFile(new URL("../src/index.js", import.meta.url), "utf8"),
      readFile(new URL("../src/session-memory.js", import.meta.url), "utf8"),
    ]);

  const menuStart = pageSource.indexOf('<div class="menu-panel">');
  const menuEnd = pageSource.indexOf(
    "\n            </div>\n          </details>",
    menuStart,
  );
  const proxyStart = pageSource.indexOf('<div class="chat-action-proxies"');
  const proxyEnd = pageSource.indexOf("\n      </div>", proxyStart);
  const buttonIndex = pageSource.indexOf('id="new-conversation-button"');
  const composerIndex = pageSource.indexOf('id="chat-form"');

  assert.ok(menuStart >= 0);
  assert.ok(menuEnd > menuStart);
  assert.doesNotMatch(
    pageSource.slice(menuStart, menuEnd),
    /new-conversation-button/,
  );

  assert.ok(proxyStart >= 0);
  assert.ok(proxyEnd > proxyStart);
  assert.ok(buttonIndex > proxyStart && buttonIndex < proxyEnd);
  assert.ok(buttonIndex < composerIndex);
  assert.match(
    pageSource.slice(proxyStart, proxyEnd),
    /class="chat-action-proxies" hidden aria-hidden="true"[\s\S]*id="new-conversation-button"[\s\S]*page\.chat\.newConversationButton/,
  );
  assert.doesNotMatch(
    pageSource.slice(pageSource.indexOf('<div class="composer-dock">')),
    /id="new-conversation-button"/,
  );

  assert.match(
    menuStyles,
    /\.new-conversation-button\s*{[\s\S]*width:\s*100%;[\s\S]*cursor:\s*pointer;/,
  );
  assert.match(
    clientSource,
    /newConversationButton\.addEventListener\("click"[\s\S]*startNewConversation\(\)/,
  );
  assert.match(clientSource, /fetch\("\/api\/conversation\/new"/);
  assert.match(clientSource, /clearPersistedAnswer\(\)/);
  assert.match(clientSource, /awaitingSafetyAnswer = false/);
  assert.match(clientSource, /awaitingSafetyAnswerSince = null/);
  assert.match(clientSource, /chatLog\.replaceChildren\(\)/);
  assert.match(clientSource, /conversationSurface\.dataset\.view = "compose"/);

  assert.match(workerSource, /url\.pathname === "\/api\/conversation\/new"/);
  assert.match(workerSource, /sameOriginOrNonBrowser\(request\)/);
  assert.match(workerSource, /stub\.startNewConversation\(\)/);
  assert.match(memorySource, /async startNewConversation\(\)/);
  assert.match(
    memorySource,
    /startNewConversation[\s\S]*DELETE FROM recent_messages[\s\S]*awaiting_safety_answer = 0/,
  );
  const newConversationStart = memorySource.indexOf(
    "async startNewConversation()",
  );
  const deleteMemoryStart = memorySource.indexOf(
    "async deleteRememberedContext()",
    newConversationStart,
  );
  const compactionStart = memorySource.indexOf(
    "async getCompactionSnapshot()",
    newConversationStart,
  );
  const newConversationEnd =
    deleteMemoryStart > newConversationStart
      ? deleteMemoryStart
      : compactionStart;
  const newConversationMethod = memorySource.slice(
    newConversationStart,
    newConversationEnd,
  );
  assert.doesNotMatch(newConversationMethod, /DELETE FROM memory_state/);
  assert.doesNotMatch(newConversationMethod, /summary\s*=/);
});

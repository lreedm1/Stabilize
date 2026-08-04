import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("New conversation is a visible menu action rather than a composer control", async () => {
  const [pageSource, clientSource, menuStyles, workerSource, memorySource] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/app.js", import.meta.url), "utf8"),
      readFile(new URL("../public/seo.css", import.meta.url), "utf8"),
      readFile(new URL("../src/index.js", import.meta.url), "utf8"),
      readFile(new URL("../src/session-memory.js", import.meta.url), "utf8"),
    ]);

  const menuStart = pageSource.indexOf('<div class="menu-panel">');
  const menuEnd = pageSource.indexOf("</details>", menuStart);
  const buttonIndex = pageSource.indexOf('id="new-conversation-button"');
  const composerIndex = pageSource.indexOf('id="chat-form"');

  assert.ok(menuStart >= 0);
  assert.ok(menuEnd > menuStart);
  assert.ok(buttonIndex > menuStart && buttonIndex < menuEnd);
  assert.ok(buttonIndex < composerIndex);
  assert.match(
    pageSource.slice(menuStart, menuEnd),
    /id="new-conversation-button"[\s\S]*page\.chat\.newConversationButton/,
  );
  assert.doesNotMatch(
    pageSource.slice(pageSource.indexOf('<div class="composer-dock">')),
    /new-conversation-button/,
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
  const newConversationMethod = memorySource.slice(
    memorySource.indexOf("async startNewConversation()"),
    memorySource.indexOf("async getCompactionSnapshot()"),
  );
  assert.doesNotMatch(newConversationMethod, /DELETE FROM memory_state/);
  assert.doesNotMatch(newConversationMethod, /summary\s*=/);
});

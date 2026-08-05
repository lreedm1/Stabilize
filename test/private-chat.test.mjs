import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("signed-in private chat stays out of the hamburger menu and disables memory end to end", async () => {
  const [pageSource, clientSource, menuStyles, workerSource, copySource, privacyPage] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/app.js", import.meta.url), "utf8"),
      readFile(new URL("../public/seo.css", import.meta.url), "utf8"),
      readFile(new URL("../src/index.js", import.meta.url), "utf8"),
      readFile(new URL("../src/copy.js", import.meta.url), "utf8"),
      readFile(new URL("../public/privacy.html", import.meta.url), "utf8"),
    ]);

  const menuStart = pageSource.indexOf('<div class="menu-panel">');
  const menuEnd = pageSource.indexOf(
    "\n            </div>\n          </details>",
    menuStart,
  );
  const proxyStart = pageSource.indexOf('<div class="chat-action-proxies"');
  const proxyEnd = pageSource.indexOf("\n      </div>", proxyStart);
  const composerStart = pageSource.indexOf('<div class="composer-dock">');

  assert.ok(menuStart >= 0 && menuEnd > menuStart);
  assert.doesNotMatch(
    pageSource.slice(menuStart, menuEnd),
    /\$\{privateChatControl\}|id="private-chat-button"/,
  );

  assert.ok(proxyStart >= 0 && proxyEnd > proxyStart);
  assert.match(
    pageSource.slice(proxyStart, proxyEnd),
    /class="chat-action-proxies" hidden aria-hidden="true"[\s\S]*\$\{privateChatControl\}/,
  );
  assert.match(pageSource, /const privateChatControl = signedIn/);
  assert.match(pageSource, /id="private-chat-button"/);
  assert.doesNotMatch(
    pageSource.slice(composerStart),
    /id="private-chat-button"/,
  );
  assert.match(pageSource, /id="private-chat-status"[\s\S]*hidden/);
  assert.match(pageSource, /app\.js\?v=20260804-private-chat-1/);

  assert.match(clientSource, /PRIVATE_CHAT_STORAGE_KEY/);
  assert.match(clientSource, /function togglePrivateChat\(\)/);
  assert.match(clientSource, /sessionStorage\.setItem\(PRIVATE_CHAT_STORAGE_KEY/);
  assert.match(clientSource, /privateChatButton\.setAttribute\("aria-pressed"/);
  assert.match(clientSource, /privateChatStatus\.hidden = !active/);
  assert.match(clientSource, /let privateThreadMessages = \[\]/);
  assert.match(clientSource, /function appendPrivateThreadMessage\(/);
  assert.match(clientSource, /appendPrivateThreadMessage\("user", clean\)/);
  assert.match(
    clientSource,
    /appendPrivateThreadMessage\("assistant", cleanReply\)/,
  );
  assert.match(
    clientSource,
    /messages:\s*privateChat \? privateThreadMessages : undefined/,
  );
  assert.match(clientSource, /rollbackPrivateUser\(clean\)/);
  assert.match(
    clientSource,
    /body:\s*JSON\.stringify\(\{[\s\S]*message:\s*clean,[\s\S]*privateChat/,
  );
  assert.match(
    clientSource,
    /body:\s*JSON\.stringify\(\{ privateChat \}\)/,
  );
  assert.match(clientSource, /record\.privateChat !== privateChat/);
  assert.match(clientSource, /clearPrivateChatPreference\(\)/);

  assert.match(
    workerSource,
    /const privateChat = body\?\.privateChat === true;/,
  );
  assert.match(
    workerSource,
    /const stub = privateChat \? null : accountMemoryStub\(env, accountKey\);/,
  );
  assert.match(workerSource, /function privateModelInput\(/);
  assert.match(
    workerSource,
    /privateChat[\s\S]*privateModelInput\(body\?\.messages, latestText\)/,
  );
  assert.match(
    workerSource,
    /handleNewConversation[\s\S]*if \(body\?\.privateChat !== true\)[\s\S]*stub\.startNewConversation\(\)/,
  );

  assert.match(
    menuStyles,
    /\.private-chat-button\[aria-pressed="true"\][\s\S]*background:\s*var\(--accent-dark\)/,
  );
  assert.match(
    menuStyles,
    /\.private-chat-status\s*{[\s\S]*border-radius:\s*999px/,
  );
  assert.match(copySource, /Does not use or update your Stabilize memory/);
  assert.match(copySource, /Provider processing is unchanged/);
  assert.match(privacyPage, /Private chat/i);
  assert.match(privacyPage, /does not use or update.*Stabilize memory/is);
  assert.match(privacyPage, /OpenAI.*still applies/is);
});

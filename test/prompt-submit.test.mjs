import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("starter prompt buttons call the model with a cache-busted client", async () => {
  const [pageSource, clientSource] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /src="\/app\.js\?v=[^"]+"/);
  assert.match(
    clientSource,
    /button\.addEventListener\("click", \(\) => \{[\s\S]*?void sendMessage\(button\.dataset\.exampleMessage \|\| ""\);[\s\S]*?\}\);/,
  );
  assert.doesNotMatch(
    clientSource,
    /input\.value = button\.dataset\.exampleMessage/,
  );
});

test("signed-out users get a one-time memory reminder on their second send", async () => {
  const [wrapperSource, reminderSource, routerSource] = await Promise.all([
    readFile(new URL("../src/memory-prompt-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../public/guest-memory-prompt.js", import.meta.url), "utf8"),
    readFile(new URL("../src/domain-router.js", import.meta.url), "utf8"),
  ]);

  assert.match(routerSource, /from "\.\/memory-prompt-worker\.js"/);
  assert.match(wrapperSource, /readAuthSession\(request, env\)/);
  assert.match(
    wrapperSource,
    /if \(!authSession && googleAuthConfigured\(env\)\) \{/,
  );
  assert.match(wrapperSource, /Stabilize only remembers chat context between visits when you sign in/);
  assert.match(wrapperSource, /href="\/auth\/google"/);
  assert.match(wrapperSource, /aria-modal="false"/);

  assert.match(reminderSource, /form\.addEventListener\("submit"/);
  assert.match(reminderSource, /const count = readSessionNumber\(MESSAGE_COUNT_KEY\) \+ 1/);
  assert.match(reminderSource, /if \(count === 2\) showPrompt\(\)/);
  assert.match(reminderSource, /sessionStorage\.setItem/);
  assert.match(reminderSource, /PROMPT_SHOWN_KEY/);
});


test("the prompt limit is 4,000 characters", async () => {
  const [pageSource, workerSource, copySource] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/copy.js", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /id="message-input"[\s\S]*maxlength="4000"/);
  assert.match(workerSource, /const MAX_MESSAGE_CHARS = 4_000/);
  assert.match(workerSource, /latestText.length > MAX_MESSAGE_CHARS/);
  assert.match(copySource, /Please keep your message to 4,000 characters or fewer/);
  assert.doesNotMatch(workerSource, /MAX_MODEL_OUTPUT_TOKENS/);
  assert.match(copySource, /Keep ordinary responses to 220 words or fewer/);
  assert.match(copySource, /For requested document-ready content, use the length needed/);
});

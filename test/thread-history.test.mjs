import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the current conversation keeps prior user and assistant turns visible", async () => {
  const [clientScript, productStyles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/product.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientScript, /chatLog\.setAttribute\("aria-atomic", "false"\)/);
  assert.match(clientScript, /function appendUserOutput\(content\)/);
  assert.match(clientScript, /article\.className = "user-output"/);
  assert.match(clientScript, /chatLog\.appendChild\(article\)/);
  assert.match(clientScript, /let activeAssistantOutput = null/);
  assert.match(
    clientScript,
    /view !== "thinking" && activeAssistantOutput instanceof HTMLElement/,
  );
  assert.match(
    clientScript,
    /if \(view === "compose"\) chatLog\.replaceChildren\(\)/,
  );
  assert.match(
    clientScript,
    /appendUserOutput\(visibleUserText\);[\s\S]*showOutput\(pendingReplyCopy\(\), "thinking-output", "thinking"\)/,
  );
  assert.match(clientScript, /nextVisibleUserText = label/);
  assert.match(clientScript, /chatLog\.scrollTop = chatLog\.scrollHeight/);

  assert.match(
    productStyles,
    /\.chat-log\s*{[\s\S]*flex-direction:\s*column;[\s\S]*justify-content:\s*flex-start;/,
  );
  assert.match(
    productStyles,
    /\.assistant-output\s*{[\s\S]*align-self:\s*flex-start;[\s\S]*margin:\s*0;/,
  );
  assert.match(
    productStyles,
    /\.user-output\s*{[\s\S]*max-width:\s*min\(52ch,\s*88%\);[\s\S]*align-self:\s*flex-end;/,
  );
});

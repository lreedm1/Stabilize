import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the output panel stays above a fixed bottom composer", async () => {
  const [clientScript, styles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(clientScript, /quickActions|data-prompt|showComposer/);
  assert.doesNotMatch(
    styles,
    /data-view="(?:thinking|response)"[^{}]*\.chat-form[^{]*\{[^}]*display:\s*none/,
  );
  assert.match(
    styles,
    /\.conversation-surface\s*{[\s\S]*display:\s*grid;[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/,
  );
  assert.match(styles, /textarea\s*{[\s\S]*border:\s*1px solid/);
  assert.match(styles, /textarea\s*{[\s\S]*height:\s*76px;[\s\S]*resize:\s*none;/);
  assert.doesNotMatch(
    styles,
    /data-view="compose"[^}]*chat-log[^{]*\{[^}]*display:\s*none/,
  );
  assert.doesNotMatch(clientScript, /introDismissed|followupPlaceholder/);
  assert.doesNotMatch(clientScript, /reset-button|resetChat/);
});

test("thinking is replaced with the latest Markdown reply", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(clientScript, /import \{ renderMarkdown \} from "\.\/markdown\.js"/);
  assert.match(clientScript, /function showOutput[\s\S]*chatLog\.replaceChildren\(\)/);
  assert.match(clientScript, /showOutput\(copy\.thinking, "thinking-output", "thinking"\)/);
  assert.match(clientScript, /article\.appendChild\(renderMarkdown\(content\)\)/);
  assert.match(clientScript, /JSON\.stringify\(\{ message: clean, awaitingSafetyAnswer \}\)/);
  assert.doesNotMatch(clientScript, /addMessage|user-message|messages\.push/);
  assert.doesNotMatch(clientScript, /innerHTML\s*=/);
});

test("the memory control clears the server session", async () => {
  const [clientScript, styles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    clientScript,
    /fetch\("\/api\/session", \{ method: "DELETE" \}\)/,
  );
  assert.match(clientScript, /awaitingSafetyAnswer = false/);
  assert.match(styles, /\.forget-memory-button\s*{[\s\S]*grid-column:\s*1 \/ -1/);
});

test("Lexend is self-hosted and message bubbles are removed", async () => {
  const [styles, font, license] = await Promise.all([
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../public/fonts/lexend-latin-wght-normal.woff2",
        import.meta.url,
      ),
    ),
    readFile(new URL("../public/fonts/OFL.txt", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /@font-face[\s\S]*font-family:\s*"Lexend"/);
  assert.match(styles, /font-family:\s*"Lexend", ui-sans-serif/);
  assert.match(styles, /\.assistant-output\s*{[\s\S]*max-width:\s*none;/);
  assert.doesNotMatch(styles, /\.assistant-message|\.user-message/);
  assert.equal(font.subarray(0, 4).toString("ascii"), "wOF2");
  assert.ok(font.byteLength > 30_000);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(license, /Lexend Project Authors/);
});

test("layout fills the dynamic viewport without a fixed-width shell", async () => {
  const styles = await readFile(
    new URL("../public/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /\.page-shell\s*{[\s\S]*?width:\s*100%;/);
  assert.match(styles, /\.page-shell\s*{[\s\S]*?height:\s*100dvh;/);
  assert.match(styles, /\.page-shell\s*{[\s\S]*?min-height:\s*100dvh;/);
  assert.match(styles, /\.page-shell\s*{[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.chat-card\s*{[\s\S]*?flex:\s*1 1 auto;/);
  assert.match(styles, /\.chat-card\s*{[\s\S]*?overflow:\s*hidden;/);
  assert.doesNotMatch(styles, /width:\s*min\(760px/);
});

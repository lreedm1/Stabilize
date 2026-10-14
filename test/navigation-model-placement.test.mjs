import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
test("live homepage is lean, and information pages retain chat", async () => {
  const [page, worker, router, css, client] = await Promise.all([
    read("src/simple-page.js"), read("src/paid-worker.js"),
    read("src/domain-router.js"), read("public/persistent-chat.css"),
    read("public/reasoning-choice.js"),
  ]);
  assert.match(page, /href="#learn-more"/);
  assert.match(page, /id="learn-more"/);
  assert.match(page, /class="menu-panel"/);
  assert.match(page, /id="chat-form"/);
  assert.doesNotMatch(page, /name="model"/);
  assert.match(worker, /const composerModelPicker = ""/);
  assert.match(router, /withPersistentChat/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(client, /reasoningEffort = "medium"/);
});

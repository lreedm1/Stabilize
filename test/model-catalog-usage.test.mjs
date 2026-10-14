import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
test("Think is the only chat reasoning mode", async () => {
  const [index, page, choice, billing] = await Promise.all([
    read("src/index.js"), read("src/simple-page.js"),
    read("public/reasoning-choice.js"), read("src/paid-worker.js"),
  ]);
  assert.match(index, /return effectiveReasoningEffort\(String\(model \|\| ""\), "medium"\)/);
  assert.match(index, /Ignore historical client preferences/);
  assert.match(choice, /reasoningEffort = "medium"/);
  assert.doesNotMatch(choice, /REASONING_OPTIONS|createElement\("select"\)/);
  assert.match(billing, /body\.reasoningEffort = "medium"/);
  assert.match(billing, /const composerModelPicker = ""/);
  assert.match(page, /reasoning-choice\.js\?v=20261014-think-only/);
});

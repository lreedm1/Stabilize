import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("outcome actions are specific and always submit to the model", async () => {
  const [clientScript, pageSource, productStyles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/product.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /What would help next\?/);
  assert.match(pageSource, /Make it smaller/);
  assert.match(pageSource, /Another option/);
  assert.match(pageSource, /Help me start now/);
  assert.doesNotMatch(pageSource, /outcomeYes:|outcomeNo:/);
  assert.match(
    clientScript,
    /function appendOutcomeCheck\(article, previousReply\)/,
  );
  assert.match(clientScript, /for \(const action of configuredActions\)/);
  assert.match(
    clientScript,
    /void sendMessage\(buildOutcomeActionPrompt\(prompt, previousReply\)\)/,
  );
  assert.match(clientScript, /Use this previous answer as context/);
  assert.doesNotMatch(clientScript, /input\.value = productCopy\.outcome/);
  assert.match(productStyles, /\.outcome-actions[\s\S]*display: grid/);
  assert.match(pageSource, /app\.js\?v=20260802-model-action-buttons-1/);
});

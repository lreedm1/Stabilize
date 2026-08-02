import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Not yet sends the smaller prompt immediately", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(
    clientScript,
    /noButton\.addEventListener\("click"[\s\S]{0,180}void sendMessage\(productCopy\.outcomeFollowUp\)/,
  );
  assert.doesNotMatch(clientScript, /input\.value = productCopy\.outcomeFollowUp/);
  assert.doesNotMatch(clientScript, /finish\(productCopy\.outcomeNoMessage\)/);
});

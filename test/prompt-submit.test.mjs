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

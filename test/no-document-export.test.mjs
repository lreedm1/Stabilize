import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const removedAssets = [
  "../public/document-export-ui.js",
  "../public/document-export.js",
  "../public/document-export.css",
];

test("document export is absent from the product", async () => {
  const pageSource = await readFile(
    new URL("../src/page.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(pageSource, /document-export/i);
  assert.doesNotMatch(pageSource, /Export this response/i);

  for (const path of removedAssets) {
    await assert.rejects(access(new URL(path, import.meta.url)), {
      code: "ENOENT",
    });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = async (path) =>
  Buffer.from(
    (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).trim(),
    "base64",
  );

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test("favicon source payloads decode to real ICO and PNG files", async () => {
  const [ico, png, apple] = await Promise.all([
    readSource("scripts/favicon-assets/favicon.ico.b64"),
    readSource("scripts/favicon-assets/favicon-32x32.png.b64"),
    readSource("scripts/favicon-assets/apple-touch-icon.png.b64"),
  ]);

  assert.deepEqual(ico.subarray(0, 4), Buffer.from([0, 0, 1, 0]));
  assert.equal(ico.readUInt16LE(4), 4);
  assert.ok(ico.byteLength > 1_000);

  for (const image of [png, apple]) {
    assert.deepEqual(image.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
    assert.ok(image.byteLength > 250);
  }
});

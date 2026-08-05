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

test("favicon source payloads decode to real ICO and exact-size PNG files", async () => {
  const [ico, png16, png32, apple] = await Promise.all([
    readSource("scripts/favicon-assets/favicon.ico.b64"),
    readSource("scripts/favicon-assets/favicon-16x16.png.b64"),
    readSource("scripts/favicon-assets/favicon-32x32.png.b64"),
    readSource("scripts/favicon-assets/apple-touch-icon.png.b64"),
  ]);

  assert.deepEqual(ico.subarray(0, 4), Buffer.from([0, 0, 1, 0]));
  assert.equal(ico.readUInt16LE(4), 4);
  assert.ok(ico.byteLength > 1_000);

  for (const image of [png16, png32, apple]) {
    assert.deepEqual(image.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
  }
  assert.equal(png16.readUInt32BE(16), 16);
  assert.equal(png16.readUInt32BE(20), 16);
  assert.equal(png32.readUInt32BE(16), 32);
  assert.equal(png32.readUInt32BE(20), 32);
  assert.equal(apple.readUInt32BE(16), 180);
  assert.equal(apple.readUInt32BE(20), 180);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function webpInfo(buffer) {
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(buffer.subarray(8, 12).toString("ascii"), "WEBP");

  const chunks = [];
  let width;
  let height;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    chunks.push(type);

    if (type === "VP8X" && data + 10 <= buffer.length) {
      width = 1 + buffer.readUIntLE(data + 4, 3);
      height = 1 + buffer.readUIntLE(data + 7, 3);
    } else if (
      type === "VP8 " &&
      data + 10 <= buffer.length &&
      buffer[data + 3] === 0x9d &&
      buffer[data + 4] === 0x01 &&
      buffer[data + 5] === 0x2a
    ) {
      width ??= buffer.readUInt16LE(data + 6) & 0x3fff;
      height ??= buffer.readUInt16LE(data + 8) & 0x3fff;
    } else if (
      type === "VP8L" &&
      data + 5 <= buffer.length &&
      buffer[data] === 0x2f
    ) {
      const bits = buffer.readUInt32LE(data + 1);
      width ??= 1 + (bits & 0x3fff);
      height ??= 1 + ((bits >>> 14) & 0x3fff);
    }

    offset = data + size + (size % 2);
  }

  assert.ok(width && height, "WebP dimensions should be readable");
  return { width, height, chunks };
}

test("mobile uses one high-resolution static generated WebP", async () => {
  const [pageSource, mobileQuality, mobileStyles, image, encodedSource] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../public/scenes/mobile-golden-alpine-v2.webp",
          import.meta.url,
        ),
      ),
      readFile(
        new URL(
          "../public/scenes/mobile-golden-alpine-v2.b64",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  const imageInfo = webpInfo(image);
  assert.deepEqual(
    { width: imageInfo.width, height: imageInfo.height },
    { width: 853, height: 1844 },
  );
  assert.ok(image.byteLength > 100_000);
  assert.ok(image.byteLength < 5_000_000);
  assert.equal(imageInfo.chunks.includes("ANIM"), false);
  assert.ok(encodedSource.trim().startsWith("UklG"));

  assert.match(
    pageSource,
    /mobile-golden-alpine-v2\.webp\?v=20260803-13 853w/,
  );
  assert.match(
    pageSource,
    /rel="preload"[\s\S]*mobile-golden-alpine-v2\.webp\?v=20260803-13/,
  );
  assert.match(pageSource, /mobile-woodland-loop\.css\?v=20260803-13/);
  assert.doesNotMatch(pageSource, /mobile-woodland-spring-loop/);

  assert.match(mobileStyles, /opacity:\s*1/);
  assert.match(mobileStyles, /object-fit:\s*cover/);
  assert.match(mobileStyles, /animation:\s*none/);
  assert.doesNotMatch(mobileStyles, /@keyframes/);
  assert.doesNotMatch(mobileStyles, /mobile-golden-alpine\.avif/);

  assert.match(mobileQuality, /max-width: 980px/);
  assert.match(mobileQuality, /orientation: portrait/);
  assert.doesNotMatch(mobileQuality, /createElement\("video"\)/);
  assert.doesNotMatch(mobileQuality, /new Blob/);
  assert.doesNotMatch(mobileQuality, /mobile-creek-video/);
});

test("restored tabs recover from interrupted blank thinking views", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(clientScript, /function restoreComposeView\(\)/);
  assert.match(clientScript, /window\.addEventListener\("pageshow"/);
  assert.match(clientScript, /event\.persisted && view === "thinking"/);
  assert.match(clientScript, /conversationSurface\.dataset\.view = "compose"/);
  assert.match(clientScript, /chatLog\.hidden = true/);
  assert.match(clientScript, /lastSubmittedText/);
});

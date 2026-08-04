import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function webpInfo(buffer) {
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(buffer.subarray(8, 12).toString("ascii"), "WEBP");
  assert.equal(
    buffer.readUInt32LE(4) + 8,
    buffer.byteLength,
    "RIFF length should match the complete file",
  );

  const chunks = [];
  let width;
  let height;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    const nextOffset = data + size + (size % 2);
    assert.ok(nextOffset <= buffer.length, `WebP chunk ${type} is complete`);
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

    offset = nextOffset;
  }

  assert.ok(width && height, "WebP dimensions should be readable");
  return { width, height, chunks };
}

test("mobile uses a direct looping woodland WebP with a still fallback", async () => {
  const [pageSource, mobileQuality, loopStyles, loop, still] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../public/scenes/mobile-woodland-spring-loop.webp",
          import.meta.url,
        ),
      ),
      readFile(
        new URL(
          "../public/scenes/mobile-woodland-spring-still.webp",
          import.meta.url,
        ),
      ),
    ]);

  const loopInfo = webpInfo(loop);
  const stillInfo = webpInfo(still);

  assert.deepEqual(
    { width: loopInfo.width, height: loopInfo.height },
    { width: 540, height: 960 },
  );
  assert.deepEqual(
    { width: stillInfo.width, height: stillInfo.height },
    { width: 540, height: 960 },
  );
  assert.ok(loop.byteLength > 300_000);
  assert.ok(loop.byteLength < 5_000_000);
  assert.ok(still.byteLength > 50_000);
  assert.ok(still.byteLength < loop.byteLength);
  assert.ok(loopInfo.chunks.includes("ANIM"));
  assert.ok(loopInfo.chunks.filter((chunk) => chunk === "ANMF").length >= 8);
  assert.equal(stillInfo.chunks.includes("ANIM"), false);

  assert.match(
    pageSource,
    /mobile-woodland-spring-loop\.webp\?v=20260802-9 540w/,
  );
  assert.match(
    pageSource,
    /rel="preload"[\s\S]*mobile-woodland-spring-loop\.webp\?v=20260802-9/,
  );
  assert.match(pageSource, /mobile-woodland-loop\.css\?v=20260802-9/);
  assert.doesNotMatch(pageSource, /mobile-golden-alpine-v3/);

  assert.match(
    loopStyles,
    /mobile-woodland-spring-still\.webp\?v=20260802-9/,
  );
  assert.match(loopStyles, /animation:\s*none\s*!important/);
  assert.match(loopStyles, /transform:\s*none\s*!important/);
  assert.doesNotMatch(loopStyles, /@keyframes/);

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

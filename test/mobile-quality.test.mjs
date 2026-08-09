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

test("portrait mobile draws water through a canvas without media autoplay", async () => {
  const [pageSource, mobileStyles, clientSource, poster, sprite] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-motion-canvas.js", import.meta.url), "utf8"),
      readFile(new URL("../public/scenes/mobile-forest-stream-v14-retina-2160.webp", import.meta.url)),
      readFile(new URL("../public/scenes/mobile-forest-stream-water-sprite-v19-hd-1080.webp", import.meta.url)),
    ]);

  const posterInfo = webpInfo(poster);
  const spriteInfo = webpInfo(sprite);
  assert.deepEqual(
    { width: posterInfo.width, height: posterInfo.height },
    { width: 2160, height: 3840 },
  );
  assert.equal(posterInfo.chunks.includes("ANIM"), false);
  assert.deepEqual(
    { width: spriteInfo.width, height: spriteInfo.height },
    { width: 2400, height: 6000 },
  );
  assert.equal(spriteInfo.chunks.includes("ALPH"), true);
  assert.equal(spriteInfo.chunks.includes("ANIM"), false);
  assert.ok(sprite.byteLength > 1_000_000);
  assert.ok(sprite.byteLength < 12_000_000);

  assert.equal(
    [...pageSource.matchAll(/mobile-forest-stream-v14-retina-2160\.webp 2160w/g)].length,
    2,
  );
  assert.ok(pageSource.includes('href="/scenes/mobile-forest-stream-water-sprite-v19-hd-1080.webp"'));
  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /mobile-motion-canvas\.js\?v=20260809-mobile-motion-canvas-v19-hd-2/);
  assert.doesNotMatch(pageSource, /id="mobile-background-video"/);
  assert.doesNotMatch(pageSource, /mobile-quality\.js/);
  assert.match(mobileStyles, /mobile-motion-canvas-v18-start/);
  assert.match(mobileStyles, /\.mobile-motion-canvas\.is-ready/);

  assert.match(clientSource, /const COMPOSITION_WIDTH = 1080/);
  assert.match(clientSource, /const COMPOSITION_HEIGHT = 1920/);
  assert.match(clientSource, /const FRAME_LEFT = 680/);
  assert.match(clientSource, /const FRAME_TOP = 720/);
  assert.match(clientSource, /const FRAME_WIDTH = 400/);
  assert.match(clientSource, /const FRAME_HEIGHT = 1200/);
  assert.match(clientSource, /const FRAME_RATE = 6/);
  assert.match(clientSource, /context = canvas\.getContext\("2d"/);
  assert.match(clientSource, /ctx\.drawImage\(/);
  assert.match(clientSource, /setTimeout\(step/);
  assert.doesNotMatch(clientSource, /\.play\(/);
  assert.doesNotMatch(clientSource, /HTMLVideoElement/);
  assert.match(clientSource, /style\.setProperty\("opacity", "1", "important"\)/);
  assert.match(clientSource, /function showCanvas\(\)/);
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

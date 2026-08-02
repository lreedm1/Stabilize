import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function webpDimensions(buffer) {
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(buffer.subarray(8, 12).toString("ascii"), "WEBP");

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;

    if (type === "VP8X" && data + 10 <= buffer.length) {
      return {
        width: 1 + buffer.readUIntLE(data + 4, 3),
        height: 1 + buffer.readUIntLE(data + 7, 3),
      };
    }

    if (
      type === "VP8 " &&
      data + 10 <= buffer.length &&
      buffer[data + 3] === 0x9d &&
      buffer[data + 4] === 0x01 &&
      buffer[data + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff,
      };
    }

    if (type === "VP8L" && data + 5 <= buffer.length && buffer[data] === 0x2f) {
      const bits = buffer.readUInt32LE(data + 1);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }

    offset = data + size + (size % 2);
  }

  throw new Error("No supported WebP image chunk found");
}

test("mobile loads high-resolution photography and a portrait animation", async () => {
  const [
    pageSource,
    mobileQuality,
    animationModule,
    tuningStyles,
    small,
    medium,
    large,
  ] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-creek-gif.js", import.meta.url), "utf8"),
    readFile(new URL("../public/photo-tuning.css", import.meta.url), "utf8"),
    readFile(
      new URL("../public/scenes/mobile-sunlit-green-path-v4-1440.webp", import.meta.url),
    ),
    readFile(
      new URL("../public/scenes/mobile-sunlit-green-path-v4-2160.webp", import.meta.url),
    ),
    readFile(
      new URL("../public/scenes/mobile-sunlit-green-path-v4-2880.webp", import.meta.url),
    ),
  ]);

  assert.deepEqual(webpDimensions(small), { width: 1440, height: 2560 });
  assert.deepEqual(webpDimensions(medium), { width: 2160, height: 3840 });
  assert.deepEqual(webpDimensions(large), { width: 2880, height: 5120 });
  for (const image of [small, medium, large]) {
    assert.ok(image.byteLength > 250_000);
    assert.ok(image.byteLength < 5_000_000);
  }

  assert.match(pageSource, /mobile-sunlit-green-path-v4-1440\.webp 1440w/);
  assert.match(pageSource, /mobile-sunlit-green-path-v4-2160\.webp 2160w/);
  assert.match(pageSource, /mobile-sunlit-green-path-v4-2880\.webp 2880w/);
  assert.match(
    pageSource,
    /rel="preload"[\s\S]*as="image"[\s\S]*mobile-sunlit-green-path-v4-2160\.webp/,
  );

  const mobileQualityTag = '<script src="/mobile-quality.js"></script>';
  const appModuleTag = pageSource.match(
    /<script type="module" src="\/app\.js(?:\?v=[^"]+)?"><\/script>/,
  )?.[0];
  assert.ok(appModuleTag);
  assert.ok(
    pageSource.indexOf(mobileQualityTag) < pageSource.indexOf(appModuleTag),
  );

  assert.match(mobileQuality, /max-width: 980px/);
  assert.match(mobileQuality, /orientation: portrait/);
  assert.match(mobileQuality, /prefers-reduced-motion: reduce/);
  assert.match(mobileQuality, /mobile-creek-gif\.js/);
  assert.match(mobileQuality, /#photo-background/);
  assert.match(mobileQuality, /\.remove\(\)/);
  assert.match(animationModule, /data:image\/webp;base64,UklGR/);
  assert.doesNotMatch(animationModule, /data:image\/gif/);
  assert.doesNotMatch(tuningStyles, /translateZ/);
  assert.match(
    tuningStyles,
    /@media \(max-width: 980px\) and \(orientation: portrait\)[\s\S]*\.photo-background\s*{[\s\S]*display:\s*none;/,
  );
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

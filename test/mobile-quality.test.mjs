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

test("mobile uses responsive high-DPI static generated WebPs", async () => {
  const tiers = [
    { filename: "mobile-golden-alpine-v3-720.webp", width: 720, height: 1556 },
    { filename: "mobile-golden-alpine-v3-1080.webp", width: 1080, height: 2334 },
    { filename: "mobile-golden-alpine-v3-1440.webp", width: 1440, height: 3112 },
    { filename: "mobile-golden-alpine-v3-2160.webp", width: 2160, height: 4670 },
  ];
  const [pageSource, mobileQuality, mobileStyles, ...images] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
    ...tiers.map(({ filename }) => readFile(new URL(`../public/scenes/${filename}`, import.meta.url))),
  ]);
  const aspectRatios = images.map((image, index) => {
    const imageInfo = webpInfo(image);
    assert.deepEqual({ width: imageInfo.width, height: imageInfo.height }, { width: tiers[index].width, height: tiers[index].height });
    assert.ok(image.byteLength > 50_000);
    assert.ok(image.byteLength < 25_000_000);
    assert.equal(imageInfo.chunks.includes("ANIM"), false);
    return imageInfo.width / imageInfo.height;
  });
  assert.ok(Math.max(...aspectRatios) - Math.min(...aspectRatios) < 0.001);
  assert.ok(tiers.at(-1).width >= 2160);
  for (const { filename, width } of tiers) {
    assert.equal([...pageSource.matchAll(new RegExp(`${filename} ${width}w`, "g"))].length, 2);
  }
  assert.match(pageSource, /rel="preload"[\s\S]*imagesrcset=/);
  assert.match(pageSource, /imagesizes="100vw"/);
  assert.match(pageSource, /href="\/scenes\/mobile-golden-alpine-v3-1440\.webp"/);
  assert.match(pageSource, /mobile-woodland-loop\.css\?v=20260803-14/);
  assert.doesNotMatch(pageSource, /mobile-golden-alpine-v2\.webp/);
  assert.doesNotMatch(pageSource, /mobile-woodland-spring-loop/);
  assert.match(mobileStyles, /opacity:\s*1/);
  assert.match(mobileStyles, /object-fit:\s*cover/);
  assert.match(mobileStyles, /animation:\s*none/);
  assert.doesNotMatch(mobileStyles, /@keyframes/);
  assert.doesNotMatch(mobileStyles, /mobile-golden-alpine\.avif/);
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

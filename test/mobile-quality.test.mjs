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

test("mobile uses the supplied forest stream video with a still fallback", async () => {
  const tier = {
    filename: "mobile-forest-stream-v1-540.webp",
    width: 540,
    height: 960,
  };
  const [pageSource, mobileStyles, mobileScript, image, video] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(
        new URL("../public/mobile-woodland-loop.css", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(
        new URL("../public/scenes/" + tier.filename, import.meta.url),
      ),
      readFile(
        new URL(
          "../public/scenes/mobile-forest-stream-v1.mp4",
          import.meta.url,
        ),
      ),
    ]);
  const imageInfo = webpInfo(image);
  assert.deepEqual(
    { width: imageInfo.width, height: imageInfo.height },
    { width: tier.width, height: tier.height },
  );
  assert.equal(image.byteLength, 91_750);
  assert.equal(imageInfo.chunks.includes("ANIM"), false);
  assert.equal(video.byteLength, 180_293);
  for (const marker of ["ftyp", "moov", "mdat", "avc1", "vide"]) {
    assert.ok(video.includes(Buffer.from(marker)), "MP4 includes " + marker);
  }
  assert.equal(video.includes(Buffer.from("mp4a")), false);
  assert.equal(video.includes(Buffer.from("soun")), false);
  assert.ok(video.indexOf(Buffer.from("moov")) < video.indexOf(Buffer.from("mdat")));
  assert.equal(
    [...pageSource.matchAll(new RegExp(tier.filename + " " + tier.width + "w", "g"))].length,
    2,
  );
  assert.match(pageSource, /<source[\s\S]*sizes="100vw"[\s\S]*srcset=/);
  assert.match(pageSource, /<link[\s\S]*rel="preload"[\s\S]*imagesrcset=/);
  assert.match(pageSource, /imagesizes="100vw"/);
  assert.match(pageSource, /mobile-quality\.js\?v=20260802-8/);
  assert.match(
    mobileScript,
    /\/scenes\/mobile-forest-stream-v1\.mp4\?v=20260808-forest-video-1/,
  );
  assert.match(mobileScript, /video\.autoplay = true/);
  assert.match(mobileScript, /video\.muted = true/);
  assert.match(mobileScript, /video\.defaultMuted = true/);
  assert.match(mobileScript, /video\.loop = true/);
  assert.match(mobileScript, /video\.playsInline = true/);
  assert.match(mobileScript, /webkit-playsinline/);
  assert.match(mobileScript, /video\.addEventListener\("playing"/);
  assert.match(mobileScript, /await mobileVideo\.play\(\)/);
  assert.match(mobileScript, /window\.addEventListener\("pageshow"/);
  assert.match(mobileScript, /visibilitychange/);
  assert.match(mobileScript, /pointerdown/);
  assert.match(mobileScript, /touchstart/);
  assert.match(mobileScript, /backdrop\.style\.opacity = "0"/);
  assert.match(mobileScript, /video-waiting-for-interaction/);
  assert.match(mobileStyles, /object-fit:\s*cover/);
  assert.match(mobileStyles, /animation:\s*none/);
  assert.doesNotMatch(pageSource, /mobile-golden-alpine/);
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

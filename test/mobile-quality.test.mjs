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
  const [pageSource, mobileStyles, canvasClient, videoClient, poster, sprite] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(
        new URL("../public/mobile-woodland-loop.css", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../public/mobile-motion-canvas.js", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../public/scenes/mobile-forest-stream-v23-ai-2160.webp",
          import.meta.url,
        ),
      ),
      readFile(
        new URL(
          "../public/scenes/mobile-forest-stream-water-sprite-v19-hd-1080.webp",
          import.meta.url,
        ),
      ),
    ]);

  const posterInfo = webpInfo(poster);
  const spriteInfo = webpInfo(sprite);
  assert.deepEqual(
    { width: posterInfo.width, height: posterInfo.height },
    { width: 2160, height: 3840 },
  );
  assert.deepEqual(
    { width: spriteInfo.width, height: spriteInfo.height },
    { width: 2400, height: 6000 },
  );
  assert.equal(spriteInfo.chunks.includes("ALPH"), true);
  assert.equal(spriteInfo.chunks.includes("ANIM"), false);

  assert.equal(
    [...pageSource.matchAll(/mobile-forest-stream-v23-ai-2160\.webp 2160w/g)]
      .length,
    2,
  );
  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(
    pageSource,
    /\/media\/mobile-forest-stream-video-v23-ai-2160\.mp4/,
  );
  assert.match(
    pageSource,
    /mobile-quality\.js\?v=20260810-ai-enhanced-mobile-4k-v23-1/,
  );
  assert.match(mobileStyles, /mobile-motion-canvas-v18-start/);
  assert.match(mobileStyles, /selected-mobile-4k-video-v22-start/);
  assert.match(canvasClient, /ctx\.drawImage\(/);
  assert.match(canvasClient, /setTimeout\(step/);
  assert.doesNotMatch(canvasClient, /\.play\(/);
  assert.match(videoClient, /video\.autoplay = true/);
  assert.match(videoClient, /video\.muted = true/);
  assert.match(videoClient, /video\.playsInline = true/);
  assert.match(videoClient, /await video\.play\(\)/);
  assert.match(videoClient, /ai-enhanced-2160x3840/);
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


// ai-enhanced-mobile-4k-v23-test-start
test("portrait mobile serves the AI-enhanced selected forest scene", async () => {
  const [pageSource, clientSource, responderSource, video, poster] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(new URL("../src/mobile-video-response.js", import.meta.url), "utf8"),
      readFile(new URL("../public/scenes/mobile-forest-stream-video-v23-ai-2160.mp4", import.meta.url)),
      readFile(new URL("../public/scenes/mobile-forest-stream-v23-ai-2160.webp", import.meta.url)),
    ]);

  assert.equal(video.byteLength, 20957716);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {
    assert.ok(video.includes(Buffer.from(marker, "ascii")));
  }
  const posterInfo = webpInfo(poster);
  assert.deepEqual(
    { width: posterInfo.width, height: posterInfo.height },
    { width: 2160, height: 3840 },
  );
  assert.match(pageSource, /mobile-forest-stream-video-v23-ai-2160\.mp4/);
  assert.match(pageSource, /mobile-forest-stream-v23-ai-2160\.webp/);
  assert.match(pageSource, /mobile-quality\.js\?v=20260810-ai-enhanced-mobile-4k-v23-1/);
  assert.match(clientSource, /ai-enhanced-2160x3840/);
  assert.match(responderSource, /const assetByteCache = new WeakMap\(\)/);
  assert.match(responderSource, /MOBILE_VIDEO_BYTES = 20_957_716/);
  assert.match(responderSource, /be5995746c6137f9f63121eead3883ce1469279563738e1ccbd813abf9d7becf/);
});
// ai-enhanced-mobile-4k-v23-test-end

// original-mobile-image-v21-quality-test-start
test("portrait mobile plays the selected forest-stream scene through the 4K route", async () => {
  const [pageSource, styleSource, videoClient, canvasClient] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-motion-canvas.js", import.meta.url), "utf8"),
    ]);

  assert.equal(
    [...pageSource.matchAll(/mobile-forest-stream-v23-ai-2160\.webp 2160w/g)]
      .length,
    2,
  );
  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(
    pageSource,
    /\/media\/mobile-forest-stream-video-v23-ai-2160\.mp4/,
  );
  assert.match(
    pageSource,
    /mobile-quality\.js\?v=20260810-ai-enhanced-mobile-4k-v23-1/,
  );
  assert.match(
    pageSource,
    /mobile-woodland-loop\.css\?v=20260810-ai-enhanced-mobile-4k-v23-1/,
  );
  assert.doesNotMatch(pageSource, /mobile-forest-stream-v20-true-hd-1440/);
  assert.doesNotMatch(pageSource, /id="mobile-hd-background"/);
  assert.match(styleSource, /selected-mobile-4k-video-v22-start/);
  assert.match(styleSource, /\.mobile-background-video\.is-playing/);
  assert.match(videoClient, /ai-enhanced-2160x3840/);
  assert.match(
    videoClient,
    /\/media\/mobile-forest-stream-video-v23-ai-2160\.mp4/,
  );
  assert.match(
    canvasClient,
    /mobile-forest-stream-water-sprite-v19-hd-1080\.webp/,
  );
});
// original-mobile-image-v21-quality-test-end

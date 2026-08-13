import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  MOBILE_VIDEO_ASSET_PATH,
  MOBILE_VIDEO_BYTES,
  MOBILE_VIDEO_ETAG,
  MOBILE_VIDEO_ROUTE,
  parseSingleByteRange,
  serveMobileVideo,
} from "../src/mobile-video-response.js";

const VERSION = "20260813-mobile-background-v30-1";
const POSTER = "mobile-forest-stream-v24-native-1080.webp";
const ATLAS = "mobile-forest-stream-full-atlas-v29-1080.webp";
const VIDEO = "mobile-forest-stream-video-v24-native-1080.mp4";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readBytes = (path) => readFile(new URL(`../${path}`, import.meta.url));

function webpInfo(buffer) {
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(buffer.subarray(8, 12).toString("ascii"), "WEBP");
  let width;
  let height;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    const next = data + size + (size % 2);
    assert.ok(next <= buffer.length, `WebP chunk ${type} is complete`);
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
    } else if (type === "VP8L" && data + 5 <= buffer.length) {
      const bits = buffer.readUInt32LE(data + 1);
      width ??= 1 + (bits & 0x3fff);
      height ??= 1 + ((bits >>> 14) & 0x3fff);
    }
    offset = next;
  }
  assert.ok(width && height, "WebP dimensions are readable");
  return { width, height };
}

test("mobile v30 is one controller with a sharp interpolated fallback and native video handoff", async () => {
  const [
    page,
    client,
    styles,
    packageSource,
    finalizer,
    regressionFinalizer,
    poster,
    atlas,
    atlasMetadataSource,
    videoMetadataSource,
  ] = await Promise.all([
    read("src/page.js"),
    read("public/mobile-background-v30.js"),
    read("public/mobile-background-v30.css"),
    read("package.json"),
    read("scripts/finalize-mobile-background-v30.mjs"),
    read("scripts/finalize-native-selected-mobile-v24-regressions.mjs"),
    readBytes(`public/scenes/${POSTER}`),
    readBytes(`public/scenes/${ATLAS}`),
    read("scripts/mobile-full-motion-v29.json"),
    read("scripts/native-selected-mobile-video-v24.json"),
  ]);

  const atlasMetadata = JSON.parse(atlasMetadataSource);
  const videoMetadata = JSON.parse(videoMetadataSource);
  assert.deepEqual(webpInfo(poster), { width: 2160, height: 3840 });
  assert.deepEqual(webpInfo(atlas), { width: 4320, height: 3840 });
  assert.equal(atlas.byteLength, atlasMetadata.bytes);
  assert.equal(
    createHash("sha256").update(atlas).digest("hex"),
    atlasMetadata.sha256,
  );
  assert.equal(videoMetadata.width, 2160);
  assert.equal(videoMetadata.height, 3840);
  assert.equal(videoMetadata.fps, 24);
  assert.equal(videoMetadata.uniqueSampleFrames, 24);

  assert.equal(page.split('id="mobile-background-video"').length - 1, 1);
  assert.equal(page.split('id="mobile-background-v30"').length - 1, 1);
  assert.match(page, new RegExp(`/mobile-background-v30\\.css\\?v=${VERSION}`));
  assert.match(page, new RegExp(`/mobile-background-v30\\.js\\?v=${VERSION}`));
  assert.match(page, new RegExp(`/scenes/${POSTER}\\?v=${VERSION}`));
  assert.match(page, new RegExp(`/scenes/${ATLAS}\\?v=${VERSION}`));
  assert.match(page, new RegExp(`/media/${VIDEO}\\?v=${VERSION}`));
  assert.ok(
    page.indexOf(`/mobile-background-v30.js?v=${VERSION}`) <
      page.indexOf("/app.js?v="),
    "the mobile controller starts before the application modules",
  );
  for (const obsolete of [
    "/mobile-autoplay-v27.js",
    "/mobile-motion-canvas.js",
    "/mobile-quality.js",
    "/mobile-full-motion-v29.js",
    'id="mobile-motion-canvas"',
    'id="mobile-full-motion-v29"',
  ]) {
    assert.doesNotMatch(page, new RegExp(obsolete.replaceAll(".", "\\.")));
  }

  assert.match(client, /const SOURCE_FPS = 8/);
  assert.match(client, /const REFERENCE_FRAME = 4/);
  assert.match(client, /requestAnimationFrame\(drawFallback\)/);
  assert.match(client, /motionDelta = interpolatedFrame - referenceFrame/);
  assert.match(client, /sharpPoster \+ motionDelta \* uMotionGain/);
  assert.match(client, /createWebGLRenderer\(\) \|\| createCanvas2DRenderer\(\)/);
  assert.match(client, /const result = video\.play\(\)/);
  assert.match(client, /requestVideoFrameCallback/);
  assert.match(client, /setState\("video", "decoded-playing-frame"\)/);
  assert.match(client, /bindGestureRecovery\(\)/);
  assert.doesNotMatch(client, /retireGestureGatedMedia/);
  assert.doesNotMatch(
    client,
    /video\.style\.setProperty\("display", "none"/,
  );

  assert.match(
    styles,
    /#mobile-background-video\.mobile-background-video[\s\S]*opacity: 0\.001 !important;/,
  );
  assert.match(
    styles,
    /data-mobile-background-v30="fallback"[\s\S]*#mobile-background-v30/,
  );
  assert.match(
    styles,
    /data-mobile-background-v30="video"[\s\S]*#mobile-background-video/,
  );
  assert.match(styles, /--mobile-background-v30-fade: 260ms/);
  assert.match(styles, /@media \(hover: none\) and \(pointer: coarse\)/);
  assert.doesNotMatch(styles, /orientation: portrait/);

  const packageJson = JSON.parse(packageSource);
  assert.match(packageJson.scripts["test:node"], /mobile-background-v30\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts["test:node"], /mobile-quality\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts["test:node"], /mobile-autoplay-v27\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts["test:node"], /mobile-full-motion-v29\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts["test:node"], /mobile-background-loading\.test\.mjs/);

  assert.match(finalizer, /mobile-background-v30-head-start/);
  assert.match(finalizer, /mobile-background-v30-media-start/);
  assert.match(
    regressionFinalizer,
    /await import\("\.\/finalize-mobile-background-v30\.mjs"\)/,
  );
  assert.doesNotMatch(
    regressionFinalizer,
    /await import\("\.\/finalize-mobile-full-motion-v29\.mjs"\)/,
  );
});

test("the coherent video route still supplies exact Safari byte ranges", async () => {
  const video = await readBytes(`public/scenes/${VIDEO}`);
  assert.equal(video.byteLength, MOBILE_VIDEO_BYTES);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {
    assert.ok(video.includes(Buffer.from(marker, "ascii")));
  }

  const env = {
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        assert.equal(url.pathname, MOBILE_VIDEO_ASSET_PATH);
        assert.equal(url.search, "");
        return new Response(video, {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        });
      },
    },
  };
  const url = `https://stabilize.info${MOBILE_VIDEO_ROUTE}?v=${VERSION}`;

  const full = await serveMobileVideo(new Request(url), env);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("content-length"), String(MOBILE_VIDEO_BYTES));
  assert.equal(full.headers.get("etag"), MOBILE_VIDEO_ETAG);

  const partial = await serveMobileVideo(
    new Request(url, { headers: { Range: "bytes=0-1023" } }),
    env,
  );
  assert.equal(partial.status, 206);
  assert.equal(
    partial.headers.get("content-range"),
    `bytes 0-1023/${MOBILE_VIDEO_BYTES}`,
  );
  assert.equal((await partial.arrayBuffer()).byteLength, 1024);

  assert.deepEqual(parseSingleByteRange("bytes=250-", 1000), {
    start: 250,
    end: 999,
  });
  assert.deepEqual(parseSingleByteRange("bytes=-250", 1000), {
    start: 750,
    end: 999,
  });
  assert.deepEqual(parseSingleByteRange("bytes=1000-", 1000), {
    invalid: true,
  });
});

test("restored tabs still recover from interrupted blank thinking views", async () => {
  const client = await read("public/app.js");
  assert.match(client, /function restoreComposeView\(\)/);
  assert.match(client, /window\.addEventListener\("pageshow"/);
  assert.match(client, /event\.persisted && view === "thinking"/);
  assert.match(client, /conversationSurface\.dataset\.view = "compose"/);
  assert.match(client, /chatLog\.hidden = true/);
});

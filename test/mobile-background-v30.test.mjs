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
import {
  MOBILE_BACKGROUND_CLIENT_ROUTE,
  MOBILE_BACKGROUND_STYLE_ROUTE,
  MOBILE_BACKGROUND_VERSION,
  isMobileBackgroundAssetRoute,
  serveMobileBackgroundAsset,
} from "../src/mobile-background-response.js";

const VERSION = "20260813-mobile-background-v31-1";
const HANDOFF_VERSION = "20260813-mobile-video-handoff-v31-1";
const POSTER = "mobile-forest-stream-v24-native-1080.webp";
const ATLAS = "mobile-forest-stream-full-atlas-v29-1080.webp";
const VIDEO = "mobile-forest-stream-video-v24-native-1080.mp4";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const readBytes = (path) => readFile(new URL("../" + path, import.meta.url));

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
    assert.ok(next <= buffer.length, "WebP chunk " + type + " is complete");
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

test("mobile v31 is Worker-served, starts video from HTML, and keeps a no-tap canvas fallback", async () => {
  const [
    page,
    client,
    styles,
    finalizer,
    domainRouter,
    poster,
    atlas,
    atlasMetadataSource,
    videoMetadataSource,
  ] = await Promise.all([
    read("src/page.js"),
    read("public/mobile-background-v30.js"),
    read("public/mobile-background-v30.css"),
    read("scripts/finalize-mobile-background-v30.mjs"),
    read("src/domain-router.js"),
    readBytes("public/scenes/" + POSTER),
    readBytes("public/scenes/" + ATLAS),
    read("scripts/mobile-full-motion-v29.json"),
    read("scripts/native-selected-mobile-video-v24.json"),
  ]);

  assert.equal(MOBILE_BACKGROUND_VERSION, VERSION);
  assert.equal(MOBILE_BACKGROUND_CLIENT_ROUTE, "/mobile-background/runtime");
  assert.equal(MOBILE_BACKGROUND_STYLE_ROUTE, "/mobile-background/styles");
  assert.equal(isMobileBackgroundAssetRoute(MOBILE_BACKGROUND_CLIENT_ROUTE), true);
  assert.equal(isMobileBackgroundAssetRoute(MOBILE_BACKGROUND_STYLE_ROUTE), true);
  assert.equal(isMobileBackgroundAssetRoute("/mobile-background-v30.js"), false);

  const clientResponse = serveMobileBackgroundAsset(
    new Request("https://stabilize.info" + MOBILE_BACKGROUND_CLIENT_ROUTE + "?v=" + VERSION),
  );
  assert.equal(clientResponse.status, 200);
  assert.equal(clientResponse.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(clientResponse.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(await clientResponse.text(), client);

  const styleResponse = serveMobileBackgroundAsset(
    new Request("https://stabilize.info" + MOBILE_BACKGROUND_STYLE_ROUTE + "?v=" + VERSION),
  );
  assert.equal(styleResponse.status, 200);
  assert.equal(styleResponse.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(await styleResponse.text(), styles);

  const headResponse = serveMobileBackgroundAsset(
    new Request("https://stabilize.info" + MOBILE_BACKGROUND_CLIENT_ROUTE, { method: "HEAD" }),
  );
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), "");

  const atlasMetadata = JSON.parse(atlasMetadataSource);
  const videoMetadata = JSON.parse(videoMetadataSource);
  assert.deepEqual(webpInfo(poster), { width: 2160, height: 3840 });
  assert.deepEqual(webpInfo(atlas), { width: 4320, height: 3840 });
  assert.equal(atlas.byteLength, atlasMetadata.bytes);
  assert.equal(createHash("sha256").update(atlas).digest("hex"), atlasMetadata.sha256);
  assert.equal(videoMetadata.width, 2160);
  assert.equal(videoMetadata.height, 3840);
  assert.equal(videoMetadata.fps, 24);
  assert.equal(videoMetadata.uniqueSampleFrames, 24);

  assert.equal(page.split('id="mobile-background-video"').length - 1, 1);
  assert.equal(page.split('id="mobile-background-v30"').length - 1, 1);
  assert.match(page, new RegExp(MOBILE_BACKGROUND_STYLE_ROUTE + "\\?v=" + VERSION));
  assert.match(page, new RegExp(MOBILE_BACKGROUND_CLIENT_ROUTE + "\\?v=" + VERSION));
  assert.match(page, new RegExp("/scenes/" + POSTER + "\\?v=" + VERSION));
  assert.match(page, new RegExp("/scenes/" + ATLAS + "\\?v=" + VERSION));
  assert.match(page, new RegExp("/media/" + VIDEO + "\\?v=" + HANDOFF_VERSION));
  assert.match(page, /<video[\s\S]*autoplay[\s\S]*muted[\s\S]*playsinline[\s\S]*preload="auto"/);
  assert.match(page, new RegExp('src="/media/' + VIDEO + "\\?v=" + HANDOFF_VERSION + '"'));
  assert.doesNotMatch(page, /data-src="\/media\/mobile-forest-stream-video/);
  assert.ok(
    page.indexOf(MOBILE_BACKGROUND_CLIENT_ROUTE + "?v=" + VERSION) <
      page.indexOf("/app.js?v="),
    "the mobile controller starts before the application modules",
  );

  assert.match(client, /const MOBILE_QUERY = "\(max-width: 980px\) and \(orientation: portrait\)"/);
  assert.match(client, /canvas\.getContext\("2d"/);
  assert.doesNotMatch(client, /getContext\("webgl"/);
  assert.match(client, /requestAnimationFrame\(drawFallback\)/);
  assert.match(client, /const blend = linearBlend \* linearBlend \* \(3 - 2 \* linearBlend\)/);
  assert.match(client, /result = video\.play\(\)/);
  assert.match(client, /requestVideoFrameCallback/);
  assert.match(client, /setState\("video", "decoded-playing-frame"\)/);
  assert.match(client, /bindGestureRecovery\(\)/);

  assert.match(styles, /@media \(max-width: 980px\) and \(orientation: portrait\)/);
  assert.doesNotMatch(styles, /@media \(hover: none\) and \(pointer: coarse\)/);
  assert.match(styles, /data-mobile-background-v30="video"[\s\S]*#mobile-background-video/);
  assert.match(styles, /opacity: 0\.001 !important/);

  assert.match(domainRouter, /isMobileBackgroundAssetRoute/);
  assert.match(domainRouter, /serveMobileBackgroundAsset/);
  assert.match(finalizer, /writeMobileBackgroundRouteModule/);
  assert.match(finalizer, /mobile-background\/runtime/);
  assert.match(finalizer, /mobile-background\/styles/);
});

test("the coherent video route still supplies exact Safari byte ranges", async () => {
  const video = await readBytes("public/scenes/" + VIDEO);
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
  const url = "https://stabilize.info" + MOBILE_VIDEO_ROUTE + "?v=" + VERSION;

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
    "bytes 0-1023/" + MOBILE_VIDEO_BYTES,
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

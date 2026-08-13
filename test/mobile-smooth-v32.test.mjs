import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  MOBILE_VIDEO_ASSET_PATH,
  MOBILE_VIDEO_BYTES,
  MOBILE_VIDEO_ETAG,
  MOBILE_VIDEO_ROUTE,
  serveMobileVideo,
} from "../src/mobile-video-response.js";

const VERSION = "20260813-mobile-smooth-v33-1";
const VIDEO_ROUTE = "/media/mobile-forest-stream-video-v12-720.mp4";
const VIDEO_ASSET = "/scenes/mobile-forest-stream-video-v12-720.mp4";
const VIDEO_SHA256 =
  "be9d679e5e7b2e9240419225f8bb53c4a8fb3510aafed2babc5d1e27f4d12b3f";
const CACHE_POLICY = "public, max-age=31536000, immutable";

test("mobile smooth v33 uses a small genuine 60 fps stream and a static first-load fallback", async () => {
  const [
    page,
    client,
    finalizer,
    packageSource,
    workflow,
    workflowTemplate,
    metadataSource,
    video,
  ] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(
      new URL("../public/mobile-video-handoff-v31.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/finalize-mobile-smooth-v32.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../.github/workflows/verify-mobile-video.yml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/verify-mobile-smooth-v32.yml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/mobile-smooth-v32.json", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../public/scenes/mobile-forest-stream-video-v12-720.mp4", import.meta.url),
    ),
  ]);

  const metadata = JSON.parse(metadataSource);
  assert.equal(metadata.version, VERSION);
  assert.equal(metadata.videoRoute, VIDEO_ROUTE);
  assert.equal(metadata.videoAsset, VIDEO_ASSET);
  assert.equal(metadata.videoBytes, 1_447_385);
  assert.equal(metadata.width, 720);
  assert.equal(metadata.height, 1280);
  assert.equal(metadata.fps, 60);
  assert.ok(metadata.uniqueSampleFrames >= 48);

  assert.equal(MOBILE_VIDEO_ROUTE, VIDEO_ROUTE);
  assert.equal(MOBILE_VIDEO_ASSET_PATH, VIDEO_ASSET);
  assert.equal(MOBILE_VIDEO_BYTES, 1_447_385);
  assert.equal(MOBILE_VIDEO_ETAG, `"${VIDEO_SHA256}"`);
  assert.equal(video.byteLength, MOBILE_VIDEO_BYTES);
  assert.equal(createHash("sha256").update(video).digest("hex"), VIDEO_SHA256);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {
    assert.ok(video.includes(Buffer.from(marker, "ascii")));
  }
  assert.equal(video.includes(Buffer.from("mp4a", "ascii")), false);

  assert.equal(page.split('id="mobile-background-video"').length - 1, 1);
  assert.equal(page.split('id="mobile-background-v30"').length - 1, 1);
  assert.match(
    page,
    new RegExp(
      `${VIDEO_ROUTE.replaceAll(".", "\\.")}\\?v=${VERSION}`,
    ),
  );
  assert.match(
    page,
    new RegExp(`/mobile-video-handoff-v31\\.js\\?v=${VERSION}`),
  );
  assert.doesNotMatch(page, /\/mobile-background\/runtime\?v=/);
  assert.doesNotMatch(page, /data-src="\/media\/mobile-forest-stream-video/);
  assert.ok(
    page.indexOf('id="mobile-background-v30"') <
      page.indexOf(`/mobile-video-handoff-v31.js?v=${VERSION}`),
  );
  assert.ok(
    page.indexOf(`/mobile-video-handoff-v31.js?v=${VERSION}`) <
      page.indexOf("/app.js?v="),
  );

  assert.match(client, new RegExp(`const VERSION = "${VERSION}"`));
  assert.match(
    client,
    /mobile-forest-stream-video-v12-720\.mp4\?v=\$\{VERSION\}/,
  );
  assert.match(client, /native-video-720x1280-60fps/);
  assert.match(client, /video\.currentTime <= 0/);
  assert.match(client, /video\.videoWidth < 700/);
  assert.match(client, /video\.videoHeight < 1240/);

  const fallbackFunction = client.match(
    /function keepFallbackVisible\(detail = "fallback"\) \{[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(fallbackFunction);
  assert.match(
    fallbackFunction,
    /video\.style\.setProperty\("visibility", "visible", "important"\)/,
  );
  assert.match(
    fallbackFunction,
    /video\.style\.setProperty\("opacity", "0\.001", "important"\)/,
  );

  const gestureFunction = client.match(
    /function playInsideUserGesture\(\) \{[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(gestureFunction);
  assert.match(gestureFunction, /video\.play\(\)/);
  assert.doesNotMatch(gestureFunction, /await|setTimeout|requestAnimationFrame/);

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /finalize-mobile-video-handoff-v31\.mjs && node scripts\/finalize-mobile-smooth-v32\.mjs && node scripts\/finalize-mobile-hevc-v34\.mjs && node scripts\/embed-favicon-fallback\.mjs$/,
  );
  assert.match(packageJson.scripts["test:node"], /mobile-smooth-v32\.test\.mjs/);
  assert.doesNotMatch(
    packageJson.scripts["test:node"],
    /mobile-background-v30\.test\.mjs|mobile-video-handoff-v31\.test\.mjs/,
  );

  assert.equal(workflow, workflowTemplate);
  assert.match(workflow, /Verify mobile smooth v33/);
  assert.match(workflow, /720x1280/);
  assert.match(workflow, /static poster fallback/);
  assert.match(finalizer, /The expensive animated fallback controller is still loaded/);

  const mobileSurfaceStyle = await readFile(
    new URL("../public/mobile-background-v30.css", import.meta.url),
    "utf8",
  );
  assert.match(mobileSurfaceStyle, /mobile-video-smooth-v33-start/);
  assert.match(mobileSurfaceStyle, /-webkit-backdrop-filter: none/);
  assert.match(mobileSurfaceStyle, /backdrop-filter: none/);

  const env = {
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        assert.equal(url.pathname, VIDEO_ASSET);
        assert.equal(url.search, "");
        return new Response(video, {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        });
      },
    },
  };
  const requestUrl = `https://stabilize.info${VIDEO_ROUTE}?v=${VERSION}`;

  const full = await serveMobileVideo(new Request(requestUrl), env);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-length"), String(MOBILE_VIDEO_BYTES));
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("cache-control"), CACHE_POLICY);
  assert.equal(full.headers.get("cdn-cache-control"), CACHE_POLICY);
  assert.equal(full.headers.get("cloudflare-cdn-cache-control"), CACHE_POLICY);
  assert.equal((await full.arrayBuffer()).byteLength, MOBILE_VIDEO_BYTES);

  const partial = await serveMobileVideo(
    new Request(requestUrl, { headers: { Range: "bytes=0-1023" } }),
    env,
  );
  assert.equal(partial.status, 206);
  assert.equal(
    partial.headers.get("content-range"),
    `bytes 0-1023/${MOBILE_VIDEO_BYTES}`,
  );
  assert.equal((await partial.arrayBuffer()).byteLength, 1024);
});

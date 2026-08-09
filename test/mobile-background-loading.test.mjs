import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MOBILE_VIDEO_ASSET_PATH,
  MOBILE_VIDEO_BYTES,
  MOBILE_VIDEO_ETAG,
  MOBILE_VIDEO_ROUTE,
  parseSingleByteRange,
  serveMobileVideo,
} from "../src/mobile-video-response.js";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const readVideo = () =>
  readFile(
    new URL(
      "../public/scenes/mobile-forest-stream-video-v4-1080.mp4",
      import.meta.url,
    ),
  );

function assetEnvironment(video) {
  return {
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        assert.equal(url.pathname, MOBILE_VIDEO_ASSET_PATH);
        assert.equal(url.search, "");
        assert.equal(request.method, "GET");
        assert.equal(request.headers.get("range"), null);
        return new Response(video, {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        });
      },
    },
  };
}

test("mobile clients keep the static image without loading the graphics module chain", async () => {
  const [appSource, loaderSource, pageSource, packageSource] =
    await Promise.all([
      read("public/app.js"),
      read("public/background-loader.js"),
      read("src/page.js"),
      read("package.json"),
    ]);

  assert.doesNotMatch(
    appSource,
    /import \{ modulateTerrain \} from "\.\/terrain\.js"/,
  );
  assert.match(
    appSource,
    /import \{ modulateTerrain \} from "\.\/background-loader\.js\?v=20260807-priority-latency-1"/,
  );
  assert.doesNotMatch(
    loaderSource,
    /from ["']\.\/(?:terrain|photo-scene)\.js["']/,
  );
  assert.match(loaderSource, /import\("\.\/terrain\.js"\)/);
  assert.match(
    loaderSource,
    /\(max-width: 980px\) and \(orientation: portrait\)/,
  );
  assert.match(loaderSource, /\(hover: none\) and \(pointer: coarse\)/);
  assert.match(loaderSource, /prefers-reduced-motion: reduce/);
  assert.match(loaderSource, /navigator\?\.connection\?\.saveData/);
  assert.match(loaderSource, /requestIdleCallback/);
  assert.match(loaderSource, /let modulationScheduled = false/);
  assert.match(loaderSource, /function scheduleTerrainModulation\(\)/);
  assert.match(loaderSource, /requestAnimationFrame\(runAfterPaint\)/);
  assert.match(loaderSource, /setTimeout\(applyLatestTerrainValue, 0\)/);
  assert.match(
    loaderSource,
    /export function modulateTerrain\(value\) \{[\s\S]*scheduleTerrainModulation\(\);[\s\S]*return null;/,
  );
  assert.match(pageSource, /\/app\.js\?v=20260808-full-guest-thread-1/);

  const config = JSON.parse(packageSource);
  assert.equal(
    config.scripts["apply:prompt-policy"],
    "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/prepare-decision-grade-impact.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs && node scripts/apply-signed-in-prefetch-latency.mjs && node scripts/finalize-signed-in-prefetch-tests.mjs && node scripts/prepare-full-guest-cache-version.mjs && node scripts/remember-full-guest-conversation.mjs && node scripts/finalize-full-guest-conversation.mjs && node scripts/prepare-client-response-time.mjs && node scripts/materialize-mobile-forest-stream.mjs && node scripts/use-mobile-forest-stream.mjs && node scripts/apply-decision-grade-impact.mjs && node scripts/apply-client-response-time.mjs && node scripts/finalize-decision-grade-impact.mjs",
  );

  const loader = await import(
    `${new URL("../public/background-loader.js", import.meta.url).href}?test=static-mobile`
  );
  const staticMobile = {
    matchMedia: () => ({ matches: true }),
    navigator: { connection: { saveData: false } },
  };
  const desktop = {
    matchMedia: () => ({ matches: false }),
    navigator: { connection: { saveData: false } },
  };
  const dataSaver = {
    matchMedia: () => ({ matches: false }),
    navigator: { connection: { saveData: true } },
  };

  assert.equal(loader.shouldLoadInteractiveBackground(staticMobile), false);
  assert.equal(loader.shouldLoadInteractiveBackground(desktop), true);
  assert.equal(loader.shouldLoadInteractiveBackground(dataSaver), false);
});

test("the production mobile release gate follows built versions and exact image bytes", async () => {
  const workflow = await read(
    ".github/workflows/verify-mobile-background.yml",
  );

  assert.doesNotMatch(workflow, /defer-mobile-background\.mjs/);
  assert.doesNotMatch(workflow, /asset_version=/);
  assert.ok(
    workflow.includes(
      "grep -oE '/app\\.js\\?v=[A-Za-z0-9._-]+' src/page.js",
    ),
  );
  assert.ok(
    workflow.includes(
      "grep -oE 'background-loader\\.js\\?v=[A-Za-z0-9._-]+' public/app.js",
    ),
  );
  assert.ok(workflow.includes("scripts/use-mobile-forest-stream.mjs"));
  assert.ok(workflow.includes('sha256sum "$expected_mobile_file"'));
  assert.ok(workflow.includes('wc -c < "$expected_mobile_file"'));
  assert.ok(workflow.includes('live_mobile_sha'));
  assert.ok(workflow.includes('live_mobile_bytes'));
  assert.ok(workflow.includes('live_mobile_type'));
  assert.ok(
    workflow.includes("Exact forest-stream mobile release is live"),
  );
});

test("portrait mobile uses a Worker-served MP4 instead of a reconstructed blob", async () => {
  const [
    clientSource,
    materializerSource,
    headersSource,
    routerSource,
    responderSource,
    video,
  ] = await Promise.all([
    read("public/mobile-quality.js"),
    read("scripts/materialize-mobile-forest-stream.mjs"),
    read("public/_headers"),
    read("src/domain-router.js"),
    read("src/mobile-video-response.js"),
    readVideo(),
  ]);

  assert.match(
    clientSource,
    /const VIDEO_ASSET =[\s\S]*\/media\/mobile-forest-stream-video-v4-1080\.mp4/,
  );
  assert.match(clientSource, /video\.src = VIDEO_ASSET/);
  assert.match(clientSource, /video\.autoplay = true/);
  assert.match(clientSource, /video\.muted = true/);
  assert.match(clientSource, /video\.defaultMuted = true/);
  assert.match(clientSource, /video\.loop = true/);
  assert.match(clientSource, /video\.playsInline = true/);
  assert.match(clientSource, /function resumeAfterGesture\(\)/);
  assert.doesNotMatch(clientSource, /URL\.createObjectURL|new Blob|atob\(/);

  assert.match(
    materializerSource,
    /materialize\/mobile-forest-stream-video-1080-v4/,
  );
  assert.match(
    materializerSource,
    /public\/scenes\/mobile-forest-stream-video-v4-1080\.mp4/,
  );
  assert.match(
    headersSource,
    /\/scenes\/mobile-forest-stream-video-v4-1080\.mp4[\s\S]*Content-Type: video\/mp4/,
  );
  assert.match(routerSource, /url\.pathname === MOBILE_VIDEO_ROUTE/);
  assert.match(routerSource, /await serveMobileVideo\(request, canonicalEnv\)/);
  assert.match(responderSource, /Cloudflare-CDN-Cache-Control/);
  assert.match(responderSource, /Accept-Ranges/);
  assert.match(responderSource, /Content-Range/);
  assert.match(responderSource, /MOBILE_VIDEO_ETAG/);

  assert.equal(video.byteLength, MOBILE_VIDEO_BYTES);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {
    assert.ok(video.includes(Buffer.from(marker, "ascii")));
  }
});

test("single byte ranges cover Safari startup and resume requests", () => {
  assert.deepEqual(parseSingleByteRange("bytes=0-1", 1000), {
    start: 0,
    end: 1,
  });
  assert.deepEqual(parseSingleByteRange("bytes=250-", 1000), {
    start: 250,
    end: 999,
  });
  assert.deepEqual(parseSingleByteRange("bytes=-250", 1000), {
    start: 750,
    end: 999,
  });
  assert.deepEqual(parseSingleByteRange("bytes=900-2000", 1000), {
    start: 900,
    end: 999,
  });
  assert.deepEqual(parseSingleByteRange("bytes=1000-", 1000), {
    invalid: true,
  });
  assert.deepEqual(parseSingleByteRange("bytes=0-1,4-5", 1000), {
    invalid: true,
  });
});

test("the mobile video response has a strong ETag and exact uncached ranges", async () => {
  const video = await readVideo();
  const env = assetEnvironment(video);
  const url = `https://stabilize.info${MOBILE_VIDEO_ROUTE}`;

  const full = await serveMobileVideo(new Request(url), env);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("content-length"), String(MOBILE_VIDEO_BYTES));
  assert.equal(full.headers.get("etag"), MOBILE_VIDEO_ETAG);
  assert.equal(full.headers.get("etag").startsWith("W/"), false);
  assert.match(full.headers.get("cache-control"), /no-store/);
  assert.equal(full.headers.get("cdn-cache-control"), "no-store");
  assert.equal(full.headers.get("cloudflare-cdn-cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), video);

  const partial = await serveMobileVideo(
    new Request(url, { headers: { Range: "bytes=0-1023" } }),
    env,
  );
  assert.equal(partial.status, 206);
  assert.equal(
    partial.headers.get("content-range"),
    `bytes 0-1023/${MOBILE_VIDEO_BYTES}`,
  );
  assert.equal(partial.headers.get("content-length"), "1024");
  assert.equal(partial.headers.get("etag"), MOBILE_VIDEO_ETAG);
  assert.deepEqual(
    Buffer.from(await partial.arrayBuffer()),
    video.subarray(0, 1024),
  );

  const matchingIfRange = await serveMobileVideo(
    new Request(url, {
      headers: {
        Range: "bytes=1024-2047",
        "If-Range": MOBILE_VIDEO_ETAG,
      },
    }),
    env,
  );
  assert.equal(matchingIfRange.status, 206);
  assert.equal(
    matchingIfRange.headers.get("content-range"),
    `bytes 1024-2047/${MOBILE_VIDEO_BYTES}`,
  );

  const staleIfRange = await serveMobileVideo(
    new Request(url, {
      headers: {
        Range: "bytes=0-1",
        "If-Range": '"stale"',
      },
    }),
    env,
  );
  assert.equal(staleIfRange.status, 200);
  assert.equal(
    staleIfRange.headers.get("content-length"),
    String(MOBILE_VIDEO_BYTES),
  );

  const invalid = await serveMobileVideo(
    new Request(url, { headers: { Range: "bytes=999999-" } }),
    env,
  );
  assert.equal(invalid.status, 416);
  assert.equal(
    invalid.headers.get("content-range"),
    `bytes */${MOBILE_VIDEO_BYTES}`,
  );

  const unchanged = await serveMobileVideo(
    new Request(url, { headers: { "If-None-Match": MOBILE_VIDEO_ETAG } }),
    env,
  );
  assert.equal(unchanged.status, 304);

  const head = await serveMobileVideo(
    new Request(url, { method: "HEAD" }),
    env,
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(MOBILE_VIDEO_BYTES));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

// smooth-mobile-video-v12-test-start
test("portrait mobile prefers a hardware-friendly direct MP4", async () => {
  const [clientSource, materializerSource, smoothVideo] = await Promise.all([
    read("public/mobile-quality.js"),
    read("scripts/materialize-mobile-forest-stream.mjs"),
    readFile(
      new URL("../public/scenes/mobile-forest-stream-video-v12-720.mp4", import.meta.url),
    ),
  ]);

  assert.match(
    clientSource,
    /const SMOOTH_VIDEO_ASSET = "\/scenes\/mobile\-forest\-stream\-video\-v12\-720\.mp4"/,
  );
  assert.match(clientSource, /video\.src = SMOOTH_VIDEO_ASSET/);
  assert.match(
    clientSource,
    /const VIDEO_ASSET = "\/media\/mobile-forest-stream-video-v4-1080\.mp4"/,
  );
  assert.match(clientSource, /video\.src = VIDEO_ASSET/);
  assert.match(clientSource, /translate3d\(0, 0, 0\)/);
  assert.match(clientSource, /video\.preload = "auto"/);
  assert.match(materializerSource, /smooth-mobile-video-v12-validation-start/);

  assert.equal(smoothVideo.byteLength, 1314209);
  assert.equal(smoothVideo.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {
    assert.ok(smoothVideo.includes(Buffer.from(marker, "ascii")));
  }
});
// smooth-mobile-video-v12-test-end


// no-tap-mobile-motion-v17-hq-test-start
test("portrait mobile uses the higher-bitrate no-tap motion release", async () => {
  const [pageSource, styleSource, materializerSource, motion] = await Promise.all([
    read("src/page.js"),
    read("public/mobile-woodland-loop.css"),
    read("scripts/materialize-mobile-forest-stream.mjs"),
    readFile(new URL("../public/scenes/mobile-forest-stream-motion-v17-hq-1440.webp", import.meta.url)),
  ]);

  assert.equal(motion.byteLength, 15000242);
  assert.ok(motion.byteLength > 10592086);
  assert.equal(motion.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(motion.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(motion.includes(Buffer.from("ANIM", "ascii")));
  assert.ok(motion.includes(Buffer.from("ANMF", "ascii")));
  assert.equal(
    [...pageSource.matchAll(/mobile\-forest\-stream\-motion\-v17\-hq\-1440\.webp 1440w/g)].length,
    2,
  );
  assert.doesNotMatch(pageSource, /id="mobile-background-video"/);
  assert.doesNotMatch(pageSource, /mobile-quality\.js/);
  assert.match(styleSource, /no-tap-mobile-motion-v16-start/);
  assert.match(styleSource, /mobile-background-video[\s\S]*display:\s*none/);
  assert.match(materializerSource, /no-tap-mobile-motion-v17-hq-validation-start/);
  assert.match(materializerSource, /mobile\-forest\-stream\-motion\-v17\-hq\-1440\.webp/);
});
// no-tap-mobile-motion-v17-hq-test-end

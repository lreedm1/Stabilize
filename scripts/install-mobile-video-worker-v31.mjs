import { readFile, writeFile, rm } from "node:fs/promises";

const VERSION = "20260813-mobile-background-v31-1";
const OLD_VERSION = "20260813-mobile-background-v30-1";
const CLIENT_ROUTE = "/mobile-background/runtime";
const STYLE_ROUTE = "/mobile-background/styles";
const VIDEO_ROUTE = "/media/mobile-forest-stream-video-v24-native-1080.mp4";
const POSTER_ROUTE = "/scenes/mobile-forest-stream-v24-native-1080.webp";
const ATLAS_ROUTE = "/scenes/mobile-forest-stream-full-atlas-v29-1080.webp";

const CLIENT_SOURCE = String.raw`(() => {
  "use strict";

  const VERSION = "20260813-mobile-background-v31-1";
  const MOBILE_QUERY = "(max-width: 980px) and (orientation: portrait)";
  const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
  const VIDEO_ASSET =
    "/media/mobile-forest-stream-video-v24-native-1080.mp4?v=" + VERSION;
  const ATLAS_ASSET =
    "/scenes/mobile-forest-stream-full-atlas-v29-1080.webp?v=" + VERSION;

  const FRAME_WIDTH = 1080;
  const FRAME_HEIGHT = 1920;
  const FRAME_COLUMNS = 4;
  const FRAME_COUNT = 8;
  const SOURCE_FPS = 8;
  const START_FRAME = 4;
  const MAX_PIXEL_RATIO = 3;

  const root = document.documentElement;
  const video = document.querySelector("#mobile-background-video");
  const canvas = document.querySelector("#mobile-background-v30");
  const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
  const reducedMotion = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);

  if (
    mobile?.matches !== true ||
    !(video instanceof HTMLVideoElement) ||
    !(canvas instanceof HTMLCanvasElement)
  ) {
    return;
  }

  let context = null;
  let atlas = null;
  let animationFrame = null;
  let fallbackStartedAt = performance.now();
  let fallbackReady = false;
  let videoReady = false;
  let playInFlight = null;
  let gestureRecoveryBound = false;

  function motionEligible() {
    return (
      mobile?.matches === true &&
      reducedMotion?.matches !== true &&
      !document.hidden
    );
  }

  function setState(state, detail = "") {
    root.dataset.mobileBackgroundV30 = state;
    root.dataset.mobileBackgroundV30Version = VERSION;
    if (detail) root.dataset.mobileBackgroundV30Detail = detail;
    else delete root.dataset.mobileBackgroundV30Detail;
  }

  function setQuality(value) {
    root.dataset.mobileBackgroundV30Quality = value;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(
      1,
      Math.round(rect.width || document.documentElement.clientWidth || innerWidth || 1),
    );
    const cssHeight = Math.max(
      1,
      Math.round(rect.height || innerHeight || document.documentElement.clientHeight || 1),
    );
    const pixelRatio = Math.max(
      1,
      Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO),
    );
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { cssWidth, cssHeight, pixelRatio };
  }

  function drawAtlasFrame(index, alpha, size) {
    const column = index % FRAME_COLUMNS;
    const row = Math.floor(index / FRAME_COLUMNS);
    const sourceX = column * FRAME_WIDTH;
    const sourceY = row * FRAME_HEIGHT;
    const scale = Math.max(
      size.cssWidth / FRAME_WIDTH,
      size.cssHeight / FRAME_HEIGHT,
    );
    const destinationWidth = FRAME_WIDTH * scale;
    const destinationHeight = FRAME_HEIGHT * scale;
    const destinationX = (size.cssWidth - destinationWidth) / 2;
    const destinationY = (size.cssHeight - destinationHeight) / 2;

    context.globalAlpha = alpha;
    context.drawImage(
      atlas,
      sourceX,
      sourceY,
      FRAME_WIDTH,
      FRAME_HEIGHT,
      destinationX,
      destinationY,
      destinationWidth,
      destinationHeight,
    );
  }

  function drawFallback(now) {
    animationFrame = null;
    if (!motionEligible() || videoReady || !context || !atlas) return;

    const size = resizeCanvas();
    context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const elapsed = Math.max(0, now - fallbackStartedAt) / 1000;
    const position = (START_FRAME + elapsed * SOURCE_FPS) % FRAME_COUNT;
    const current = Math.floor(position);
    const next = (current + 1) % FRAME_COUNT;
    const linearBlend = position - current;
    const blend = linearBlend * linearBlend * (3 - 2 * linearBlend);

    context.globalAlpha = 1;
    context.clearRect(0, 0, size.cssWidth, size.cssHeight);
    drawAtlasFrame(current, 1, size);
    drawAtlasFrame(next, blend, size);
    context.globalAlpha = 1;

    if (!fallbackReady) {
      fallbackReady = true;
      canvas.classList.add("is-ready");
    }
    setQuality("interpolated-atlas-canvas2d");
    setState("fallback", "display-refresh-canvas2d");
    animationFrame = requestAnimationFrame(drawFallback);
  }

  function startFallback() {
    if (!motionEligible() || videoReady || !context || !atlas) return;
    fallbackStartedAt = performance.now();
    if (animationFrame === null) {
      animationFrame = requestAnimationFrame(drawFallback);
    }
  }

  function stopFallback() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  async function loadFallback() {
    if (!motionEligible()) return;
    setState("loading", "atlas");
    try {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "high";
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Unable to load the mobile atlas"));
      });
      image.src = ATLAS_ASSET;
      await loaded;
      try {
        await image.decode?.();
      } catch {
        // The load event already proves the image is drawable.
      }
      atlas = image;
      context = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
      });
      if (!context) throw new Error("Canvas 2D is unavailable");
      startFallback();
    } catch (error) {
      console.warn("mobile background fallback failed", error);
      setState("poster", "fallback-load-failed");
    }
  }

  function configureVideo() {
    video.autoplay = true;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;
    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "true");
    video.setAttribute("preload", "auto");

    if (!video.getAttribute("src")) {
      video.src = VIDEO_ASSET;
      video.load();
    }
  }

  function removeGestureRecovery() {
    if (!gestureRecoveryBound) return;
    gestureRecoveryBound = false;
    globalThis.removeEventListener("pointerdown", recoverFromGesture, true);
    globalThis.removeEventListener("touchstart", recoverFromGesture, true);
    globalThis.removeEventListener("keydown", recoverFromGesture, true);
  }

  function recoverFromGesture() {
    attemptPlayback("user-gesture");
  }

  function bindGestureRecovery() {
    if (gestureRecoveryBound) return;
    gestureRecoveryBound = true;
    globalThis.addEventListener("pointerdown", recoverFromGesture, {
      capture: true,
      passive: true,
    });
    globalThis.addEventListener("touchstart", recoverFromGesture, {
      capture: true,
      passive: true,
    });
    globalThis.addEventListener("keydown", recoverFromGesture, {
      capture: true,
    });
  }

  function revealVideo() {
    if (
      video.paused ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !motionEligible()
    ) {
      return false;
    }

    videoReady = true;
    removeGestureRecovery();
    stopFallback();
    setQuality("native-video-2160x3840-24fps");
    setState("video", "decoded-playing-frame");
    return true;
  }

  function scheduleReveal() {
    if (video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => revealVideo());
    } else {
      requestAnimationFrame(() => revealVideo());
    }
  }

  function handlePlaybackFailure(error, reason) {
    const name = error instanceof Error ? error.name : "PlaybackRejected";
    root.dataset.mobileBackgroundV30PlaybackError = name;
    videoReady = false;
    setState(fallbackReady ? "fallback" : "loading", reason + "-" + name);
    startFallback();
    bindGestureRecovery();
  }

  function attemptPlayback(reason = "unspecified") {
    if (!motionEligible() || videoReady) return playInFlight;
    if (playInFlight) return playInFlight;
    configureVideo();

    let result;
    try {
      result = video.play();
    } catch (error) {
      handlePlaybackFailure(error, reason);
      return null;
    }

    playInFlight = Promise.resolve(result)
      .then(() => {
        if (!video.paused) scheduleReveal();
      })
      .catch((error) => handlePlaybackFailure(error, reason))
      .finally(() => {
        playInFlight = null;
      });
    return playInFlight;
  }

  function handleMotionChange() {
    if (!motionEligible()) {
      stopFallback();
      videoReady = false;
      try {
        video.pause();
      } catch {}
      setState("poster", reducedMotion?.matches ? "reduced-motion" : "inactive");
      return;
    }
    startFallback();
    attemptPlayback("motion-change");
  }

  setState("poster", "initial-paint");
  configureVideo();

  if (!motionEligible()) {
    try {
      video.pause();
    } catch {}
    setState("poster", reducedMotion?.matches ? "reduced-motion" : "inactive");
    return;
  }

  loadFallback();

  video.addEventListener("playing", scheduleReveal);
  video.addEventListener("loadeddata", scheduleReveal);
  video.addEventListener("canplay", () => attemptPlayback("canplay"));
  video.addEventListener("timeupdate", () => {
    if (video.currentTime > 0) scheduleReveal();
  });
  video.addEventListener("pause", () => {
    if (!document.hidden && motionEligible()) {
      videoReady = false;
      startFallback();
      setTimeout(() => attemptPlayback("pause-retry"), 1200);
    }
  });
  video.addEventListener("error", () => {
    videoReady = false;
    setState(fallbackReady ? "fallback" : "loading", "video-error");
    startFallback();
    bindGestureRecovery();
  });
  for (const event of ["waiting", "stalled"]) {
    video.addEventListener(event, () => {
      if (!videoReady) startFallback();
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopFallback();
      return;
    }
    if (!videoReady) startFallback();
    attemptPlayback("visibilitychange");
  });

  for (const event of ["pageshow", "focus", "online"]) {
    globalThis.addEventListener(event, () => {
      if (!videoReady) startFallback();
      attemptPlayback(event);
    });
  }

  globalThis.addEventListener("resize", () => {
    resizeCanvas();
    if (!videoReady) startFallback();
  });
  globalThis.addEventListener("orientationchange", () => {
    setTimeout(handleMotionChange, 0);
  });

  mobile?.addEventListener?.("change", handleMotionChange);
  reducedMotion?.addEventListener?.("change", handleMotionChange);

  if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    scheduleReveal();
  }
  attemptPlayback("initial");
})();
`;

const STYLE_SOURCE = String.raw`/* Mobile background v31
   The runtime and stylesheet are served by the Worker so they cannot be
   omitted by a stale static-asset deployment. */

#mobile-background-video,
#mobile-background-v30 {
  display: none;
}

@media (max-width: 980px) and (orientation: portrait) {
  :root {
    --mobile-background-v30-fade: 180ms;
  }

  body,
  #photo-backdrop.photo-backdrop {
    background-image: url("/scenes/mobile-forest-stream-v24-native-1080.webp?v=20260813-mobile-background-v31-1") !important;
    background-size: cover !important;
    background-position: 50% 50% !important;
    background-repeat: no-repeat !important;
  }

  #photo-backdrop.photo-backdrop {
    position: fixed !important;
    z-index: 0 !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: none !important;
  }

  #photo-backdrop-image,
  #terrain-background,
  #photo-background,
  #mobile-motion-canvas,
  #mobile-background-video-4k,
  #mobile-full-motion-v29,
  #mobile-hd-background {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
  }

  #mobile-background-video.mobile-background-video {
    position: fixed !important;
    z-index: 1 !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    object-position: 50% 50% !important;
    visibility: visible !important;
    opacity: 0.001 !important;
    pointer-events: none !important;
    user-select: none !important;
    transform: translate3d(0, 0, 0);
    -webkit-transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    will-change: opacity;
    transition: opacity var(--mobile-background-v30-fade) linear !important;
  }

  #mobile-background-v30.mobile-background-v30 {
    position: fixed !important;
    z-index: 2 !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    visibility: visible !important;
    opacity: 0 !important;
    pointer-events: none !important;
    user-select: none !important;
    transform: translate3d(0, 0, 0);
    -webkit-transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    contain: strict;
    will-change: opacity;
    transition: opacity var(--mobile-background-v30-fade) linear !important;
  }

  #mobile-background-v30.mobile-background-v30.is-ready,
  html[data-mobile-background-v30="fallback"]
    #mobile-background-v30.mobile-background-v30 {
    opacity: 1 !important;
  }

  html[data-mobile-background-v30="video"]
    #mobile-background-video.mobile-background-video {
    opacity: 1 !important;
  }

  html[data-mobile-background-v30="video"]
    #mobile-background-v30.mobile-background-v30 {
    opacity: 0 !important;
  }

  html:not([data-mobile-background-v30="video"])
    #mobile-background-video.mobile-background-video {
    opacity: 0.001 !important;
  }

  .page-shell {
    position: relative !important;
    z-index: 10 !important;
  }
}

@media (max-width: 980px) and (orientation: portrait) and (prefers-reduced-motion: reduce) {
  #mobile-background-video.mobile-background-video,
  #mobile-background-v30.mobile-background-v30 {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
  }
}
`;

const TEST_SOURCE = String.raw`import test from "node:test";
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
  assert.match(page, new RegExp("/media/" + VIDEO + "\\?v=" + VERSION));
  assert.match(page, /<video[\s\S]*autoplay[\s\S]*muted[\s\S]*playsinline[\s\S]*preload="auto"/);
  assert.match(page, new RegExp('src="/media/' + VIDEO + "\\?v=" + VERSION + '"'));
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
`;

const LEGACY_WORKFLOW = String.raw`name: Historical coherent mobile background verifier

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  retired:
    runs-on: ubuntu-latest
    steps:
      - name: Explain the canonical verifier
        run: echo 'The active mobile release is verified by verify-mobile-video.yml.'
`;

async function read(path) {
  return readFile(path, "utf8");
}

async function write(path, content) {
  await writeFile(path, content.endsWith("\n") ? content : content + "\n", "utf8");
}

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error("Could not find " + label);
  }
  return source.replace(before, after);
}

await write("public/mobile-background-v30.js", CLIENT_SOURCE);
await write("public/mobile-background-v30.css", STYLE_SOURCE);

let finalizer = await read("scripts/finalize-mobile-background-v30.mjs");
finalizer = replaceOnce(finalizer, OLD_VERSION, VERSION, "the v30 version");
finalizer = replaceOnce(
  finalizer,
  'const STYLE_ASSET = "/mobile-background-v30.css";',
  'const STYLE_ASSET = "' + STYLE_ROUTE + '";',
  "the stylesheet route",
);
finalizer = replaceOnce(
  finalizer,
  'const CLIENT_ASSET = "/mobile-background-v30.js";',
  'const CLIENT_ASSET = "' + CLIENT_ROUTE + '";',
  "the client route",
);
finalizer = finalizer.replaceAll(
  'media="(hover: none) and (pointer: coarse)"',
  'media="(max-width: 980px) and (orientation: portrait)"',
);
finalizer = replaceOnce(
  finalizer,
  `      muted
      loop
      playsinline
      preload="none"
      poster="\${POSTER_ASSET}?v=\${VERSION}"
      data-src="\${VIDEO_ASSET}?v=\${VERSION}"`,
  `      autoplay
      muted
      loop
      playsinline
      preload="auto"
      poster="\${POSTER_ASSET}?v=\${VERSION}"
      src="\${VIDEO_ASSET}?v=\${VERSION}"`,
  "the direct video markup",
);

const headerStart = finalizer.indexOf('await update("public/_headers"');
const logStart = finalizer.indexOf("console.log(", headerStart);
if (headerStart < 0 || logStart < 0) {
  throw new Error("Could not find the finalizer header block");
}

const canonicalTail = String.raw`await update("public/_headers", (source) => {
  const start = "# mobile-background-v30-start";
  const end = "# mobile-background-v30-end";
  return removeMarked(source, start, end).trimEnd() + "\n";
});

async function writeMobileBackgroundRouteModule() {
  const client = await readFile("public/mobile-background-v30.js", "utf8");
  const styles = await readFile("public/mobile-background-v30.css", "utf8");
  const moduleSource = [
    'export const MOBILE_BACKGROUND_VERSION = "' + VERSION + '";',
    'export const MOBILE_BACKGROUND_CLIENT_ROUTE = "' + CLIENT_ASSET + '";',
    'export const MOBILE_BACKGROUND_STYLE_ROUTE = "' + STYLE_ASSET + '";',
    "",
    "const CLIENT_SOURCE = " + JSON.stringify(client) + ";",
    "const STYLE_SOURCE = " + JSON.stringify(styles) + ";",
    "",
    "export function isMobileBackgroundAssetRoute(pathname) {",
    "  return (",
    "    pathname === MOBILE_BACKGROUND_CLIENT_ROUTE ||",
    "    pathname === MOBILE_BACKGROUND_STYLE_ROUTE",
    "  );",
    "}",
    "",
    "export function serveMobileBackgroundAsset(request) {",
    "  const url = new URL(request.url);",
    "  const isClient = url.pathname === MOBILE_BACKGROUND_CLIENT_ROUTE;",
    "  const isStyle = url.pathname === MOBILE_BACKGROUND_STYLE_ROUTE;",
    "  if (!isClient && !isStyle) {",
    "    return new Response(\"Not found.\", { status: 404 });",
    "  }",
    "  if (request.method !== \"GET\" && request.method !== \"HEAD\") {",
    "    return new Response(\"Method not allowed.\", {",
    "      status: 405,",
    "      headers: { Allow: \"GET, HEAD\" },",
    "    });",
    "  }",
    "  const body = isClient ? CLIENT_SOURCE : STYLE_SOURCE;",
    "  const headers = new Headers({",
    "    \"Cache-Control\": \"no-store, max-age=0\",",
    "    \"Content-Type\": isClient",
    "      ? \"text/javascript; charset=utf-8\"",
    "      : \"text/css; charset=utf-8\",",
    "    \"Cross-Origin-Resource-Policy\": \"same-origin\",",
    "    \"Referrer-Policy\": \"no-referrer\",",
    "    \"X-Content-Type-Options\": \"nosniff\",",
    "  });",
    "  return new Response(request.method === \"HEAD\" ? null : body, {",
    "    status: 200,",
    "    headers,",
    "  });",
    "}",
    "",
  ].join("\n");
  await writeFile("src/mobile-background-response.js", moduleSource, "utf8");
}

await writeMobileBackgroundRouteModule();

await update(".github/workflows/verify-mobile-video.yml", (source) =>
  source
    .replaceAll("20260813-mobile-background-v30-1", VERSION)
    .replaceAll("/mobile-background-v30.js", CLIENT_ASSET)
    .replaceAll("/mobile-background-v30.css", STYLE_ASSET)
    .replaceAll(
      "motionDelta = interpolatedFrame - referenceFrame",
      "requestAnimationFrame(drawFallback)",
    )
    .replaceAll(
      "sharpPoster + motionDelta * uMotionGain",
      'const MOBILE_QUERY = "(max-width: 980px) and (orientation: portrait)"',
    ),
);

`;
finalizer = finalizer.slice(0, headerStart) + canonicalTail + finalizer.slice(logStart);
await write("scripts/finalize-mobile-background-v30.mjs", finalizer);

let domainRouter = await read("src/domain-router.js");
const mobileVideoImport = `import {
  MOBILE_VIDEO_ROUTE,
  serveMobileVideo,
} from "./mobile-video-response.js";
`;
const backgroundImport = `import {
  isMobileBackgroundAssetRoute,
  serveMobileBackgroundAsset,
} from "./mobile-background-response.js";
`;
if (!domainRouter.includes(backgroundImport)) {
  domainRouter = replaceOnce(
    domainRouter,
    mobileVideoImport,
    mobileVideoImport + backgroundImport,
    "the mobile video import",
  );
}
const mobileVideoRouteBlock = `    if (url.pathname === MOBILE_VIDEO_ROUTE) {
      return withStrictTransportSecurity(
        await serveMobileVideo(request, canonicalEnv),
      );
    }
`;
const backgroundRouteBlock = `
    if (isMobileBackgroundAssetRoute(url.pathname)) {
      return withStrictTransportSecurity(
        serveMobileBackgroundAsset(request),
      );
    }
`;
if (!domainRouter.includes(backgroundRouteBlock)) {
  domainRouter = replaceOnce(
    domainRouter,
    mobileVideoRouteBlock,
    mobileVideoRouteBlock + backgroundRouteBlock,
    "the mobile video route",
  );
}
await write("src/domain-router.js", domainRouter);

await write("test/mobile-background-v30.test.mjs", TEST_SOURCE);
await write(".github/workflows/verify-mobile-background.yml", LEGACY_WORKFLOW);

await import("./finalize-mobile-background-v30.mjs?install=" + Date.now());

await rm("scripts/install-mobile-video-worker-v31.mjs", { force: true });
await rm(".github/workflows/materialize-mobile-video-worker-v31.yml", { force: true });

console.log(
  "Materialized mobile background v31 with Worker-served code and direct HTML video playback.",
);

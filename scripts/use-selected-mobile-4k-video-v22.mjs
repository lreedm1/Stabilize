import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260809-selected-mobile-4k-video-v22-1";
const VIDEO_ROUTE =
  "/media/mobile-forest-stream-video-v14-retina-2160.mp4";
const VIDEO_ASSET =
  "/scenes/mobile-forest-stream-video-v14-retina-2160.mp4";
const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v14-retina-2160.webp";
const VIDEO_BYTES = 5_006_520;
const VIDEO_ETAG =
  '"16f5b59a82b6ba8a2820a548c4fd0395d59304dec8bf4c6fcfb68b1d423377ff"';
const WRONG_SCENE_PREFIX =
  "/scenes/mobile-forest-stream-v20-true-hd-1440";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMarked(source, start, end, replacement, append = false) {
  const normalized = `${replacement.trimEnd()}\n`;
  if (!source.includes(start) || !source.includes(end)) {
    if (source.includes(start) || source.includes(end)) {
      throw new Error(`Incomplete marked block: ${start}`);
    }
    if (append) {
      return `${source.trimEnd()}\n\n${normalized}`;
    }
    throw new Error(`Missing marked block: ${start}`);
  }
  const pattern = new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*(?:\\n|$)`,
    "g",
  );
  return source.replace(pattern, normalized);
}

function insertBefore(source, anchor, block, label) {
  if (source.includes(block.trim())) return source;
  if (!source.includes(anchor)) throw new Error(`Missing ${label} anchor.`);
  return source.replace(anchor, `${block.trimEnd()}\n${anchor}`);
}

function insertAfter(source, anchor, block, label) {
  if (source.includes(block.trim())) return source;
  if (!source.includes(anchor)) throw new Error(`Missing ${label} anchor.`);
  return source.replace(anchor, `${anchor}\n${block.trimEnd()}`);
}

await update("src/mobile-video-response.js", (source) => {
  let next = source
    .replace(
      /export const MOBILE_VIDEO_ROUTE =\n  "[^"]+";/,
      `export const MOBILE_VIDEO_ROUTE =\n  "${VIDEO_ROUTE}";`,
    )
    .replace(
      /export const MOBILE_VIDEO_ASSET_PATH =\n  "[^"]+";/,
      `export const MOBILE_VIDEO_ASSET_PATH =\n  "${VIDEO_ASSET}";`,
    )
    .replace(
      /export const MOBILE_VIDEO_BYTES = [\d_]+;/,
      `export const MOBILE_VIDEO_BYTES = ${String(VIDEO_BYTES).replace(
        /\B(?=(\d{3})+(?!\d))/g,
        "_",
      )};`,
    )
    .replace(
      /export const MOBILE_VIDEO_ETAG =\n  '[^']+';/,
      `export const MOBILE_VIDEO_ETAG =\n  '${VIDEO_ETAG}';`,
    );

  for (const expected of [
    VIDEO_ROUTE,
    VIDEO_ASSET,
    String(VIDEO_BYTES).replace(/\B(?=(\d{3})+(?!\d))/g, "_"),
    VIDEO_ETAG,
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`The 4K video responder is missing ${expected}.`);
    }
  }
  return next;
});

const client = `const MOBILE_BACKGROUND_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_ASSET =
  "${VIDEO_ROUTE}";
const POSTER_ASSET =
  "${POSTER_ASSET}";
const MAX_AUTOPLAY_RETRIES = 10;

const mobilePortrait = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
const video = document.querySelector("#mobile-background-video");
let retryTimer = null;
let autoplayAttempts = 0;
let requestedPause = false;
let gestureRecoveryBound = false;

function setState(state) {
  document.documentElement.dataset.mobileBackground = state;
}

function clearRetry() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function eligible() {
  return (
    video instanceof HTMLVideoElement &&
    mobilePortrait?.matches === true &&
    !document.hidden
  );
}

function configure() {
  if (!(video instanceof HTMLVideoElement)) return;
  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.poster = POSTER_ASSET;
  video.setAttribute("autoplay", "");
  video.setAttribute("muted", "");
  video.setAttribute("loop", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("preload", "auto");
  video.setAttribute("x-webkit-airplay", "deny");

  const declared = video.getAttribute("src") || "";
  const current = video.currentSrc || video.src || declared;
  if (!current.endsWith(VIDEO_ASSET)) {
    video.src = VIDEO_ASSET;
    video.load();
  }
}

function markPlaying() {
  if (!eligible() || video.paused || video.readyState < 2) return;
  video.classList.add("is-playing");
  video.classList.remove("is-autoplay-blocked", "is-failed");
  document.documentElement.dataset.mobileVideoSource = "selected-forest-stream";
  document.documentElement.dataset.mobileVideoQuality = "4k-2160x3840";
  setState("video-playing");
  clearRetry();
  autoplayAttempts = 0;
}

function revealFallback(state, error = null) {
  if (!(video instanceof HTMLVideoElement)) return;
  video.classList.remove("is-playing");
  if (state === "video-failed") video.classList.add("is-failed");
  else video.classList.add("is-autoplay-blocked");
  setState(state);
  if (error && typeof error.name === "string") {
    document.documentElement.dataset.mobileVideoAutoplayError = error.name;
  }
}

function scheduleRetry() {
  if (!eligible() || autoplayAttempts >= MAX_AUTOPLAY_RETRIES) return;
  clearRetry();
  const delay = Math.min(2500, 180 * 2 ** Math.min(autoplayAttempts, 4));
  autoplayAttempts += 1;
  retryTimer = setTimeout(() => requestPlayback(), delay);
}

function bindGestureRecovery() {
  if (gestureRecoveryBound) return;
  gestureRecoveryBound = true;
  const recover = () => {
    autoplayAttempts = 0;
    requestPlayback(true);
  };
  for (const event of ["pointerdown", "touchstart", "keydown"]) {
    globalThis.addEventListener(event, recover, {
      capture: true,
      passive: event !== "keydown",
    });
  }
}

async function requestPlayback(fromGesture = false) {
  if (!eligible()) return;
  configure();
  requestedPause = false;
  setState("video-loading-4k");

  try {
    await video.play();
    markPlaying();
  } catch (error) {
    if (fromGesture) autoplayAttempts = 0;
    revealFallback("video-autoplay-blocked", error);
    bindGestureRecovery();
    scheduleRetry();
  }
}

function startVideo() {
  if (!eligible()) return;
  configure();
  requestPlayback();
  queueMicrotask(() => requestPlayback());
  requestAnimationFrame(() => requestPlayback());
}

function stopVideo() {
  clearRetry();
  if (!(video instanceof HTMLVideoElement)) return;
  requestedPause = true;
  video.pause();
  video.classList.remove("is-playing");
  setState("poster-canvas-fallback");
  queueMicrotask(() => {
    requestedPause = false;
  });
}

if (video instanceof HTMLVideoElement) {
  configure();
  for (const event of ["playing", "timeupdate", "loadeddata", "canplay"]) {
    video.addEventListener(event, markPlaying);
  }
  video.addEventListener("loadedmetadata", () => requestPlayback());
  video.addEventListener("error", () => {
    clearRetry();
    revealFallback("video-failed");
  });
  video.addEventListener("pause", () => {
    if (!requestedPause && eligible()) scheduleRetry();
  });
  video.addEventListener("ended", () => requestPlayback());
}

mobilePortrait?.addEventListener?.("change", (event) => {
  if (event.matches) startVideo();
  else stopVideo();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopVideo();
  else startVideo();
});
document.addEventListener("DOMContentLoaded", startVideo, { once: true });
globalThis.addEventListener("load", startVideo, { once: true });
globalThis.addEventListener("pageshow", startVideo);
globalThis.addEventListener("focus", startVideo);
globalThis.addEventListener("online", startVideo);
globalThis.addEventListener("orientationchange", () => setTimeout(startVideo, 0));
globalThis.addEventListener("pagehide", stopVideo);

if (mobilePortrait?.matches) {
  bindGestureRecovery();
  startVideo();
}
`;
await writeFile("public/mobile-quality.js", client, "utf8");

const preloadStart = "<!-- selected-mobile-4k-video-v22-preload-start -->";
const preloadEnd = "<!-- selected-mobile-4k-video-v22-preload-end -->";
const preloadBlock = `    ${preloadStart}
    <link
      rel="preload"
      as="video"
      href="${VIDEO_ROUTE}"
      media="(max-width: 980px) and (orientation: portrait)"
      type="video/mp4"
    />
    ${preloadEnd}`;

const videoStart = "<!-- selected-mobile-4k-video-v22-start -->";
const videoEnd = "<!-- selected-mobile-4k-video-v22-end -->";
const videoBlock = `    ${videoStart}
    <video
      id="mobile-background-video"
      class="mobile-background-video"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
      poster="${POSTER_ASSET}"
      aria-hidden="true"
      tabindex="-1"
    >
      <source src="${VIDEO_ROUTE}" type="video/mp4" />
    </video>
    ${videoEnd}`;

const scriptStart = "<!-- selected-mobile-4k-video-v22-script-start -->";
const scriptEnd = "<!-- selected-mobile-4k-video-v22-script-end -->";
const scriptBlock = `    ${scriptStart}
    <script type="module" src="/mobile-quality.js?v=${VERSION}"></script>
    ${scriptEnd}`;

await update("src/page.js", (source) => {
  let next = source;
  if (next.includes(preloadStart)) {
    next = replaceMarked(next, preloadStart, preloadEnd, preloadBlock);
  } else {
    next = insertBefore(
      next,
      "    <!-- mobile-motion-canvas-v18-preloads-start -->",
      preloadBlock,
      "mobile preload",
    );
  }

  if (next.includes(videoStart)) {
    next = replaceMarked(next, videoStart, videoEnd, videoBlock);
  } else {
    next = insertAfter(
      next,
      "    <!-- mobile-motion-canvas-v18-end -->",
      videoBlock,
      "mobile canvas",
    );
  }

  if (next.includes(scriptStart)) {
    next = replaceMarked(next, scriptStart, scriptEnd, scriptBlock);
  } else {
    next = insertAfter(
      next,
      "    <!-- mobile-motion-canvas-v18-script-end -->",
      scriptBlock,
      "mobile canvas script",
    );
  }

  next = next.replace(
    /mobile-woodland-loop\.css\?v=[^"]+/,
    `mobile-woodland-loop.css?v=${VERSION}`,
  );

  if (next.split(`href="${VIDEO_ROUTE}"`).length - 1 !== 1) {
    throw new Error("Expected exactly one selected 4K video preload.");
  }
  if (next.split(`src="${VIDEO_ROUTE}"`).length - 1 !== 1) {
    throw new Error("Expected exactly one selected 4K video source.");
  }
  if (next.split('id="mobile-background-video"').length - 1 !== 1) {
    throw new Error("Expected exactly one selected 4K background video.");
  }
  if (next.split(`${POSTER_ASSET} 2160w`).length - 1 !== 2) {
    throw new Error("The selected forest-stream poster changed.");
  }
  if (next.includes(WRONG_SCENE_PREFIX)) {
    throw new Error("The wrong replacement scene is referenced again.");
  }
  return next;
});

const styleStart = "/* selected-mobile-4k-video-v22-start */";
const styleEnd = "/* selected-mobile-4k-video-v22-end */";
const styleBlock = `${styleStart}
.mobile-background-video {
  display: none;
}

@media (max-width: 980px) and (orientation: portrait) {
  .mobile-background-video {
    position: fixed;
    z-index: 0;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 50%;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    user-select: none;
    transform: translate3d(0, 0, 0);
    -webkit-transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    contain: strict;
    will-change: opacity;
  }

  html[data-mobile-background="video-playing"]
    .mobile-background-video.is-playing,
  .mobile-background-video.is-playing {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  .mobile-background-video.is-autoplay-blocked,
  .mobile-background-video.is-failed {
    visibility: hidden !important;
    opacity: 0 !important;
  }
}
${styleEnd}`;

await update("public/mobile-woodland-loop.css", (source) => {
  let next = source.replace(
    /\.mobile-background-video \{\n  display: none !important;\n\}/,
    `.mobile-background-video {\n  display: none;\n}`,
  );
  return replaceMarked(next, styleStart, styleEnd, styleBlock, true);
});

await update("test/mobile-background-loading.test.mjs", (source) => {
  let next = source
    .replaceAll(
      "mobile-forest-stream-video-v4-1080.mp4",
      "mobile-forest-stream-video-v14-retina-2160.mp4",
    )
    .replace(
      "/materialize\\\\/mobile-forest-stream-video-1080-v4/",
      "/retina-mobile-video-v14-validation-start/",
    );

  const smoothStart = "// smooth-mobile-video-v12-test-start";
  const smoothEnd = "// smooth-mobile-video-v12-test-end";
  const qualityBlock = `${smoothStart}
test("portrait mobile uses the selected 2160x3840 MP4 without a lower-resolution video fallback", async () => {
  const [pageSource, clientSource, materializerSource, video] =
    await Promise.all([
      read("src/page.js"),
      read("public/mobile-quality.js"),
      read("scripts/materialize-mobile-forest-stream.mjs"),
      readFile(
        new URL(
          "../public/scenes/mobile-forest-stream-video-v14-retina-2160.mp4",
          import.meta.url,
        ),
      ),
    ]);

  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(
    pageSource,
    /\\/media\\/mobile-forest-stream-video-v14-retina-2160\\.mp4/,
  );
  assert.match(
    pageSource,
    /mobile-quality\\.js\\?v=${VERSION}/,
  );
  assert.match(
    clientSource,
    /const VIDEO_ASSET =[\\s\\S]*\\/media\\/mobile-forest-stream-video-v14-retina-2160\\.mp4/,
  );
  assert.match(clientSource, /video\\.src = VIDEO_ASSET/);
  assert.match(clientSource, /video\\.autoplay = true/);
  assert.match(clientSource, /video\\.muted = true/);
  assert.match(clientSource, /video\\.defaultMuted = true/);
  assert.match(clientSource, /video\\.playsInline = true/);
  assert.match(clientSource, /4k-2160x3840/);
  assert.doesNotMatch(clientSource, /smooth-720-fallback|legacy-worker-fallback/);
  assert.match(materializerSource, /retina-mobile-video-v14-validation-start/);

  assert.equal(video.byteLength, ${VIDEO_BYTES});
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {
    assert.ok(video.includes(Buffer.from(marker, "ascii")));
  }
});
${smoothEnd}`;

  next = replaceMarked(next, smoothStart, smoothEnd, qualityBlock);
  return next;
});

const qualityTestStart = "// original-mobile-image-v21-quality-test-start";
const qualityTestEnd = "// original-mobile-image-v21-quality-test-end";
const qualityTestBlock = `${qualityTestStart}
test("portrait mobile plays the selected forest-stream scene through the 4K route", async () => {
  const [pageSource, styleSource, videoClient, canvasClient] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-motion-canvas.js", import.meta.url), "utf8"),
    ]);

  assert.equal(
    [...pageSource.matchAll(/mobile-forest-stream-v14-retina-2160\\.webp 2160w/g)]
      .length,
    2,
  );
  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(
    pageSource,
    /\\/media\\/mobile-forest-stream-video-v14-retina-2160\\.mp4/,
  );
  assert.match(
    pageSource,
    /mobile-quality\\.js\\?v=${VERSION}/,
  );
  assert.match(
    pageSource,
    /mobile-woodland-loop\\.css\\?v=${VERSION}/,
  );
  assert.doesNotMatch(pageSource, /mobile-forest-stream-v20-true-hd-1440/);
  assert.doesNotMatch(pageSource, /id="mobile-hd-background"/);
  assert.match(styleSource, /selected-mobile-4k-video-v22-start/);
  assert.match(styleSource, /\\.mobile-background-video\\.is-playing/);
  assert.match(videoClient, /4k-2160x3840/);
  assert.match(
    videoClient,
    /\\/media\\/mobile-forest-stream-video-v14-retina-2160\\.mp4/,
  );
  assert.match(
    canvasClient,
    /mobile-forest-stream-water-sprite-v19-hd-1080\\.webp/,
  );
});
${qualityTestEnd}`;

await update("test/mobile-quality.test.mjs", (source) =>
  replaceMarked(
    source,
    qualityTestStart,
    qualityTestEnd,
    qualityTestBlock,
  ),
);

console.log(
  `Selected the correct forest-stream scene's ${VIDEO_BYTES}-byte 2160x3840 MP4 as the portrait-mobile background (${VERSION}).`,
);

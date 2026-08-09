import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260809-mobile-hd-background-v20-2";
const VIDEO_ASSET =
  "/scenes/mobile-forest-stream-v20-true-hd-1440.mp4";
const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v20-true-hd-1440.webp";
const POSTER_WIDTH = 1440;
const LEGACY_POSTER_ASSET =
  "/scenes/mobile-forest-stream-v14-retina-2160.webp";

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
    if (append) {
      const prefix = source.endsWith("\n") ? source : `${source}\n`;
      return `${prefix}\n${normalized}`;
    }
    throw new Error(`Could not locate ${start}`);
  }
  const pattern = new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*(?:\\n|$)`,
  );
  return source.replace(pattern, normalized);
}

const preloadStart = "<!-- mobile-hd-background-v20-preloads-start -->";
const preloadEnd = "<!-- mobile-hd-background-v20-preloads-end -->";
const preloadBlock = `    ${preloadStart}
    <link
      rel="preload"
      as="image"
      href="${POSTER_ASSET}"
      imagesrcset="${POSTER_ASSET} ${POSTER_WIDTH}w"
      imagesizes="100vw"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />
    <link
      rel="preload"
      as="video"
      href="${VIDEO_ASSET}"
      media="(max-width: 980px) and (orientation: portrait)"
      type="video/mp4"
    />
    ${preloadEnd}`;

const videoStart = "<!-- mobile-hd-background-v20-start -->";
const videoEnd = "<!-- mobile-hd-background-v20-end -->";
const videoBlock = `    ${videoStart}
    <video
      id="mobile-hd-background"
      class="mobile-hd-background"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
      poster="${POSTER_ASSET}"
      aria-hidden="true"
      tabindex="-1"
    >
      <source src="${VIDEO_ASSET}" type="video/mp4" />
    </video>
    ${videoEnd}
`;

const scriptStart = "<!-- mobile-hd-background-v20-script-start -->";
const scriptEnd = "<!-- mobile-hd-background-v20-script-end -->";
const scriptBlock = `    ${scriptStart}
    <script src="/mobile-hd-background-v20.js?v=${VERSION}" defer></script>
    ${scriptEnd}
`;

await update("src/page.js", (source) => {
  let next = source;

  if (next.includes(preloadStart)) {
    next = replaceMarked(next, preloadStart, preloadEnd, preloadBlock);
  } else {
    const anchor = "    <!-- mobile-motion-canvas-v18-preloads-start -->";
    if (!next.includes(anchor)) throw new Error("Missing mobile preload anchor");
    next = next.replace(anchor, `${preloadBlock}\n${anchor}`);
  }

  // Preserve the existing poster and canvas as one visually matched fallback.
  // The true-HD video sits above both layers and keeps its own sharp poster
  // visible even when autoplay is unavailable.
  if (next.includes(videoStart)) {
    next = replaceMarked(next, videoStart, videoEnd, videoBlock);
  } else {
    const anchor = "    <!-- mobile-motion-canvas-v18-end -->";
    if (!next.includes(anchor)) throw new Error("Missing mobile canvas anchor");
    next = next.replace(anchor, `${anchor}\n${videoBlock.trimEnd()}`);
  }

  if (next.includes(scriptStart)) {
    next = replaceMarked(next, scriptStart, scriptEnd, scriptBlock);
  } else {
    const anchor = "  </body>";
    if (!next.includes(anchor)) throw new Error("Missing body close anchor");
    next = next.replace(anchor, `${scriptBlock}${anchor}`);
  }

  next = next.replace(
    /mobile-woodland-loop\.css\?v=[^"]+/,
    `mobile-woodland-loop.css?v=${VERSION}`,
  );

  if (next.split(`href="${VIDEO_ASSET}"`).length - 1 !== 1) {
    throw new Error("Expected one HD video preload");
  }
  if (next.split(`src="${VIDEO_ASSET}"`).length - 1 !== 1) {
    throw new Error("Expected one HD video source");
  }
  if (next.split('id="mobile-hd-background"').length - 1 !== 1) {
    throw new Error("Expected one HD mobile video element");
  }
  if (next.split(`${LEGACY_POSTER_ASSET} 2160w`).length - 1 !== 2) {
    throw new Error("The matched legacy poster/canvas fallback changed");
  }
  return next;
});

const client = `const MOBILE_HD_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const video = document.querySelector("#mobile-hd-background");
const mobilePortrait = globalThis.matchMedia?.(MOBILE_HD_QUERY);
const reducedMotion = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);
let gestureBound = false;

function setState(state) {
  document.documentElement.dataset.mobileHdBackground = state;
}

function eligible() {
  return (
    video instanceof HTMLVideoElement &&
    mobilePortrait?.matches === true &&
    reducedMotion?.matches !== true &&
    navigator?.connection?.saveData !== true
  );
}

function reveal() {
  if (!(video instanceof HTMLVideoElement)) return;
  video.classList.add("is-ready");
  video.classList.remove("is-poster-fallback");
  setState("playing-true-hd");
}

function preservePoster(state = "poster-fallback") {
  if (!(video instanceof HTMLVideoElement)) return;
  // Keep the element opaque. Before decoded frames arrive, the browser renders
  // the 1440x2560 poster; after playback has begun, the last sharp frame stays
  // visible during a stall instead of exposing the older soft canvas beneath.
  video.classList.add("is-poster-fallback");
  setState(state);
}

function bindGestureRecovery() {
  if (gestureBound) return;
  gestureBound = true;
  const recover = () => {
    if (!eligible()) return;
    video.play().catch(() => {});
  };
  for (const event of ["pointerdown", "touchstart", "keydown"]) {
    globalThis.addEventListener(event, recover, {
      once: true,
      passive: event !== "keydown",
    });
  }
}

async function start() {
  if (!(video instanceof HTMLVideoElement)) return;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");

  if (!eligible()) {
    video.pause();
    preservePoster(
      mobilePortrait?.matches ? "static-true-hd-poster" : "desktop-static",
    );
    return;
  }

  setState("loading-true-hd");
  try {
    await video.play();
    if (!video.paused && video.readyState >= 2) reveal();
  } catch {
    preservePoster("autoplay-retry-pending");
    bindGestureRecovery();
  }
}

if (video instanceof HTMLVideoElement) {
  for (const event of ["playing", "loadeddata", "canplay"]) {
    video.addEventListener(event, () => {
      if (!video.paused && video.readyState >= 2) reveal();
    });
  }
  video.addEventListener("error", () =>
    preservePoster("video-failed-true-hd-poster"),
  );
  video.addEventListener("stalled", () => {
    if (video.readyState < 2) preservePoster("video-stalled-true-hd-poster");
  });
}

mobilePortrait?.addEventListener?.("change", start);
reducedMotion?.addEventListener?.("change", start);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) video?.pause();
  else start();
});
globalThis.addEventListener("pageshow", start);
globalThis.addEventListener("focus", start);
globalThis.addEventListener("online", start);
document.addEventListener("DOMContentLoaded", start, { once: true });
start();
`;
await writeFile("public/mobile-hd-background-v20.js", client, "utf8");

const styleStart = "/* mobile-hd-background-v20-start */";
const styleEnd = "/* mobile-hd-background-v20-end */";
const styleBlock = `${styleStart}
.mobile-hd-background {
  display: none;
}

@media (max-width: 980px) and (orientation: portrait) {
  .mobile-hd-background {
    position: fixed;
    z-index: 0;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 50%;
    opacity: 1;
    pointer-events: none;
    user-select: none;
    transform: translate3d(0, 0, 0);
    -webkit-transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }

  .mobile-hd-background.is-ready,
  .mobile-hd-background.is-poster-fallback {
    opacity: 1;
  }
}
${styleEnd}`;
await update("public/mobile-woodland-loop.css", (source) =>
  replaceMarked(source, styleStart, styleEnd, styleBlock, true),
);

const headersStart = "# mobile-hd-background-v20-start";
const headersEnd = "# mobile-hd-background-v20-end";
const headersBlock = `${headersStart}
${VIDEO_ASSET}
  Content-Type: video/mp4
  Cache-Control: public, max-age=31536000, immutable
  Accept-Ranges: bytes
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

${POSTER_ASSET}
  Content-Type: image/webp
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

/mobile-hd-background-v20.js
  Content-Type: text/javascript; charset=utf-8
  Cache-Control: no-store, max-age=0
${headersEnd}`;
await update("public/_headers", (source) =>
  replaceMarked(source, headersStart, headersEnd, headersBlock, true),
);

const qualityStart = "// mobile-hd-background-v20-quality-test-start";
const qualityEnd = "// mobile-hd-background-v20-quality-test-end";
const qualityTest = `${qualityStart}
test("portrait mobile layers a true-HD MP4 over the matched canvas fallback", async () => {
  const [pageSource, styleSource, clientSource, video, poster] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-hd-background-v20.js", import.meta.url), "utf8"),
      readFile(new URL("../public${VIDEO_ASSET}", import.meta.url)),
      readFile(new URL("../public${POSTER_ASSET}", import.meta.url)),
    ]);

  assert.ok(video.byteLength > 4_000_000);
  assert.ok(video.byteLength < 30_000_000);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  assert.ok(video.includes(Buffer.from("moov", "ascii")));
  assert.ok(video.includes(Buffer.from("avc1", "ascii")));
  const posterInfo = webpInfo(poster);
  assert.deepEqual(
    { width: posterInfo.width, height: posterInfo.height },
    { width: 1440, height: 2560 },
  );
  assert.equal(
    [...pageSource.matchAll(/mobile-forest-stream-v14-retina-2160\\.webp 2160w/g)]
      .length,
    2,
  );
  assert.match(pageSource, /id="mobile-hd-background"/);
  assert.match(pageSource, /autoplay[\\s\\S]*muted[\\s\\S]*loop[\\s\\S]*playsinline/);
  assert.match(pageSource, /mobile-forest-stream-v20-true-hd-1440\\.mp4/);
  assert.match(pageSource, /mobile-hd-background-v20\\.js\\?v=${VERSION}/);
  assert.match(styleSource, /mobile-hd-background-v20-start/);
  assert.match(styleSource, /\\.mobile-hd-background[\\s\\S]*opacity: 1/);
  assert.match(clientSource, /await video\\.play\\(\\)/);
  assert.match(clientSource, /playing-true-hd/);
  assert.match(clientSource, /static-true-hd-poster/);
  assert.match(clientSource, /navigator\\?\\.connection\\?\\.saveData/);
});
${qualityEnd}`;
await update("test/mobile-quality.test.mjs", (source) =>
  replaceMarked(source, qualityStart, qualityEnd, qualityTest, true),
);

console.log(`Applied the true-HD portrait mobile video overlay (${VERSION}).`);

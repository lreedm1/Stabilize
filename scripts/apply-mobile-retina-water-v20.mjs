import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const VERSION = "20260809-mobile-retina-water-v20-1";
const OLD_VERSIONS = [
  "20260809-mobile-motion-canvas-v19-hd-1",
  "20260809-mobile-motion-canvas-v19-hd-2",
];
const POSTER_ASSET = "/scenes/mobile-forest-stream-v14-retina-2160.webp";
const FALLBACK_ASSET =
  "/scenes/mobile-forest-stream-water-sprite-v19-hd-1080.webp";
const STRIP_PREFIX = "/scenes/mobile-forest-stream-water-strip-v20-retina-";
const STRIP_COUNT = 10;

const stripAsset = (index) =>
  `${STRIP_PREFIX}${String(index).padStart(2, "0")}.webp`;

async function update(file, transform) {
  const before = await readFile(file, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(file, after, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMarked(source, start, end, replacement, append = false) {
  const normalized = `${replacement.trimEnd()}\n`;
  if (!source.includes(start) || !source.includes(end)) {
    if (append) {
      return `${source.trimEnd()}\n\n${normalized}`;
    }
    throw new Error(`Could not locate marked block ${start}`);
  }
  const pattern = new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*(?:\\n|$)`,
  );
  const next = source.replace(pattern, normalized);
  if (next === source && !source.includes(normalized.trimEnd())) {
    throw new Error(`Could not replace marked block ${start}`);
  }
  return next;
}

const stripAssetsLiteral = Array.from(
  { length: STRIP_COUNT },
  (_, index) => `  "${stripAsset(index + 1)}",`,
).join("\n");

const runtime = `const MOBILE_MOTION_QUERY =
  "(max-width: 980px) and (orientation: portrait)";

// The existing 1080-composition atlas remains an automatic fallback. The
// primary path below uses native 2160x3840 source pixels and a 3x canvas.
const SPRITE_ASSET =
  "${FALLBACK_ASSET}";
const COMPOSITION_WIDTH = 1080;
const COMPOSITION_HEIGHT = 1920;
const FRAME_LEFT = 680;
const FRAME_TOP = 720;
const FRAME_WIDTH = 400;
const FRAME_HEIGHT = 1200;
const FRAME_COLUMNS = 6;

const RETINA_STRIP_ASSETS = [
${stripAssetsLiteral}
];
const RETINA_COMPOSITION_WIDTH = 2160;
const RETINA_COMPOSITION_HEIGHT = 3840;
const RETINA_FRAME_LEFT = 1360;
const RETINA_FRAME_TOP = 1440;
const RETINA_FRAME_WIDTH = 800;
const RETINA_FRAME_HEIGHT = 2400;
const RETINA_FRAMES_PER_STRIP = 3;
const FRAME_COUNT = 30;
const FRAME_RATE = 6;
const FRAME_INTERVAL = 1000 / FRAME_RATE;

const mobilePortrait = globalThis.matchMedia?.(MOBILE_MOTION_QUERY);
const canvas = document.querySelector("#mobile-motion-canvas");
const backdropImage = document.querySelector("#photo-backdrop-image");

let context = null;
let fallbackSprite = null;
let fallbackPromise = null;
const retinaSheets = new Map();
let retinaAvailable = true;
let timer = null;
let running = false;
let frameIndex = 0;
let nextFrameAt = 0;
let cssWidth = 0;
let cssHeight = 0;
let pixelRatio = 1;

function setMotionState(state) {
  document.documentElement.dataset.mobileMotion = state;
}

function setMotionQuality(quality) {
  document.documentElement.dataset.mobileMotionQuality = quality;
}

function showCanvas() {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  canvas.style.setProperty("display", "block", "important");
  canvas.style.setProperty("visibility", "visible", "important");
  canvas.style.setProperty("opacity", "1", "important");
}

function hideCanvas() {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  canvas.style.removeProperty("display");
  canvas.style.removeProperty("visibility");
  canvas.style.removeProperty("opacity");
}

function canAnimate() {
  return (
    canvas instanceof HTMLCanvasElement &&
    mobilePortrait?.matches === true &&
    !document.hidden
  );
}

function ensureContext() {
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  if (!context) {
    context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (context) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
    }
  }
  return context;
}

function resizeCanvas() {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const nextWidth = Math.max(1, Math.round(globalThis.innerWidth || 1));
  const nextHeight = Math.max(1, Math.round(globalThis.innerHeight || 1));
  const nextRatio = Math.min(
    3,
    Math.max(1, globalThis.devicePixelRatio || 1),
  );

  if (
    nextWidth === cssWidth &&
    nextHeight === cssHeight &&
    nextRatio === pixelRatio
  ) {
    return;
  }

  cssWidth = nextWidth;
  cssHeight = nextHeight;
  pixelRatio = nextRatio;
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  canvas.style.width = \`${cssWidth}px\`;
  canvas.style.height = \`${cssHeight}px\`;

  const ctx = ensureContext();
  ctx?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function loadImage(source, priority = "auto") {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = priority;
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(\`Could not load ${source}\`));
    image.src = source;
  });
}

function normalizeSheetIndex(index) {
  const count = RETINA_STRIP_ASSETS.length;
  return ((index % count) + count) % count;
}

function switchToFallback() {
  if (!retinaAvailable) return;
  retinaAvailable = false;
  setMotionQuality("1080-fallback");
  loadFallbackSprite();
}

function loadRetinaSheet(sheetIndex, priority = "auto") {
  const normalized = normalizeSheetIndex(sheetIndex);
  const existing = retinaSheets.get(normalized);
  if (existing) return existing.promise;

  const record = { image: null, promise: null };
  record.promise = loadImage(RETINA_STRIP_ASSETS[normalized], priority)
    .then((image) => {
      record.image = image;
      return image;
    })
    .catch((error) => {
      retinaSheets.delete(normalized);
      switchToFallback();
      throw error;
    });
  retinaSheets.set(normalized, record);
  return record.promise;
}

function loadedRetinaSheet(sheetIndex) {
  const record = retinaSheets.get(normalizeSheetIndex(sheetIndex));
  return record?.image instanceof HTMLImageElement && record.image.complete
    ? record.image
    : null;
}

function keepRollingDecodeWindow(currentSheet) {
  const current = normalizeSheetIndex(currentSheet);
  const next = normalizeSheetIndex(current + 1);
  for (const [index, record] of retinaSheets) {
    if (index === current || index === next) continue;
    if (record.image instanceof HTMLImageElement) record.image.src = "";
    retinaSheets.delete(index);
  }
}

function loadFallbackSprite() {
  if (fallbackPromise) return fallbackPromise;
  fallbackPromise = loadImage(SPRITE_ASSET, "high")
    .then((image) => {
      fallbackSprite = image;
      if (canAnimate()) startMotion();
      return image;
    })
    .catch(() => {
      setMotionState("sprite-failed");
      canvas?.classList.remove("is-ready");
      hideCanvas();
      return null;
    });
  return fallbackPromise;
}

function drawRetinaFrame(index) {
  const sheetIndex = Math.floor(index / RETINA_FRAMES_PER_STRIP);
  const localIndex = index % RETINA_FRAMES_PER_STRIP;
  const sheet = loadedRetinaSheet(sheetIndex);
  if (!sheet) {
    loadRetinaSheet(sheetIndex, sheetIndex === 0 ? "high" : "auto")
      .then(() => {
        if (canAnimate()) drawFrame(frameIndex);
      })
      .catch(() => {});
    return false;
  }

  const ctx = ensureContext();
  if (!ctx) return false;
  resizeCanvas();

  const scale = Math.max(
    cssWidth / RETINA_COMPOSITION_WIDTH,
    cssHeight / RETINA_COMPOSITION_HEIGHT,
  );
  const compositionWidth = RETINA_COMPOSITION_WIDTH * scale;
  const compositionHeight = RETINA_COMPOSITION_HEIGHT * scale;
  const compositionX = (cssWidth - compositionWidth) / 2;
  const compositionY = (cssHeight - compositionHeight) / 2;
  const destinationWidth = RETINA_FRAME_WIDTH * scale;
  const destinationHeight = RETINA_FRAME_HEIGHT * scale;
  const destinationX = compositionX + RETINA_FRAME_LEFT * scale;
  const destinationY = compositionY + RETINA_FRAME_TOP * scale;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.drawImage(
    sheet,
    localIndex * RETINA_FRAME_WIDTH,
    0,
    RETINA_FRAME_WIDTH,
    RETINA_FRAME_HEIGHT,
    destinationX,
    destinationY,
    destinationWidth,
    destinationHeight,
  );

  if (localIndex >= 1) {
    loadRetinaSheet(sheetIndex + 1).catch(() => {});
  }
  keepRollingDecodeWindow(sheetIndex);
  return true;
}

function drawFallbackFrame(index) {
  const ctx = ensureContext();
  if (
    !ctx ||
    !(fallbackSprite instanceof HTMLImageElement) ||
    !fallbackSprite.complete
  ) {
    loadFallbackSprite();
    return false;
  }

  resizeCanvas();
  const column = index % FRAME_COLUMNS;
  const row = Math.floor(index / FRAME_COLUMNS);
  const sourceX = column * FRAME_WIDTH;
  const sourceY = row * FRAME_HEIGHT;
  const scale = Math.max(
    cssWidth / COMPOSITION_WIDTH,
    cssHeight / COMPOSITION_HEIGHT,
  );
  const compositionWidth = COMPOSITION_WIDTH * scale;
  const compositionHeight = COMPOSITION_HEIGHT * scale;
  const compositionX = (cssWidth - compositionWidth) / 2;
  const compositionY = (cssHeight - compositionHeight) / 2;
  const destinationWidth = FRAME_WIDTH * scale;
  const destinationHeight = FRAME_HEIGHT * scale;
  const destinationX = compositionX + FRAME_LEFT * scale;
  const destinationY = compositionY + FRAME_TOP * scale;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.drawImage(
    fallbackSprite,
    sourceX,
    sourceY,
    FRAME_WIDTH,
    FRAME_HEIGHT,
    destinationX,
    destinationY,
    destinationWidth,
    destinationHeight,
  );
  return true;
}

function drawFrame(index) {
  const painted = retinaAvailable
    ? drawRetinaFrame(index)
    : drawFallbackFrame(index);
  if (!painted) return false;

  canvas.classList.add("is-ready");
  showCanvas();
  setMotionQuality(retinaAvailable ? "retina-2160" : "1080-fallback");
  setMotionState("canvas-playing");
  return true;
}

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleNextFrame(delay = FRAME_INTERVAL) {
  clearTimer();
  if (!running || !canAnimate()) return;
  timer = setTimeout(step, Math.max(0, delay));
}

function step() {
  if (!running || !canAnimate()) {
    stopMotion();
    return;
  }

  const now = performance.now();
  if (!nextFrameAt) nextFrameAt = now;
  if (now + 1 >= nextFrameAt) {
    const nextIndex = (frameIndex + 1) % FRAME_COUNT;
    if (drawFrame(nextIndex)) {
      frameIndex = nextIndex;
      nextFrameAt += FRAME_INTERVAL;
    } else {
      nextFrameAt = now + FRAME_INTERVAL;
    }
    if (nextFrameAt < now - FRAME_INTERVAL) {
      nextFrameAt = now + FRAME_INTERVAL;
    }
  }
  scheduleNextFrame(nextFrameAt - performance.now());
}

function startMotion() {
  if (!canAnimate()) return;
  resizeCanvas();
  if (!drawFrame(frameIndex)) return;
  if (running) return;
  running = true;
  nextFrameAt = performance.now() + FRAME_INTERVAL;
  scheduleNextFrame(FRAME_INTERVAL);
}

function stopMotion() {
  running = false;
  nextFrameAt = 0;
  clearTimer();
  if (!mobilePortrait?.matches) {
    canvas?.classList.remove("is-ready");
    hideCanvas();
    setMotionState("desktop-static");
  } else if (document.hidden) {
    setMotionState("paused-hidden");
  }
}

function beginLoading() {
  if (!mobilePortrait?.matches) return;
  setMotionState("retina-loading");
  setMotionQuality("retina-loading");
  loadRetinaSheet(0, "high")
    .then(() => {
      loadRetinaSheet(1).catch(() => {});
      startMotion();
    })
    .catch(() => loadFallbackSprite());
}

if (backdropImage instanceof HTMLImageElement) {
  const markBackdropReady = () => {
    document
      .querySelector("#terrain-background")
      ?.classList.add("is-photo-ready");
  };
  if (backdropImage.complete && backdropImage.naturalWidth > 0) {
    markBackdropReady();
  } else {
    backdropImage.addEventListener("load", markBackdropReady, { once: true });
  }
}

mobilePortrait?.addEventListener?.("change", (event) => {
  if (event.matches) beginLoading();
  else stopMotion();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopMotion();
  else startMotion();
});
window.addEventListener("resize", () => {
  resizeCanvas();
  if (canAnimate()) drawFrame(frameIndex);
});
window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    resizeCanvas();
    startMotion();
  }, 0);
});
window.addEventListener("pageshow", startMotion);
window.addEventListener("focus", startMotion);
window.addEventListener("online", startMotion);
window.addEventListener("pagehide", stopMotion);
document.addEventListener("DOMContentLoaded", beginLoading, { once: true });

if (mobilePortrait?.matches) beginLoading();
`;

await writeFile("public/mobile-motion-canvas.js", runtime, "utf8");

const preloadStart = "<!-- mobile-motion-canvas-v18-preloads-start -->";
const preloadEnd = "<!-- mobile-motion-canvas-v18-preloads-end -->";
const preloadBlock = `    ${preloadStart}
    <link
      rel="preload"
      as="image"
      href="${POSTER_ASSET}"
      imagesrcset="
        ${POSTER_ASSET} 2160w
      "
      imagesizes="100vw"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />
    <link
      rel="preload"
      as="image"
      href="${stripAsset(1)}"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />
    <link
      rel="prefetch"
      as="image"
      href="${stripAsset(2)}"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
    />
    <link
      rel="prefetch"
      as="image"
      href="${FALLBACK_ASSET}"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
    />
    ${preloadEnd}`;

await update("src/page.js", (source) => {
  let next = replaceMarked(
    source,
    preloadStart,
    preloadEnd,
    preloadBlock,
  );
  next = next.replace(
    /mobile-motion-canvas\.js\?v=[A-Za-z0-9._-]+/,
    `mobile-motion-canvas.js?v=${VERSION}`,
  );
  next = next.replace(
    /mobile-woodland-loop\.css\?v=[A-Za-z0-9._-]+/,
    `mobile-woodland-loop.css?v=${VERSION}`,
  );
  return next;
});

const headersStart = "# mobile-retina-water-v20-start";
const headersEnd = "# mobile-retina-water-v20-end";
const headersBlock = `${headersStart}
${Array.from({ length: STRIP_COUNT }, (_, index) => `${stripAsset(index + 1)}
  Content-Type: image/webp
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff`).join("\n\n")}
${headersEnd}`;
await update("public/_headers", (source) =>
  replaceMarked(source, headersStart, headersEnd, headersBlock, true),
);

const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".txt"]);
async function replaceVersionsRecursively(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await replaceVersionsRecursively(fullPath);
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name))) continue;
    await update(fullPath, (source) => {
      let next = source;
      for (const oldVersion of OLD_VERSIONS) {
        next = next.replaceAll(oldVersion, VERSION);
      }
      return next;
    });
  }
}
for (const directory of ["src", "public", "test"]) {
  await replaceVersionsRecursively(directory);
}

const testStart = "// mobile-retina-water-v20-test-start";
const testEnd = "// mobile-retina-water-v20-test-end";
const testBlock = `${testStart}
test("portrait mobile uses native Retina water strips and a 3x canvas", async () => {
  const [pageSource, clientSource] = await Promise.all([
    read("src/page.js"),
    read("public/mobile-motion-canvas.js"),
  ]);

  assert.match(clientSource, /const RETINA_COMPOSITION_WIDTH = 2160/);
  assert.match(clientSource, /const RETINA_COMPOSITION_HEIGHT = 3840/);
  assert.match(clientSource, /const RETINA_FRAME_WIDTH = 800/);
  assert.match(clientSource, /const RETINA_FRAME_HEIGHT = 2400/);
  assert.match(clientSource, /const RETINA_FRAMES_PER_STRIP = 3/);
  assert.match(clientSource, /Math\\.min\\(\\s*3,/);
  assert.match(clientSource, /setMotionQuality\\(retinaAvailable \\? "retina-2160"/);
  assert.match(clientSource, /function keepRollingDecodeWindow\\(currentSheet\\)/);
  assert.match(pageSource, /mobile-forest-stream-water-strip-v20-retina-01\\.webp/);
  assert.match(pageSource, /mobile-forest-stream-water-strip-v20-retina-02\\.webp/);

  for (let index = 1; index <= ${STRIP_COUNT}; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const strip = await readFile(
      new URL(
        `../public/scenes/mobile-forest-stream-water-strip-v20-retina-${suffix}.webp`,
        import.meta.url,
      ),
    );
    const info = webpInfo(strip);
    assert.deepEqual(
      { width: info.width, height: info.height },
      { width: 2400, height: 2400 },
    );
    assert.equal(info.chunks.includes("ALPH"), true);
    assert.equal(info.chunks.includes("ANIM"), false);
    assert.ok(strip.byteLength > 100_000);
    assert.ok(strip.byteLength < 12_000_000);
  }
});
${testEnd}`;
await update("test/mobile-quality.test.mjs", (source) =>
  replaceMarked(source, testStart, testEnd, testBlock, true),
);

console.log(
  `Installed native 2160-source mobile water strips, a rolling two-strip decode window, and a 3x canvas (${VERSION}).`,
);

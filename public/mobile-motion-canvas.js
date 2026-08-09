const MOBILE_MOTION_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const SPRITE_ASSET =
  "/scenes/mobile-forest-stream-water-sprite-v18-540.webp";
const FRAME_WIDTH = 540;
const FRAME_HEIGHT = 960;
const FRAME_COLUMNS = 6;
const FRAME_COUNT = 30;
const FRAME_RATE = 6;
const FRAME_INTERVAL = 1000 / FRAME_RATE;

const mobilePortrait = globalThis.matchMedia?.(MOBILE_MOTION_QUERY);
const canvas = document.querySelector("#mobile-motion-canvas");
const backdropImage = document.querySelector("#photo-backdrop-image");

let context = null;
let sprite = null;
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
  const nextRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));

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
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = ensureContext();
  ctx?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function drawFrame(index) {
  const ctx = ensureContext();
  if (!ctx || !(sprite instanceof HTMLImageElement) || !sprite.complete) {
    return false;
  }

  resizeCanvas();
  const column = index % FRAME_COLUMNS;
  const row = Math.floor(index / FRAME_COLUMNS);
  const sourceX = column * FRAME_WIDTH;
  const sourceY = row * FRAME_HEIGHT;

  const scale = Math.max(cssWidth / FRAME_WIDTH, cssHeight / FRAME_HEIGHT);
  const destinationWidth = FRAME_WIDTH * scale;
  const destinationHeight = FRAME_HEIGHT * scale;
  const destinationX = (cssWidth - destinationWidth) / 2;
  const destinationY = (cssHeight - destinationHeight) / 2;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.drawImage(
    sprite,
    sourceX,
    sourceY,
    FRAME_WIDTH,
    FRAME_HEIGHT,
    destinationX,
    destinationY,
    destinationWidth,
    destinationHeight,
  );
  canvas.classList.add("is-ready");
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
    frameIndex = (frameIndex + 1) % FRAME_COUNT;
    drawFrame(frameIndex);
    nextFrameAt += FRAME_INTERVAL;
    if (nextFrameAt < now - FRAME_INTERVAL) {
      nextFrameAt = now + FRAME_INTERVAL;
    }
  }
  scheduleNextFrame(nextFrameAt - performance.now());
}

function startMotion() {
  if (!canAnimate()) return;
  if (!(sprite instanceof HTMLImageElement) || !sprite.complete) {
    setMotionState("sprite-loading");
    return;
  }
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
    setMotionState("desktop-static");
  } else if (document.hidden) {
    setMotionState("paused-hidden");
  }
}

function loadSprite() {
  if (sprite instanceof HTMLImageElement) return;
  setMotionState("sprite-loading");
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = "high";
  image.onload = () => {
    sprite = image;
    frameIndex = 0;
    drawFrame(frameIndex);
    startMotion();
  };
  image.onerror = () => {
    setMotionState("sprite-failed");
    canvas?.classList.remove("is-ready");
  };
  image.src = SPRITE_ASSET;
  sprite = image;
}

if (backdropImage instanceof HTMLImageElement) {
  const markBackdropReady = () => {
    document.querySelector("#terrain-background")?.classList.add("is-photo-ready");
  };
  if (backdropImage.complete && backdropImage.naturalWidth > 0) {
    markBackdropReady();
  } else {
    backdropImage.addEventListener("load", markBackdropReady, { once: true });
  }
}

mobilePortrait?.addEventListener?.("change", (event) => {
  if (event.matches) {
    loadSprite();
    startMotion();
  } else {
    stopMotion();
  }
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

document.addEventListener(
  "DOMContentLoaded",
  () => {
    if (mobilePortrait?.matches) {
      loadSprite();
      startMotion();
    }
  },
  { once: true },
);

if (mobilePortrait?.matches) {
  loadSprite();
  startMotion();
}

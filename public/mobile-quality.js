const MOBILE_BACKGROUND_QUERY =
  "(orientation: portrait) and (hover: none) and (pointer: coarse)";
const VIDEO_ASSET =
  "/media/mobile-forest-stream-video-v24-native-1080.mp4";
const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v24-native-1080.webp";
const MAX_AUTOPLAY_RETRIES = 10;
const VIDEO_RENDER_WIDTH = 2160;
const VIDEO_RENDER_HEIGHT = 3840;

function installZoomStableStyles() {
  if (document.getElementById("mobile-zoom-stable-style")) return;
  const style = document.createElement("style");
  style.id = "mobile-zoom-stable-style";
  style.textContent = `@media (orientation: portrait) and (hover: none) and (pointer: coarse) {
    .photo-backdrop {
      background-image: url("/scenes/mobile-forest-stream-v14-retina-2160.webp") !important;
      background-size: cover !important;
      background-position: 50% 50% !important;
      background-repeat: no-repeat !important;
    }
    #photo-backdrop-image { visibility: hidden !important; opacity: 0 !important; }
    .mobile-background-video {
      position: fixed !important; inset: 0 !important; z-index: 0 !important;
      display: block !important; width: 100% !important; height: 100% !important;
      object-fit: cover !important; object-position: 50% 50% !important;
      pointer-events: none !important;
    }
    html[data-mobile-background="video-playing"] .mobile-background-video.is-playing,
    .mobile-background-video.is-playing { visibility: visible !important; opacity: 1 !important; }
    .mobile-motion-canvas.is-ready {
      display: block !important; visibility: visible !important; opacity: 1 !important;
    }
  }`;
  document.head.append(style);
}

installZoomStableStyles();

const mobilePortrait = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
const video = document.querySelector("#mobile-background-video");
let retryTimer = null;
let autoplayAttempts = 0;
let requestedPause = false;
let gestureRecoveryBound = false;
let renderCanvas = null;
let renderContext = null;
let renderFrameHandle = null;
let renderedFirstFrame = false;

function setState(state) {
  document.documentElement.dataset.mobileBackground = state;
}

function ensure4kRenderTarget() {
  if (!(video instanceof HTMLVideoElement)) return null;
  if (renderCanvas instanceof HTMLCanvasElement && renderContext) {
    return renderCanvas;
  }

  const canvas = document.createElement("canvas");
  canvas.id = "mobile-background-video-4k";
  canvas.width = VIDEO_RENDER_WIDTH;
  canvas.height = VIDEO_RENDER_HEIGHT;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.zIndex = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.userSelect = "none";
  canvas.style.objectFit = "cover";
  canvas.style.opacity = "0";
  canvas.style.visibility = "hidden";
  canvas.style.transform = "translate3d(0, 0, 0)";
  canvas.style.backfaceVisibility = "hidden";

  const context = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  video.insertAdjacentElement("beforebegin", canvas);
  renderCanvas = canvas;
  renderContext = context;
  return canvas;
}

function draw4kFrame() {
  if (
    !(video instanceof HTMLVideoElement) ||
    !(renderCanvas instanceof HTMLCanvasElement) ||
    !renderContext ||
    !eligible() ||
    video.readyState < 2 ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    return;
  }

  const sourceAspect = video.videoWidth / video.videoHeight;
  const targetAspect = VIDEO_RENDER_WIDTH / VIDEO_RENDER_HEIGHT;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = video.videoWidth;
  let sourceHeight = video.videoHeight;

  if (sourceAspect > targetAspect) {
    sourceWidth = video.videoHeight * targetAspect;
    sourceX = (video.videoWidth - sourceWidth) / 2;
  } else if (sourceAspect < targetAspect) {
    sourceHeight = video.videoWidth / targetAspect;
    sourceY = (video.videoHeight - sourceHeight) / 2;
  }

  renderContext.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    VIDEO_RENDER_WIDTH,
    VIDEO_RENDER_HEIGHT,
  );

  if (!renderedFirstFrame) {
    renderedFirstFrame = true;
    renderCanvas.style.visibility = "visible";
    renderCanvas.style.opacity = "1";
    video.style.opacity = "0";
    video.style.visibility = "hidden";
    document.documentElement.dataset.mobileVideoRender = "2160x3840";
    document.documentElement.dataset.mobileVideoQuality = "4k-render-2160x3840";
  }
}

function schedule4kFrame() {
  draw4kFrame();
  if (!eligible() || video.paused) return;

  if (typeof video.requestVideoFrameCallback === "function") {
    renderFrameHandle = video.requestVideoFrameCallback(() => schedule4kFrame());
  } else {
    renderFrameHandle = requestAnimationFrame(() => schedule4kFrame());
  }
}

function start4kRender() {
  if (!eligible()) return;
  const canvas = ensure4kRenderTarget();
  if (!canvas || renderFrameHandle !== null) return;
  renderedFirstFrame = false;
  schedule4kFrame();
}

function stop4kRender() {
  if (
    renderFrameHandle !== null &&
    video instanceof HTMLVideoElement &&
    typeof video.cancelVideoFrameCallback === "function"
  ) {
    try {
      video.cancelVideoFrameCallback(renderFrameHandle);
    } catch {}
  } else if (renderFrameHandle !== null) {
    cancelAnimationFrame(renderFrameHandle);
  }
  renderFrameHandle = null;
  renderedFirstFrame = false;
  if (renderCanvas instanceof HTMLCanvasElement) {
    renderCanvas.style.opacity = "0";
    renderCanvas.style.visibility = "hidden";
  }
  if (video instanceof HTMLVideoElement) {
    video.style.removeProperty("opacity");
    video.style.removeProperty("visibility");
  }
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
  document.documentElement.dataset.mobileVideoSource = "selected-forest-stream-native-source";
  document.documentElement.dataset.mobileVideoQuality = "4k-render-2160x3840";
  setState("video-playing");
  start4kRender();
  clearRetry();
  autoplayAttempts = 0;
}

function revealFallback(state, error = null) {
  if (!(video instanceof HTMLVideoElement)) return;
  stop4kRender();
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
  setState("video-loading-native-source");

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
  stop4kRender();
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

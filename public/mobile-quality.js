const MOBILE_BACKGROUND_QUERY =
  "(orientation: portrait) and (hover: none) and (pointer: coarse)";
const VIDEO_ASSET =
  "/media/mobile-forest-stream-video-v24-native-1080.mp4";
const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v24-native-1080.webp";
const MAX_AUTOPLAY_RETRIES = 10;

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
  document.documentElement.dataset.mobileVideoSource = "selected-forest-stream-native-source";
  document.documentElement.dataset.mobileVideoQuality = "native-source-1080x1920";
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

/* mobile-video-4k-render-v1-start */
(() => {
  const RENDER_WIDTH = 2160;
  const RENDER_HEIGHT = 3840;
  const sourceVideo = document.querySelector("#mobile-background-video");
  const portraitTouch = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
  let canvas = null;
  let context = null;
  let frameHandle = null;
  let frameMode = null;

  function eligible4k() {
    return (
      sourceVideo instanceof HTMLVideoElement &&
      portraitTouch?.matches === true &&
      !document.hidden
    );
  }

  function ensureCanvas() {
    if (!(sourceVideo instanceof HTMLVideoElement)) return null;
    if (canvas instanceof HTMLCanvasElement && context) return canvas;

    canvas = document.createElement("canvas");
    canvas.id = "mobile-background-video-4k";
    canvas.width = RENDER_WIDTH;
    canvas.height = RENDER_HEIGHT;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.zIndex = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.userSelect = "none";
    canvas.style.transform = "translate3d(0, 0, 0)";
    canvas.style.backfaceVisibility = "hidden";
    canvas.style.setProperty("opacity", "0", "important");
    canvas.style.setProperty("visibility", "hidden", "important");

    context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) {
      canvas = null;
      return null;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    sourceVideo.insertAdjacentElement("afterend", canvas);
    return canvas;
  }

  function drawFrame() {
    if (
      !eligible4k() ||
      !(canvas instanceof HTMLCanvasElement) ||
      !context ||
      sourceVideo.readyState < 2 ||
      sourceVideo.videoWidth <= 0 ||
      sourceVideo.videoHeight <= 0
    ) return false;

    const sourceAspect = sourceVideo.videoWidth / sourceVideo.videoHeight;
    const targetAspect = RENDER_WIDTH / RENDER_HEIGHT;
    let sx = 0;
    let sy = 0;
    let sw = sourceVideo.videoWidth;
    let sh = sourceVideo.videoHeight;
    if (sourceAspect > targetAspect) {
      sw = sourceVideo.videoHeight * targetAspect;
      sx = (sourceVideo.videoWidth - sw) / 2;
    } else if (sourceAspect < targetAspect) {
      sh = sourceVideo.videoWidth / targetAspect;
      sy = (sourceVideo.videoHeight - sh) / 2;
    }

    context.drawImage(sourceVideo, sx, sy, sw, sh, 0, 0, RENDER_WIDTH, RENDER_HEIGHT);
    canvas.style.setProperty("visibility", "visible", "important");
    canvas.style.setProperty("opacity", "1", "important");
    sourceVideo.style.setProperty("visibility", "hidden", "important");
    sourceVideo.style.setProperty("opacity", "0", "important");
    document.documentElement.dataset.mobileVideoSourceQuality = "native-source-1080x1920";
    document.documentElement.dataset.mobileVideoRender = "2160x3840";
    document.documentElement.dataset.mobileVideoQuality = "4k-render-2160x3840";
    return true;
  }

  function loop() {
    frameHandle = null;
    frameMode = null;
    if (!drawFrame() || sourceVideo.paused) return;
    if (typeof sourceVideo.requestVideoFrameCallback === "function") {
      frameMode = "video";
      frameHandle = sourceVideo.requestVideoFrameCallback(loop);
    } else {
      frameMode = "animation";
      frameHandle = requestAnimationFrame(loop);
    }
  }

  function start() {
    if (!eligible4k() || sourceVideo.paused) return;
    if (!ensureCanvas() || frameHandle !== null) return;
    loop();
  }

  function stop() {
    if (frameHandle !== null) {
      if (frameMode === "video" && typeof sourceVideo.cancelVideoFrameCallback === "function") {
        try { sourceVideo.cancelVideoFrameCallback(frameHandle); } catch {}
      } else if (frameMode === "animation") {
        cancelAnimationFrame(frameHandle);
      }
    }
    frameHandle = null;
    frameMode = null;
    if (canvas instanceof HTMLCanvasElement) {
      canvas.style.setProperty("opacity", "0", "important");
      canvas.style.setProperty("visibility", "hidden", "important");
    }
    if (sourceVideo instanceof HTMLVideoElement) {
      sourceVideo.style.removeProperty("opacity");
      sourceVideo.style.removeProperty("visibility");
    }
  }

  if (sourceVideo instanceof HTMLVideoElement) {
    for (const event of ["playing", "loadeddata", "canplay"]) {
      sourceVideo.addEventListener(event, start);
    }
    sourceVideo.addEventListener("pause", stop);
    sourceVideo.addEventListener("error", stop);
  }
  portraitTouch?.addEventListener?.("change", (event) => {
    if (event.matches) start();
    else stop();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  globalThis.addEventListener("pageshow", start);
  globalThis.addEventListener("orientationchange", () => setTimeout(start, 0));
  globalThis.addEventListener("pagehide", stop);
  start();
})();
/* mobile-video-4k-render-v1-end */

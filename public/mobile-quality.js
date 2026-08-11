const MOBILE_BACKGROUND_QUERY =
  "(hover: none) and (pointer: coarse)";
const VIDEO_ASSET =
  "/media/mobile-forest-stream-video-v24-native-1080.mp4";
const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v24-native-1080.webp";
const MAX_AUTOPLAY_RETRIES = 10;

function installZoomStableStyles() {
  if (document.getElementById("mobile-zoom-stable-style")) return;
  const style = document.createElement("style");
  style.id = "mobile-zoom-stable-style";
  style.textContent = `@media (hover: none) and (pointer: coarse) {
    .photo-backdrop {
      background-image: url("/scenes/mobile-forest-stream-v24-native-1080.webp?v=20260811-coherent-mobile-4k-v25-1") !important;
      background-size: cover !important;
      background-position: 50% 50% !important;
      background-repeat: no-repeat !important;
    }
    #photo-backdrop-image { display: none !important; visibility: hidden !important; opacity: 0 !important; }
    .mobile-background-video {
      position: fixed !important; inset: 0 !important; z-index: 0 !important;
      display: block !important; width: 100% !important; height: 100% !important;
      object-fit: cover !important; object-position: 50% 50% !important;
      pointer-events: none !important;
    }
    html[data-mobile-background="video-playing"] .mobile-background-video.is-playing,
    .mobile-background-video.is-playing { visibility: visible !important; opacity: 1 !important; }
    .mobile-motion-canvas { display: none !important; visibility: hidden !important; opacity: 0 !important; }
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
  document.documentElement.dataset.mobileVideoSource = "coherent-full-frame-source-motion";
  document.documentElement.dataset.mobileVideoQuality = "coherent-source-2160x3840";
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
  setState("video-loading-coherent-4k");

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

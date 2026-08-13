const MOBILE_HD_QUERY =
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

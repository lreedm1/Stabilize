const MOBILE_BACKGROUND_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_ASSET = "/media/mobile-forest-stream-video-v4-1080.mp4";
const SMOOTH_VIDEO_ASSET = "/scenes/mobile-forest-stream-video-v12-720.mp4";
const POSTER_ASSET = "/scenes/mobile-forest-stream-v12-720.webp";

const mobilePortrait = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
const backdropImage = document.querySelector("#photo-backdrop-image");
const terrain = document.querySelector("#terrain-background");
const pageShell = document.querySelector(".page-shell");

let backgroundVideo = null;
let fallbackAttempted = false;
let gestureListenersInstalled = false;
let playControl = null;

function markPosterReady() {
  terrain?.classList.add("is-photo-ready");
  if (document.documentElement.dataset.mobileBackground !== "video-playing") {
    document.documentElement.dataset.mobileBackground = "poster-ready";
  }
}

if (backdropImage instanceof HTMLImageElement) {
  if (backdropImage.complete && backdropImage.naturalWidth > 0) {
    markPosterReady();
  } else {
    backdropImage.addEventListener("load", markPosterReady, { once: true });
    backdropImage.addEventListener(
      "error",
      () => {
        document.documentElement.dataset.mobileBackground = "poster-failed";
      },
      { once: true },
    );
  }
}

function ensurePlayControl() {
  if (playControl instanceof HTMLButtonElement) return playControl;
  const existing = document.querySelector("#mobile-video-play-control");
  if (existing instanceof HTMLButtonElement) {
    playControl = existing;
    return playControl;
  }

  const button = document.createElement("button");
  button.id = "mobile-video-play-control";
  button.type = "button";
  button.textContent = "Play background";
  button.setAttribute("aria-label", "Play the moving forest background");
  button.hidden = true;
  Object.assign(button.style, {
    position: "fixed",
    zIndex: "4",
    left: "50%",
    bottom: "calc(max(18px, env(safe-area-inset-bottom)) + 78px)",
    transform: "translateX(-50%)",
    minHeight: "40px",
    border: "1px solid rgba(255, 255, 255, 0.78)",
    borderRadius: "999px",
    background: "rgba(20, 54, 42, 0.88)",
    boxShadow: "0 6px 20px rgba(4, 24, 17, 0.32)",
    color: "#fffdf6",
    padding: "9px 14px",
    font: "600 0.84rem Lexend, system-ui, sans-serif",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    resumeAfterGesture();
  });
  document.body.append(button);
  playControl = button;
  return button;
}

function setPlayControlVisible(visible) {
  ensurePlayControl().hidden = !visible;
}

function removeGestureListeners() {
  if (!gestureListenersInstalled) return;
  gestureListenersInstalled = false;
  window.removeEventListener("pointerdown", resumeAfterGesture, true);
  window.removeEventListener("touchstart", resumeAfterGesture, true);
  window.removeEventListener("keydown", resumeAfterGesture, true);
}

function addGestureListeners() {
  if (gestureListenersInstalled) return;
  gestureListenersInstalled = true;
  window.addEventListener("pointerdown", resumeAfterGesture, {
    capture: true,
    passive: true,
  });
  window.addEventListener("touchstart", resumeAfterGesture, {
    capture: true,
    passive: true,
  });
  window.addEventListener("keydown", resumeAfterGesture, { capture: true });
}

function markVideoPlaying() {
  if (
    !(backgroundVideo instanceof HTMLVideoElement) ||
    !mobilePortrait?.matches ||
    backgroundVideo.paused
  ) {
    return;
  }
  terrain?.classList.add("is-photo-ready");
  document.documentElement.dataset.mobileBackground = "video-playing";
  document.documentElement.dataset.mobileVideoSource = fallbackAttempted
    ? "legacy-fallback"
    : "smooth-static";
  setPlayControlVisible(false);
  removeGestureListeners();
}

function useLegacyFallback(video) {
  if (fallbackAttempted) return false;
  fallbackAttempted = true;
  video.src = VIDEO_ASSET;
  video.load();
  return true;
}

function handleVideoError() {
  if (!(backgroundVideo instanceof HTMLVideoElement)) return;
  if (useLegacyFallback(backgroundVideo)) {
    requestPlayback(backgroundVideo);
    return;
  }
  document.documentElement.dataset.mobileBackground = "video-failed";
  setPlayControlVisible(false);
}

function ensureBackgroundVideo() {
  if (backgroundVideo instanceof HTMLVideoElement) return backgroundVideo;

  const existing = document.querySelector("#mobile-background-video");
  if (existing instanceof HTMLVideoElement) {
    backgroundVideo = existing;
    return backgroundVideo;
  }

  const video = document.createElement("video");
  video.id = "mobile-background-video";
  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.poster = POSTER_ASSET;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.setAttribute("autoplay", "");
  video.setAttribute("muted", "");
  video.setAttribute("loop", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("preload", "auto");
  video.setAttribute("aria-hidden", "true");
  video.setAttribute("tabindex", "-1");
  video.setAttribute("x-webkit-airplay", "deny");

  Object.assign(video.style, {
    position: "fixed",
    zIndex: "0",
    inset: "0",
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "50% 50%",
    opacity: "1",
    background: "#173f31",
    pointerEvents: "none",
    userSelect: "none",
    transform: "translate3d(0, 0, 0)",
    WebkitTransform: "translate3d(0, 0, 0)",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    contain: "strict",
  });

  video.addEventListener("playing", markVideoPlaying);
  video.addEventListener("timeupdate", markVideoPlaying);
  video.addEventListener("error", handleVideoError);
  video.src = SMOOTH_VIDEO_ASSET;
  backgroundVideo = video;

  if (pageShell instanceof HTMLElement) {
    pageShell.before(video);
  } else {
    document.body.append(video);
  }
  video.load();
  return video;
}

function requestPlayback(video) {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  document.documentElement.dataset.mobileBackground = "video-loading";

  let playback;
  try {
    playback = video.play();
  } catch {
    document.documentElement.dataset.mobileBackground =
      "video-awaiting-gesture";
    setPlayControlVisible(true);
    addGestureListeners();
    return;
  }

  if (playback && typeof playback.then === "function") {
    playback
      .then(markVideoPlaying)
      .catch(() => {
        document.documentElement.dataset.mobileBackground =
          "video-awaiting-gesture";
        setPlayControlVisible(true);
        addGestureListeners();
      });
  } else {
    markVideoPlaying();
  }
}

function startVideo() {
  if (!mobilePortrait?.matches || document.hidden) return;
  requestPlayback(ensureBackgroundVideo());
}

function stopVideo() {
  backgroundVideo?.pause();
  setPlayControlVisible(false);
  document.documentElement.dataset.mobileBackground = "poster-ready";
}

function resumeAfterGesture() {
  if (!mobilePortrait?.matches || document.hidden) return;
  requestPlayback(ensureBackgroundVideo());
}

mobilePortrait?.addEventListener?.("change", (event) => {
  if (event.matches) {
    addGestureListeners();
    startVideo();
  } else {
    removeGestureListeners();
    stopVideo();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopVideo();
  else startVideo();
});
window.addEventListener("pageshow", startVideo);
window.addEventListener("pagehide", () => backgroundVideo?.pause());

if (mobilePortrait?.matches) {
  ensurePlayControl();
  addGestureListeners();
  startVideo();
}

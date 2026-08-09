const MOBILE_BACKGROUND_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_ASSET =
  "/scenes/mobile-forest-stream-video-v4-1080.mp4";
const POSTER_ASSET = "/scenes/mobile-forest-stream-v1-540.webp";

const mobilePortrait = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
const backdropImage = document.querySelector("#photo-backdrop-image");
const terrain = document.querySelector("#terrain-background");
const pageShell = document.querySelector(".page-shell");

let backgroundVideo = null;
let gestureListenersInstalled = false;

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
  window.addEventListener("keydown", resumeAfterGesture, {
    capture: true,
  });
}

function showPoster(state = "poster-ready") {
  if (backgroundVideo instanceof HTMLVideoElement) {
    backgroundVideo.style.opacity = "0";
  }
  document.documentElement.dataset.mobileBackground = state;
}

function markVideoPlaying() {
  if (
    !(backgroundVideo instanceof HTMLVideoElement) ||
    !mobilePortrait?.matches
  ) {
    return;
  }

  backgroundVideo.style.opacity = "1";
  terrain?.classList.add("is-photo-ready");
  document.documentElement.dataset.mobileBackground = "video-playing";
  removeGestureListeners();
}

function ensureBackgroundVideo() {
  if (backgroundVideo instanceof HTMLVideoElement) {
    return backgroundVideo;
  }

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
  video.setAttribute("webkit-playsinline", "");
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
    opacity: "0",
    background: "#173f31",
    pointerEvents: "none",
    userSelect: "none",
    transition: "opacity 220ms ease",
    willChange: "opacity",
  });

  video.addEventListener("playing", markVideoPlaying);
  video.addEventListener("timeupdate", () => {
    if (video.currentTime > 0 && !video.paused) markVideoPlaying();
  });
  video.addEventListener("error", () => {
    showPoster("video-failed");
    addGestureListeners();
  });

  video.src = VIDEO_ASSET;
  backgroundVideo = video;

  if (pageShell instanceof HTMLElement) {
    pageShell.before(video);
  } else {
    document.body.append(video);
  }

  video.load();
  return video;
}

function startVideo() {
  if (!mobilePortrait?.matches || document.hidden) return;

  const video = ensureBackgroundVideo();
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  document.documentElement.dataset.mobileBackground = "video-loading";

  let playback;
  try {
    playback = video.play();
  } catch {
    showPoster("video-awaiting-gesture");
    addGestureListeners();
    return;
  }

  if (playback && typeof playback.then === "function") {
    playback
      .then(() => {
        if (!video.paused) markVideoPlaying();
      })
      .catch(() => {
        showPoster("video-awaiting-gesture");
        addGestureListeners();
      });
  } else if (!video.paused) {
    markVideoPlaying();
  }
}

function stopVideo() {
  if (backgroundVideo instanceof HTMLVideoElement) {
    backgroundVideo.pause();
  }
  showPoster("poster-ready");
}

function resumeAfterGesture() {
  if (!mobilePortrait?.matches || document.hidden) return;

  const video = ensureBackgroundVideo();
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;

  let playback;
  try {
    playback = video.play();
  } catch {
    showPoster("video-awaiting-gesture");
    return;
  }

  if (playback && typeof playback.then === "function") {
    playback
      .then(() => {
        if (!video.paused) markVideoPlaying();
      })
      .catch(() => showPoster("video-awaiting-gesture"));
  } else if (!video.paused) {
    markVideoPlaying();
  }
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
  if (document.hidden) {
    backgroundVideo?.pause();
  } else {
    startVideo();
  }
});

window.addEventListener("pageshow", startVideo);
window.addEventListener("pagehide", () => backgroundVideo?.pause());

if (mobilePortrait?.matches) {
  addGestureListeners();
  startVideo();
}

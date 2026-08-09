const MOBILE_BACKGROUND_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_ASSET = "/media/mobile-forest-stream-video-v11-1536.mp4";
const POSTER_ASSET = "/scenes/mobile-forest-stream-v11-1536.webp";

const mobilePortrait = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
const backgroundVideo = document.querySelector("#mobile-background-video");
const backdropImage = document.querySelector("#photo-backdrop-image");
const terrain = document.querySelector("#terrain-background");

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
  window.addEventListener("keydown", resumeAfterGesture, { capture: true });
}

function showPoster(state = "poster-ready") {
  backgroundVideo?.classList.remove("is-playing");
  document.documentElement.dataset.mobileBackground = state;
}

function markVideoPlaying() {
  if (
    !(backgroundVideo instanceof HTMLVideoElement) ||
    !mobilePortrait?.matches ||
    backgroundVideo.paused ||
    backgroundVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return;
  }
  backgroundVideo.classList.add("is-playing");
  terrain?.classList.add("is-photo-ready");
  document.documentElement.dataset.mobileBackground = "video-playing";
  removeGestureListeners();
}

function configureVideo() {
  if (!(backgroundVideo instanceof HTMLVideoElement)) return null;
  const video = backgroundVideo;
  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.poster = POSTER_ASSET;
  if (!video.getAttribute("src")) {
    video.src = VIDEO_ASSET;
  }
  return video;
}

function startVideo() {
  if (!mobilePortrait?.matches || document.hidden) return;
  const video = configureVideo();
  if (!video) {
    showPoster("video-missing");
    return;
  }
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
      .then(markVideoPlaying)
      .catch(() => {
        showPoster("video-awaiting-gesture");
        addGestureListeners();
      });
  } else {
    markVideoPlaying();
  }
}

function resumeAfterGesture() {
  startVideo();
}

if (backgroundVideo instanceof HTMLVideoElement) {
  for (const eventName of ["loadeddata", "canplay", "playing", "timeupdate"]) {
    backgroundVideo.addEventListener(eventName, markVideoPlaying);
  }
  backgroundVideo.addEventListener("error", () => {
    showPoster("video-failed");
    addGestureListeners();
  });
}

mobilePortrait?.addEventListener?.("change", (event) => {
  if (event.matches) {
    addGestureListeners();
    startVideo();
  } else {
    removeGestureListeners();
    backgroundVideo?.pause();
    showPoster("poster-ready");
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

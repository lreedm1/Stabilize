const MOBILE_VIDEO_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const MOBILE_VIDEO_URL =
  "/scenes/mobile-forest-stream-v1.mp4?v=20260808-forest-video-1";
const MOBILE_POSTER_URL = "/scenes/mobile-forest-stream-v1-540.webp";
const mobilePortrait = globalThis.matchMedia?.(MOBILE_VIDEO_QUERY);

let mobileVideo;

function setBackgroundState(state) {
  document.documentElement.dataset.mobileBackground = state;
}

function revealFallback() {
  const backdrop = document.querySelector("#photo-backdrop");
  if (backdrop instanceof HTMLElement) backdrop.style.opacity = "1";
  if (mobileVideo instanceof HTMLVideoElement) mobileVideo.style.opacity = "0";
}

function markVideoPlaying() {
  const backdrop = document.querySelector("#photo-backdrop");
  const terrain = document.querySelector("#terrain-background");

  if (!(mobileVideo instanceof HTMLVideoElement)) return;
  mobileVideo.style.opacity = "1";
  if (backdrop instanceof HTMLElement) backdrop.style.opacity = "0";
  terrain?.classList.add("is-photo-ready");
  setBackgroundState("video-playing");
}

async function ensureVideoPlayback() {
  if (!(mobileVideo instanceof HTMLVideoElement) || !mobilePortrait?.matches) {
    return;
  }

  mobileVideo.muted = true;
  mobileVideo.defaultMuted = true;

  try {
    await mobileVideo.play();
  } catch {
    revealFallback();
    setBackgroundState("video-waiting-for-interaction");
  }
}

function installMobileVideo() {
  if (!mobilePortrait?.matches || mobileVideo instanceof HTMLVideoElement) {
    return;
  }

  const backdrop = document.querySelector("#photo-backdrop");
  if (!(backdrop instanceof HTMLElement)) return;

  const video = document.createElement("video");
  mobileVideo = video;

  video.id = "mobile-background-video";
  video.className = "mobile-background-video";
  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.controls = false;
  video.disablePictureInPicture = true;
  video.poster = MOBILE_POSTER_URL;
  video.setAttribute("autoplay", "");
  video.setAttribute("muted", "");
  video.setAttribute("loop", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("aria-hidden", "true");
  video.setAttribute("tabindex", "-1");

  Object.assign(video.style, {
    position: "fixed",
    zIndex: "0",
    inset: "0",
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "50% 50%",
    background: "#173f31",
    contain: "strict",
    pointerEvents: "none",
    userSelect: "none",
    opacity: "0",
    transition: "opacity 350ms ease",
  });

  backdrop.style.transition = "opacity 350ms ease";
  backdrop.insertAdjacentElement("afterend", video);
  setBackgroundState("video-loading");

  video.addEventListener("playing", markVideoPlaying);
  video.addEventListener("error", () => {
    revealFallback();
    setBackgroundState("video-fallback");
  });

  video.src = MOBILE_VIDEO_URL;
  video.load();
  void ensureVideoPlayback();
}

function syncMobileVideo() {
  if (mobilePortrait?.matches) {
    installMobileVideo();
    void ensureVideoPlayback();
    return;
  }

  if (mobileVideo instanceof HTMLVideoElement) {
    mobileVideo.pause();
    mobileVideo.remove();
    mobileVideo = undefined;
  }
  revealFallback();
  delete document.documentElement.dataset.mobileBackground;
}

mobilePortrait?.addEventListener?.("change", syncMobileVideo);
window.addEventListener("pageshow", () => void ensureVideoPlayback());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void ensureVideoPlayback();
});

for (const eventName of ["pointerdown", "touchstart"]) {
  document.addEventListener(
    eventName,
    () => void ensureVideoPlayback(),
    { once: true, passive: true, capture: true },
  );
}

syncMobileVideo();

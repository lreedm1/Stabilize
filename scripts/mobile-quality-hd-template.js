const MOBILE_BACKGROUND_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_ASSET = "/media/mobile-forest-stream-video-v4-1080.mp4";
const SMOOTH_VIDEO_ASSET = "/scenes/mobile-forest-stream-video-v12-720.mp4";
const RETINA_VIDEO_ASSET =
  "/scenes/mobile-forest-stream-video-v14-retina-2160.mp4";
const RETINA_POSTER_ASSET =
  "/scenes/mobile-forest-stream-v14-retina-2160.webp";
const SD_POSTER_ASSET = "/scenes/mobile-forest-stream-v12-720.webp";

const mobilePortrait = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
const backdropImage = document.querySelector("#photo-backdrop-image");
const terrain = document.querySelector("#terrain-background");
const pageShell = document.querySelector(".page-shell");

let backgroundVideo = null;
let activeVideoAsset = RETINA_VIDEO_ASSET;
let activeVideoLabel = "retina-2160-autoplay";
let fallbackStep = 0;
let gestureListenersInstalled = false;
let autoplayRetryTimer = null;
let autoplayAttempts = 0;

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

function clearAutoplayRetry() {
  if (autoplayRetryTimer !== null) {
    clearTimeout(autoplayRetryTimer);
    autoplayRetryTimer = null;
  }
}

function scheduleAutoplayRetry(video) {
  if (!mobilePortrait?.matches || document.hidden) return;
  clearAutoplayRetry();
  const delay = Math.min(2000, 250 * 2 ** Math.min(autoplayAttempts, 3));
  autoplayAttempts += 1;
  autoplayRetryTimer = setTimeout(() => requestPlayback(video), delay);
}

function setVideoSource(video, asset, poster, label, step) {
  clearAutoplayRetry();
  activeVideoAsset = asset;
  activeVideoLabel = label;
  fallbackStep = step;
  video.poster = poster;
  document.documentElement.dataset.mobileVideoSource = label;

  const current = video.currentSrc || video.src || "";
  if (!current.endsWith(asset)) {
    video.src = asset;
    video.load();
  }
}

function useStandardFallback(video, reason = "decode-fallback") {
  if (activeVideoAsset === SMOOTH_VIDEO_ASSET) return false;
  document.documentElement.dataset.mobileVideoFallbackReason = reason;
  video.src = SMOOTH_VIDEO_ASSET;
  setVideoSource(
    video,
    SMOOTH_VIDEO_ASSET,
    SD_POSTER_ASSET,
    "smooth-720-fallback",
    1,
  );
  video.load();
  return true;
}

function useLegacyFallback(video) {
  if (activeVideoAsset === VIDEO_ASSET) return false;
  video.src = VIDEO_ASSET;
  setVideoSource(
    video,
    VIDEO_ASSET,
    SD_POSTER_ASSET,
    "legacy-worker-fallback",
    2,
  );
  video.load();
  return true;
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
  document.documentElement.dataset.mobileVideoSource =
    activeVideoLabel || "retina-2160-autoplay";
  document.documentElement.dataset.mobileVideoQuality =
    fallbackStep === 0 ? "retina" : "fallback";
  clearAutoplayRetry();
  autoplayAttempts = 0;
}

function handleVideoError() {
  if (!(backgroundVideo instanceof HTMLVideoElement)) return;
  if (useStandardFallback(backgroundVideo, "media-error")) {
    requestPlayback(backgroundVideo);
    return;
  }
  if (useLegacyFallback(backgroundVideo)) {
    requestPlayback(backgroundVideo);
    return;
  }
  document.documentElement.dataset.mobileBackground = "video-failed";
}

function configureVideo(video) {
  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
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

  if (video.dataset.stabilizeConfigured !== "true") {
    video.dataset.stabilizeConfigured = "true";
    video.addEventListener("playing", markVideoPlaying);
    video.addEventListener("timeupdate", markVideoPlaying);
    video.addEventListener("loadeddata", () => requestPlayback(video));
    video.addEventListener("canplay", () => requestPlayback(video));
    video.addEventListener("error", handleVideoError);
    video.addEventListener("pause", () => {
      if (mobilePortrait?.matches && !document.hidden) {
        scheduleAutoplayRetry(video);
      }
    });
    video.addEventListener("ended", () => requestPlayback(video));
  }

  const current = video.currentSrc || video.src || "";
  if (current.endsWith(RETINA_VIDEO_ASSET)) {
    activeVideoAsset = RETINA_VIDEO_ASSET;
    activeVideoLabel = "retina-2160-autoplay";
    fallbackStep = 0;
    video.poster = RETINA_POSTER_ASSET;
  } else if (current.endsWith(SMOOTH_VIDEO_ASSET)) {
    activeVideoAsset = SMOOTH_VIDEO_ASSET;
    activeVideoLabel = "smooth-720-fallback";
    fallbackStep = 1;
    video.poster = SD_POSTER_ASSET;
  } else if (current.endsWith(VIDEO_ASSET)) {
    activeVideoAsset = VIDEO_ASSET;
    activeVideoLabel = "legacy-worker-fallback";
    fallbackStep = 2;
    video.poster = SD_POSTER_ASSET;
  } else {
    video.src = RETINA_VIDEO_ASSET;
    setVideoSource(
      video,
      RETINA_VIDEO_ASSET,
      RETINA_POSTER_ASSET,
      "retina-2160-autoplay",
      0,
    );
    video.load();
  }
  return video;
}

function ensureBackgroundVideo() {
  if (backgroundVideo instanceof HTMLVideoElement) return backgroundVideo;

  const existing = document.querySelector("#mobile-background-video");
  if (existing instanceof HTMLVideoElement) {
    backgroundVideo = configureVideo(existing);
    return backgroundVideo;
  }

  const video = document.createElement("video");
  video.id = "mobile-background-video";
  video.className = "mobile-background-video";
  backgroundVideo = configureVideo(video);

  if (pageShell instanceof HTMLElement) {
    pageShell.before(video);
  } else {
    document.body.append(video);
  }
  return video;
}

function requestPlayback(video, fromGesture = false) {
  if (!mobilePortrait?.matches || document.hidden) return;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  document.documentElement.dataset.mobileBackground = "video-loading";

  let playback;
  try {
    playback = video.play();
  } catch {
    scheduleAutoplayRetry(video);
    return;
  }

  if (playback && typeof playback.then === "function") {
    playback
      .then(markVideoPlaying)
      .catch(() => {
        if (fromGesture) autoplayAttempts = 0;
        scheduleAutoplayRetry(video);
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
  clearAutoplayRetry();
  backgroundVideo?.pause();
  document.documentElement.dataset.mobileBackground = "poster-ready";
}

function resumeAfterGesture() {
  if (!mobilePortrait?.matches || document.hidden) return;
  autoplayAttempts = 0;
  requestPlayback(ensureBackgroundVideo(), true);
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

mobilePortrait?.addEventListener?.("change", (event) => {
  if (event.matches) startVideo();
  else stopVideo();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopVideo();
  else startVideo();
});
window.addEventListener("pageshow", startVideo);
window.addEventListener("focus", startVideo);
window.addEventListener("online", startVideo);
window.addEventListener("pagehide", () => backgroundVideo?.pause());

if (mobilePortrait?.matches) {
  addGestureListeners();
  startVideo();
}

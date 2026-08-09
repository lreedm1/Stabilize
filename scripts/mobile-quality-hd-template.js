const MOBILE_BACKGROUND_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_ASSET = "/media/mobile-forest-stream-video-v4-1080.mp4";
const SMOOTH_VIDEO_ASSET = "/scenes/mobile-forest-stream-video-v12-720.mp4";
const HD_VIDEO_ASSET = "/scenes/mobile-forest-stream-video-v13-1080.mp4";
const POSTER_ASSET = "/scenes/mobile-forest-stream-v13-1080.webp";
const SD_POSTER_ASSET = "/scenes/mobile-forest-stream-v12-720.webp";

const mobilePortrait = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
const reducedData = globalThis.matchMedia?.("(prefers-reduced-data: reduce)");
const backdropImage = document.querySelector("#photo-backdrop-image");
const terrain = document.querySelector("#terrain-background");
const pageShell = document.querySelector(".page-shell");

let backgroundVideo = null;
let activeVideoAsset = null;
let activeVideoLabel = null;
let fallbackStep = 0;
let gestureListenersInstalled = false;
let playControl = null;
let autoplayRetryTimer = null;
let autoplayAttempts = 0;
let cadenceCallback = null;
let cadenceWatchdog = null;
let cadenceFrames = 0;
let cadenceStartedAt = 0;

function prefersStandardDefinition() {
  return (
    globalThis.navigator?.connection?.saveData === true ||
    reducedData?.matches === true
  );
}

function preferredVideo() {
  return prefersStandardDefinition()
    ? {
        asset: SMOOTH_VIDEO_ASSET,
        poster: SD_POSTER_ASSET,
        label: "smooth-720-data-saver",
      }
    : {
        asset: HD_VIDEO_ASSET,
        poster: POSTER_ASSET,
        label: "hd-1080-autoplay",
      };
}

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

function clearAutoplayRetry() {
  if (autoplayRetryTimer !== null) {
    clearTimeout(autoplayRetryTimer);
    autoplayRetryTimer = null;
  }
}

function stopCadenceMonitor() {
  if (
    cadenceCallback !== null &&
    backgroundVideo instanceof HTMLVideoElement &&
    typeof backgroundVideo.cancelVideoFrameCallback === "function"
  ) {
    backgroundVideo.cancelVideoFrameCallback(cadenceCallback);
  }
  cadenceCallback = null;
  if (cadenceWatchdog !== null) clearTimeout(cadenceWatchdog);
  cadenceWatchdog = null;
  cadenceFrames = 0;
  cadenceStartedAt = 0;
}

function setVideoSource(video, asset, poster, label) {
  stopCadenceMonitor();
  clearAutoplayRetry();
  autoplayAttempts = 0;
  activeVideoAsset = asset;
  activeVideoLabel = label;
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
  fallbackStep = Math.max(fallbackStep, 1);
  document.documentElement.dataset.mobileVideoFallbackReason = reason;
  video.src = SMOOTH_VIDEO_ASSET;
  setVideoSource(
    video,
    SMOOTH_VIDEO_ASSET,
    SD_POSTER_ASSET,
    "smooth-720-fallback",
  );
  return true;
}

function useLegacyFallback(video) {
  if (activeVideoAsset === VIDEO_ASSET) return false;
  fallbackStep = 2;
  video.src = VIDEO_ASSET;
  setVideoSource(video, VIDEO_ASSET, SD_POSTER_ASSET, "legacy-worker-fallback");
  return true;
}

function evaluateCadence() {
  if (
    !(backgroundVideo instanceof HTMLVideoElement) ||
    activeVideoAsset !== HD_VIDEO_ASSET ||
    backgroundVideo.paused ||
    document.hidden
  ) {
    stopCadenceMonitor();
    return;
  }

  const elapsed = performance.now() - cadenceStartedAt;
  if (elapsed < 1800) return;

  const minimumFrames = Math.max(14, Math.floor((elapsed / 1000) * 8));
  if (cadenceFrames < minimumFrames) {
    const video = backgroundVideo;
    stopCadenceMonitor();
    if (useStandardFallback(video, "low-presented-frame-cadence")) {
      requestPlayback(video);
    }
    return;
  }

  document.documentElement.dataset.mobileVideoCadence = "healthy";
  stopCadenceMonitor();
}

function startCadenceMonitor() {
  stopCadenceMonitor();
  if (
    !(backgroundVideo instanceof HTMLVideoElement) ||
    activeVideoAsset !== HD_VIDEO_ASSET ||
    document.hidden
  ) {
    return;
  }

  cadenceStartedAt = performance.now();
  cadenceFrames = 0;

  if (typeof backgroundVideo.requestVideoFrameCallback === "function") {
    const countFrame = () => {
      if (
        !(backgroundVideo instanceof HTMLVideoElement) ||
        activeVideoAsset !== HD_VIDEO_ASSET ||
        backgroundVideo.paused ||
        document.hidden
      ) {
        stopCadenceMonitor();
        return;
      }
      cadenceFrames += 1;
      evaluateCadence();
      if (activeVideoAsset === HD_VIDEO_ASSET && cadenceStartedAt > 0) {
        cadenceCallback = backgroundVideo.requestVideoFrameCallback(countFrame);
      }
    };
    cadenceCallback = backgroundVideo.requestVideoFrameCallback(countFrame);
  } else {
    const initialFrames =
      backgroundVideo.getVideoPlaybackQuality?.().totalVideoFrames ??
      backgroundVideo.webkitDecodedFrameCount ??
      0;
    cadenceWatchdog = setTimeout(() => {
      if (!(backgroundVideo instanceof HTMLVideoElement)) return;
      const currentFrames =
        backgroundVideo.getVideoPlaybackQuality?.().totalVideoFrames ??
        backgroundVideo.webkitDecodedFrameCount ??
        initialFrames;
      cadenceFrames = Math.max(0, currentFrames - initialFrames);
      evaluateCadence();
    }, 2200);
    return;
  }

  cadenceWatchdog = setTimeout(evaluateCadence, 2200);
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
    activeVideoLabel || "unknown";
  setPlayControlVisible(false);
  removeGestureListeners();
  clearAutoplayRetry();
  autoplayAttempts = 0;
  if (activeVideoAsset === HD_VIDEO_ASSET) startCadenceMonitor();
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
  stopCadenceMonitor();
  document.documentElement.dataset.mobileBackground = "video-failed";
  setPlayControlVisible(false);
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
  }

  const preferred = preferredVideo();
  const current = video.currentSrc || video.src || "";
  if (current.endsWith(HD_VIDEO_ASSET) && !prefersStandardDefinition()) {
    activeVideoAsset = HD_VIDEO_ASSET;
    activeVideoLabel = "hd-1080-autoplay";
    video.poster = POSTER_ASSET;
  } else if (current.endsWith(SMOOTH_VIDEO_ASSET)) {
    activeVideoAsset = SMOOTH_VIDEO_ASSET;
    activeVideoLabel = prefersStandardDefinition()
      ? "smooth-720-data-saver"
      : "smooth-720-fallback";
    video.poster = SD_POSTER_ASSET;
  } else {
    setVideoSource(video, preferred.asset, preferred.poster, preferred.label);
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
  const preferred = preferredVideo();
  setVideoSource(video, preferred.asset, preferred.poster, preferred.label);

  if (pageShell instanceof HTMLElement) {
    pageShell.before(video);
  } else {
    document.body.append(video);
  }
  return video;
}

function scheduleAutoplayRetry(video) {
  clearAutoplayRetry();
  if (autoplayAttempts >= 2) {
    document.documentElement.dataset.mobileBackground =
      "video-awaiting-gesture";
    setPlayControlVisible(true);
    addGestureListeners();
    return;
  }
  autoplayAttempts += 1;
  autoplayRetryTimer = setTimeout(() => requestPlayback(video), 350);
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
    if (fromGesture) {
      setPlayControlVisible(true);
      addGestureListeners();
    } else {
      scheduleAutoplayRetry(video);
    }
    return;
  }

  if (playback && typeof playback.then === "function") {
    playback
      .then(markVideoPlaying)
      .catch(() => {
        if (fromGesture) {
          document.documentElement.dataset.mobileBackground =
            "video-awaiting-gesture";
          setPlayControlVisible(true);
          addGestureListeners();
        } else {
          scheduleAutoplayRetry(video);
        }
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
  stopCadenceMonitor();
  clearAutoplayRetry();
  backgroundVideo?.pause();
  setPlayControlVisible(false);
  document.documentElement.dataset.mobileBackground = "poster-ready";
}

function resumeAfterGesture() {
  if (!mobilePortrait?.matches || document.hidden) return;
  requestPlayback(ensureBackgroundVideo(), true);
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

reducedData?.addEventListener?.("change", () => {
  if (!(backgroundVideo instanceof HTMLVideoElement)) return;
  const preferred = preferredVideo();
  setVideoSource(
    backgroundVideo,
    preferred.asset,
    preferred.poster,
    preferred.label,
  );
  startVideo();
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

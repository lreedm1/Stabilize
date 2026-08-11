const MOBILE_QUERY =
  "(max-width: 980px), (hover: none) and (pointer: coarse)";
const VIDEO_ASSET =
  "/media/mobile-forest-stream-video-v24-native-1080.mp4";
const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v24-native-1080.webp?v=20260811-mobile-orientation-v26-1";

const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
const video = document.querySelector("#mobile-background-video");
let retryTimer = null;

function eligible() {
  return (
    mobile?.matches === true &&
    video instanceof HTMLVideoElement &&
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

  if (!(video.currentSrc || video.src || "").includes(VIDEO_ASSET)) {
    video.src = VIDEO_ASSET;
    video.load();
  }
}

function clearRetry() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

async function enforce() {
  if (!eligible()) return;
  configure();
  video.classList.remove("is-failed");
  video.classList.add("is-playing");
  document.documentElement.dataset.mobileBackground = "video-loading-v26";

  try {
    await video.play();
    video.classList.add("is-playing");
    video.classList.remove("is-autoplay-blocked", "is-failed");
    document.documentElement.dataset.mobileBackground = "video-playing";
    clearRetry();
  } catch (error) {
    video.classList.add("is-autoplay-blocked");
    document.documentElement.dataset.mobileBackground = "mobile-poster-v26";
    clearRetry();
    retryTimer = setTimeout(enforce, 900);
  }
}

function stopRetryOnly() {
  clearRetry();
}

if (video instanceof HTMLVideoElement) {
  for (const event of ["loadedmetadata", "loadeddata", "canplay", "pause", "ended"]) {
    video.addEventListener(event, () => {
      if (eligible()) enforce();
    });
  }
}

mobile?.addEventListener?.("change", (event) => {
  if (event.matches) enforce();
  else stopRetryOnly();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopRetryOnly();
  else enforce();
});

document.addEventListener("DOMContentLoaded", enforce, { once: true });
for (const event of ["load", "pageshow", "focus", "online", "resize", "orientationchange"]) {
  globalThis.addEventListener(event, enforce);
}
for (const event of ["pointerdown", "touchstart", "keydown"]) {
  globalThis.addEventListener(event, enforce, { capture: true, passive: event !== "keydown" });
}

configure();
enforce();

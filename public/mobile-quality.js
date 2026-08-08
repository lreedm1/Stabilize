const MOBILE_BACKGROUND_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_PARTS = Array.from(
  { length: 5 },
  (_, index) =>
    `/scenes/mobile-forest-stream-loop-v1.part${String(index).padStart(2, "0")}.b64`,
);
const EXPECTED_VIDEO_BYTES = 43_100;
const POSTER_ASSET = "/scenes/mobile-forest-stream-v1-540.webp";

const mobilePortrait = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
const backdropImage = document.querySelector("#photo-backdrop-image");
const terrain = document.querySelector("#terrain-background");
const pageShell = document.querySelector(".page-shell");

let backgroundVideo = null;
let videoObjectUrl = "";
let videoLoadPromise = null;

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
  window.removeEventListener("pointerdown", resumeAfterGesture, true);
  window.removeEventListener("touchstart", resumeAfterGesture, true);
  window.removeEventListener("keydown", resumeAfterGesture, true);
}

function addGestureListeners() {
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

function decodeVideoParts(encodedParts) {
  const encoded = encodedParts.join("").replace(/\s+/g, "");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (bytes.byteLength !== EXPECTED_VIDEO_BYTES) {
    throw new Error(
      `Unexpected mobile background video size: ${bytes.byteLength}`,
    );
  }

  const fileType = String.fromCharCode(...bytes.subarray(4, 8));
  if (fileType !== "ftyp") {
    throw new Error("Mobile background payload is not an MP4 file");
  }

  return bytes;
}

async function fetchVideoParts() {
  const responses = await Promise.all(
    VIDEO_PARTS.map((url) =>
      fetch(url, {
        cache: "force-cache",
        credentials: "same-origin",
      }),
    ),
  );

  for (const response of responses) {
    if (!response.ok) {
      throw new Error(
        `Mobile background payload request failed with ${response.status}`,
      );
    }
  }

  return Promise.all(responses.map((response) => response.text()));
}

function buildBackgroundVideo(bytes) {
  const blob = new Blob([bytes], { type: "video/mp4" });
  videoObjectUrl = URL.createObjectURL(blob);

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
  video.addEventListener("error", () => showPoster("video-failed"));
  video.src = videoObjectUrl;

  if (pageShell instanceof HTMLElement) {
    pageShell.before(video);
  } else {
    document.body.append(video);
  }

  video.load();
  return video;
}

async function ensureBackgroundVideo() {
  if (backgroundVideo instanceof HTMLVideoElement) {
    return backgroundVideo;
  }

  if (!videoLoadPromise) {
    document.documentElement.dataset.mobileBackground = "video-loading";
    videoLoadPromise = fetchVideoParts()
      .then(decodeVideoParts)
      .then((bytes) => {
        backgroundVideo = buildBackgroundVideo(bytes);
        return backgroundVideo;
      })
      .catch((error) => {
        videoLoadPromise = null;
        showPoster("video-failed");
        console.warn("Mobile background video could not load.", error);
        throw error;
      });
  }

  return videoLoadPromise;
}

async function startVideo() {
  if (!mobilePortrait?.matches || document.hidden) return;

  try {
    const video = await ensureBackgroundVideo();
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    const playback = video.play();
    if (playback && typeof playback.then === "function") {
      await playback;
    }
    if (!video.paused) markVideoPlaying();
  } catch {
    showPoster("video-awaiting-gesture");
    addGestureListeners();
  }
}

function stopVideo() {
  if (backgroundVideo instanceof HTMLVideoElement) {
    backgroundVideo.pause();
  }
  showPoster("poster-ready");
}

function resumeAfterGesture() {
  void startVideo();
}

mobilePortrait?.addEventListener?.("change", (event) => {
  if (event.matches) {
    void startVideo();
  } else {
    stopVideo();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    backgroundVideo?.pause();
  } else {
    void startVideo();
  }
});

window.addEventListener("pageshow", () => void startVideo());
window.addEventListener("pagehide", (event) => {
  backgroundVideo?.pause();
  if (!event.persisted && videoObjectUrl) {
    URL.revokeObjectURL(videoObjectUrl);
  }
});

if (mobilePortrait?.matches) {
  addGestureListeners();
  void startVideo();
}

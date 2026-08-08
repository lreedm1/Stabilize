const MOBILE_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_URL =
  "/scenes/mobile-forest-stream-v1.mp4?v=20260808-uploaded-forest-video-1";

function styleVideo(video) {
  Object.assign(video.style, {
    position: "fixed",
    inset: "0",
    zIndex: "0",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "50% 50%",
    pointerEvents: "none",
    userSelect: "none",
    opacity: "0",
    transition: "opacity 220ms ease",
  });
}

function revealVideo(video, backdrop) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  video.style.opacity = "1";
  backdrop?.classList.add("video-active");
}

function keepPoster(backdrop) {
  backdrop?.classList.remove("video-active");
}

export function configureMobileForestVideo(target = globalThis.window) {
  const document = target?.document;
  const matchMedia = target?.matchMedia?.bind(target);
  if (!document || !matchMedia || !matchMedia(MOBILE_QUERY).matches) {
    return null;
  }

  const backdrop = document.querySelector("#photo-backdrop");
  if (!backdrop) return null;

  let video = document.querySelector("#mobile-background-video");
  if (!(video instanceof target.HTMLVideoElement)) {
    video = document.createElement("video");
    video.id = "mobile-background-video";
    video.className = "mobile-background-video";
    video.autoplay = true;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("aria-hidden", "true");
    video.setAttribute("disablepictureinpicture", "");
    video.tabIndex = -1;
    styleVideo(video);

    video.addEventListener("loadeddata", () => revealVideo(video, backdrop));
    video.addEventListener("playing", () => revealVideo(video, backdrop));
    video.addEventListener("error", () => keepPoster(backdrop));

    backdrop.insertAdjacentElement("afterend", video);
  }

  if (!video.src) {
    video.src = VIDEO_URL;
    video.load();
  }

  const tryPlay = () => {
    video.muted = true;
    video.defaultMuted = true;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => keepPoster(backdrop));
    }
  };

  tryPlay();
  for (const eventName of ["pointerdown", "touchstart", "keydown"]) {
    document.addEventListener(eventName, tryPlay, {
      once: true,
      passive: eventName !== "keydown",
    });
  }
  target.addEventListener("pageshow", tryPlay);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tryPlay();
  });

  return video;
}

configureMobileForestVideo();

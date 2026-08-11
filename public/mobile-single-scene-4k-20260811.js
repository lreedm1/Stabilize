(() => {
  const isTouchDevice =
    (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in globalThis;
  if (!isTouchDevice) return;

  const VIDEO_ASSET =
    "/scenes/mobile-forest-stream-video-v14-retina-2160.mp4";
  const POSTER_ASSET =
    "/scenes/mobile-forest-stream-v14-retina-2160.webp";
  const ROOT_CLASS = "mobile-single-scene-4k";
  const VIDEO_ID = "mobile-single-scene-video-4k";

  document.documentElement.classList.add(ROOT_CLASS);

  const style = document.createElement("style");
  style.id = "mobile-single-scene-4k-style";
  style.textContent = `
    html.${ROOT_CLASS} #terrain-background,
    html.${ROOT_CLASS} #photo-backdrop,
    html.${ROOT_CLASS} #photo-background,
    html.${ROOT_CLASS} #mobile-motion-canvas,
    html.${ROOT_CLASS} #mobile-background-video,
    html.${ROOT_CLASS} #mobile-background-video-4k {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
    }

    html.${ROOT_CLASS} #${VIDEO_ID} {
      position: fixed !important;
      inset: 0 !important;
      z-index: 0 !important;
      display: block !important;
      width: 100vw !important;
      height: 100dvh !important;
      min-width: 100vw !important;
      min-height: 100dvh !important;
      object-fit: cover !important;
      object-position: 50% 50% !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: none !important;
      user-select: none !important;
      background: #173f31 url("${POSTER_ASSET}") 50% 50% / cover no-repeat !important;
      transform: translate3d(0, 0, 0) !important;
      -webkit-transform: translate3d(0, 0, 0) !important;
      backface-visibility: hidden !important;
      -webkit-backface-visibility: hidden !important;
    }

    html.${ROOT_CLASS} .page-shell {
      position: relative !important;
      z-index: 20 !important;
      display: flex !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
    }

    html.${ROOT_CLASS} .site-header,
    html.${ROOT_CLASS} .chat-card,
    html.${ROOT_CLASS} .conversation-surface,
    html.${ROOT_CLASS} .composer-dock {
      position: relative !important;
      z-index: 21 !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
  `;
  document.head.append(style);

  const enforceUiLayer = () => {
    const shell = document.querySelector(".page-shell");
    if (shell instanceof HTMLElement) {
      shell.style.setProperty("position", "relative", "important");
      shell.style.setProperty("z-index", "20", "important");
      shell.style.setProperty("display", "flex", "important");
      shell.style.setProperty("visibility", "visible", "important");
      shell.style.setProperty("opacity", "1", "important");
      shell.style.setProperty("pointer-events", "auto", "important");
    }
  };

  let video = document.getElementById(VIDEO_ID);
  if (!(video instanceof HTMLVideoElement)) {
    video = document.createElement("video");
    video.id = VIDEO_ID;
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
    video.src = VIDEO_ASSET;
    document.body.prepend(video);
  }

  const oldVideo = document.getElementById("mobile-background-video");
  if (oldVideo instanceof HTMLVideoElement) {
    try { oldVideo.pause(); } catch {}
  }

  const play = () => {
    enforceUiLayer();
    if (!(video instanceof HTMLVideoElement) || document.hidden) return;
    video.muted = true;
    video.defaultMuted = true;
    video.play().catch(() => {});
  };

  for (const event of ["pageshow", "focus", "online", "resize", "orientationchange"]) {
    globalThis.addEventListener(event, play);
  }
  globalThis.visualViewport?.addEventListener("resize", enforceUiLayer);
  globalThis.visualViewport?.addEventListener("scroll", enforceUiLayer);
  document.addEventListener("DOMContentLoaded", enforceUiLayer, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      try { video.pause(); } catch {}
    } else {
      play();
    }
  });

  document.documentElement.dataset.mobileVideoSource = "retina-4k-single-scene";
  document.documentElement.dataset.mobileVideoQuality = "native-2160x3840";
  enforceUiLayer();
  play();
})();

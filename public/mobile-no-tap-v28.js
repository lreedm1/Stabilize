(() => {
  "use strict";

  const MOBILE_QUERY =
    "(max-width: 980px), (hover: none) and (pointer: coarse)";
  const VIDEO_ASSET =
    "/media/mobile-forest-stream-video-v24-native-1080.mp4";
  const STATE_ATTRIBUTE = "data-mobile-no-tap-v28";
  const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
  const video = document.querySelector("#mobile-background-video");
  const canvas = document.querySelector("#mobile-motion-canvas");

  let retryTimer = null;
  let firstFrameShown = false;
  let frameRequest = null;

  function isMobile() {
    return mobile?.matches === true;
  }

  function setState(state, error = null) {
    document.documentElement.setAttribute(STATE_ATTRIBUTE, state);
    if (error && typeof error.name === "string") {
      document.documentElement.dataset.mobileNoTapError = error.name;
    } else {
      delete document.documentElement.dataset.mobileNoTapError;
    }
  }

  function showFallback() {
    if (canvas instanceof HTMLCanvasElement) {
      canvas.style.setProperty("position", "fixed", "important");
      canvas.style.setProperty("z-index", "1", "important");
      canvas.style.setProperty("inset", "0", "important");
      canvas.style.setProperty("display", "block", "important");
      canvas.style.setProperty("visibility", "visible", "important");
      canvas.style.setProperty("opacity", "1", "important");
      canvas.style.setProperty("pointer-events", "none", "important");
    }

    if (video instanceof HTMLVideoElement) {
      video.style.setProperty("z-index", "2", "important");
      video.style.setProperty("visibility", "hidden", "important");
      video.style.setProperty("opacity", "0", "important");
      video.style.setProperty("pointer-events", "none", "important");
    }

    firstFrameShown = false;
  }

  function showVideoFrame() {
    if (!(video instanceof HTMLVideoElement) || !isMobile()) return;
    if (video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    firstFrameShown = true;
    video.style.setProperty("visibility", "visible", "important");
    video.style.setProperty("opacity", "1", "important");

    if (canvas instanceof HTMLCanvasElement) {
      canvas.style.setProperty("visibility", "hidden", "important");
      canvas.style.setProperty("opacity", "0", "important");
    }

    setState("playing");
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function revealAfterDecodedFrame() {
    if (!(video instanceof HTMLVideoElement)) return;

    if (typeof video.requestVideoFrameCallback === "function") {
      if (frameRequest !== null) return;
      frameRequest = video.requestVideoFrameCallback(() => {
        frameRequest = null;
        showVideoFrame();
      });
      return;
    }

    requestAnimationFrame(() => requestAnimationFrame(showVideoFrame));
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
    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "true");
    video.setAttribute("preload", "auto");
    video.setAttribute("x-webkit-airplay", "deny");

    const current = video.currentSrc || video.src || "";
    if (!current.includes(VIDEO_ASSET)) {
      video.src = VIDEO_ASSET;
      video.load();
    }
  }

  function scheduleRetry() {
    if (!isMobile() || document.hidden || firstFrameShown) return;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = setTimeout(attemptPlayback, 1200);
  }

  async function attemptPlayback() {
    if (
      !isMobile() ||
      document.hidden ||
      !(video instanceof HTMLVideoElement)
    ) {
      return;
    }

    configure();
    showFallback();
    setState("attempting");

    try {
      const result = video.play();
      if (result && typeof result.then === "function") await result;
      revealAfterDecodedFrame();
    } catch (error) {
      showFallback();
      setState("fallback", error);
      scheduleRetry();
    }
  }

  function handlePause() {
    if (!isMobile() || document.hidden) return;
    showFallback();
    setState("fallback");
    scheduleRetry();
  }

  if (!(video instanceof HTMLVideoElement) || !isMobile()) return;

  showFallback();
  configure();
  setState("fallback");

  video.addEventListener("playing", revealAfterDecodedFrame);
  video.addEventListener("timeupdate", () => {
    if (video.currentTime > 0) revealAfterDecodedFrame();
  });
  video.addEventListener("loadeddata", attemptPlayback);
  video.addEventListener("canplay", attemptPlayback);
  video.addEventListener("pause", handlePause);
  video.addEventListener("ended", attemptPlayback);
  video.addEventListener("error", () => {
    showFallback();
    setState("fallback");
  });

  const fallbackObserver = new MutationObserver(() => {
    if (!firstFrameShown) showFallback();
  });
  if (canvas instanceof HTMLCanvasElement) {
    fallbackObserver.observe(canvas, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }

  mobile?.addEventListener?.("change", (event) => {
    if (event.matches) attemptPlayback();
    else showFallback();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (retryTimer !== null) clearTimeout(retryTimer);
      showFallback();
    } else {
      attemptPlayback();
    }
  });

  for (const event of ["DOMContentLoaded", "pageshow", "focus", "online"]) {
    globalThis.addEventListener(event, attemptPlayback);
  }
  globalThis.addEventListener("orientationchange", () => {
    setTimeout(attemptPlayback, 0);
  });

  // This first request occurs synchronously while the parser is still beside
  // the muted inline video element. A host WebView may still reject autoplay;
  // in that case the independently animated canvas remains visible.
  attemptPlayback();
})();

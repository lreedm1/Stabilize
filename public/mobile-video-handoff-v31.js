(() => {
  "use strict";

  const VERSION = "20260813-mobile-video-handoff-v31-1";
  const MOBILE_QUERY = "(hover: none) and (pointer: coarse)";
  const VIDEO_ASSET =
    `/media/mobile-forest-stream-video-v24-native-1080.mp4?v=${VERSION}`;
  const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
  const root = document.documentElement;
  const video = document.querySelector("#mobile-background-video");
  const canvas = document.querySelector("#mobile-background-v30");

  if (
    mobile?.matches !== true ||
    !(video instanceof HTMLVideoElement) ||
    !(canvas instanceof HTMLCanvasElement)
  ) {
    return;
  }

  let decodedFrameRequest = null;
  let playbackRetry = null;
  let stallTimer = null;
  let lastTime = 0;
  let lastAdvanceAt = performance.now();
  let nativeVisible = false;

  function setState(state, detail = "") {
    root.dataset.mobileVideoHandoffV31 = state;
    root.dataset.mobileVideoHandoffV31Version = VERSION;
    if (detail) root.dataset.mobileVideoHandoffV31Detail = detail;
    else delete root.dataset.mobileVideoHandoffV31Detail;
  }

  function configureVideo() {
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

    const absoluteAsset = new URL(VIDEO_ASSET, location.href).href;
    const source = video.querySelector("source");
    if (source instanceof HTMLSourceElement) {
      if (source.src !== absoluteAsset) {
        source.src = VIDEO_ASSET;
        video.load();
      }
    } else if (video.src !== absoluteAsset) {
      video.src = VIDEO_ASSET;
      video.load();
    }
  }

  function keepFallbackVisible(detail = "fallback") {
    if (nativeVisible) return;
    canvas.style.setProperty("display", "block", "important");
    canvas.style.setProperty("visibility", "visible", "important");
    canvas.style.setProperty("opacity", "1", "important");
    video.style.setProperty("display", "block", "important");
    video.style.setProperty("visibility", "hidden", "important");
    video.style.setProperty("opacity", "0", "important");
    setState("fallback", detail);
  }

  function revealNativeFrame() {
    if (
      document.hidden ||
      video.paused ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth < 2000 ||
      video.videoHeight < 3000
    ) {
      return;
    }

    nativeVisible = true;
    video.style.setProperty("display", "block", "important");
    video.style.setProperty("visibility", "visible", "important");
    video.style.setProperty("opacity", "1", "important");
    canvas.style.setProperty("opacity", "0", "important");
    canvas.style.setProperty("visibility", "hidden", "important");

    root.dataset.mobileBackgroundV30 = "video";
    root.dataset.mobileBackgroundV30Quality = "native-video-2160x3840-24fps";
    setState("video", `${video.videoWidth}x${video.videoHeight}`);

    if (playbackRetry !== null) {
      clearTimeout(playbackRetry);
      playbackRetry = null;
    }
  }

  function requestDecodedFrameReveal() {
    if (nativeVisible || video.paused) return;

    if (typeof video.requestVideoFrameCallback === "function") {
      if (decodedFrameRequest !== null) return;
      decodedFrameRequest = video.requestVideoFrameCallback(() => {
        decodedFrameRequest = null;
        revealNativeFrame();
      });
      return;
    }

    requestAnimationFrame(() => requestAnimationFrame(revealNativeFrame));
  }

  function scheduleRetry(delay = 1200) {
    if (nativeVisible || document.hidden || playbackRetry !== null) return;
    playbackRetry = setTimeout(() => {
      playbackRetry = null;
      attemptPlayback("retry");
    }, delay);
  }

  function observePlayPromise(result, reason) {
    if (!result || typeof result.then !== "function") {
      requestDecodedFrameReveal();
      return;
    }

    result.then(requestDecodedFrameReveal).catch((error) => {
      keepFallbackVisible(error?.name || reason);
      scheduleRetry();
    });
  }

  function attemptPlayback(reason = "automatic") {
    if (document.hidden || nativeVisible) return;
    configureVideo();
    setState("attempting", reason);
    try {
      observePlayPromise(video.play(), reason);
    } catch (error) {
      keepFallbackVisible(error?.name || reason);
      scheduleRetry();
    }
  }

  // This must remain synchronous. WebKit can consume transient user activation
  // before a Promise, timeout, animation frame, or async function resumes.
  function playInsideUserGesture() {
    if (nativeVisible || document.hidden) return;
    configureVideo();
    setState("gesture-attempt", "direct-play");
    try {
      const result = video.play();
      observePlayPromise(result, "gesture");
    } catch (error) {
      keepFallbackVisible(error?.name || "gesture");
    }
  }

  function monitorProgress() {
    const now = performance.now();
    const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    if (current > lastTime + 0.01) {
      lastTime = current;
      lastAdvanceAt = now;
      requestDecodedFrameReveal();
    }

    if (
      nativeVisible &&
      !document.hidden &&
      (video.paused || now - lastAdvanceAt > 1800)
    ) {
      nativeVisible = false;
      keepFallbackVisible(video.paused ? "paused" : "stalled");
      scheduleRetry(250);
    }

    stallTimer = setTimeout(monitorProgress, 500);
  }

  configureVideo();
  keepFallbackVisible("initializing");

  video.addEventListener("playing", requestDecodedFrameReveal);
  video.addEventListener("loadeddata", requestDecodedFrameReveal);
  video.addEventListener("canplay", requestDecodedFrameReveal);
  video.addEventListener("timeupdate", requestDecodedFrameReveal);
  video.addEventListener("waiting", () => {
    if (!nativeVisible) keepFallbackVisible("waiting");
  });
  video.addEventListener("stalled", () => {
    if (!nativeVisible) keepFallbackVisible("stalled");
  });
  video.addEventListener("error", () => {
    nativeVisible = false;
    const mediaError = video.error?.code
      ? `media-error-${video.error.code}`
      : "media-error";
    keepFallbackVisible(mediaError);
    scheduleRetry(500);
  });
  video.addEventListener("ended", () => attemptPlayback("ended"));

  // Capture before the application consumes the event. Pointer and touch are
  // both registered because embedded iOS browsers do not expose them uniformly.
  for (const type of ["pointerdown", "touchstart", "click", "keydown"]) {
    document.addEventListener(type, playInsideUserGesture, {
      capture: true,
      passive: type !== "keydown",
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (playbackRetry !== null) clearTimeout(playbackRetry);
      playbackRetry = null;
      return;
    }
    attemptPlayback("visibility");
  });
  globalThis.addEventListener("pageshow", () => attemptPlayback("pageshow"));
  globalThis.addEventListener("focus", () => attemptPlayback("focus"));
  globalThis.addEventListener("online", () => attemptPlayback("online"));
  globalThis.addEventListener("orientationchange", () => {
    setTimeout(() => attemptPlayback("orientation"), 0);
  });
  globalThis.addEventListener("pagehide", () => {
    if (stallTimer !== null) clearTimeout(stallTimer);
  });

  // Try while the parser is still near the video. The gesture listener remains
  // the authoritative recovery path in webviews that require interaction.
  attemptPlayback("parser");
  monitorProgress();
})();

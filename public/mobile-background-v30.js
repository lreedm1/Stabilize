(() => {
  "use strict";

  const VERSION = "20260813-mobile-background-v31-1";
  const MOBILE_QUERY = "(max-width: 980px) and (orientation: portrait)";
  const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
  const VIDEO_ASSET =
    "/media/mobile-forest-stream-video-v24-native-1080.mp4?v=" + VERSION;
  const ATLAS_ASSET =
    "/scenes/mobile-forest-stream-full-atlas-v29-1080.webp?v=" + VERSION;

  const FRAME_WIDTH = 1080;
  const FRAME_HEIGHT = 1920;
  const FRAME_COLUMNS = 4;
  const FRAME_COUNT = 8;
  const SOURCE_FPS = 8;
  const START_FRAME = 4;
  const MAX_PIXEL_RATIO = 3;

  const root = document.documentElement;
  const video = document.querySelector("#mobile-background-video");
  const canvas = document.querySelector("#mobile-background-v30");
  const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
  const reducedMotion = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);

  if (
    mobile?.matches !== true ||
    !(video instanceof HTMLVideoElement) ||
    !(canvas instanceof HTMLCanvasElement)
  ) {
    return;
  }

  let context = null;
  let atlas = null;
  let animationFrame = null;
  let fallbackStartedAt = performance.now();
  let fallbackReady = false;
  let videoReady = false;
  let playInFlight = null;
  let gestureRecoveryBound = false;

  function motionEligible() {
    return (
      mobile?.matches === true &&
      reducedMotion?.matches !== true &&
      !document.hidden
    );
  }

  function setState(state, detail = "") {
    root.dataset.mobileBackgroundV30 = state;
    root.dataset.mobileBackgroundV30Version = VERSION;
    if (detail) root.dataset.mobileBackgroundV30Detail = detail;
    else delete root.dataset.mobileBackgroundV30Detail;
  }

  function setQuality(value) {
    root.dataset.mobileBackgroundV30Quality = value;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(
      1,
      Math.round(rect.width || document.documentElement.clientWidth || innerWidth || 1),
    );
    const cssHeight = Math.max(
      1,
      Math.round(rect.height || innerHeight || document.documentElement.clientHeight || 1),
    );
    const pixelRatio = Math.max(
      1,
      Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO),
    );
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { cssWidth, cssHeight, pixelRatio };
  }

  function drawAtlasFrame(index, alpha, size) {
    const column = index % FRAME_COLUMNS;
    const row = Math.floor(index / FRAME_COLUMNS);
    const sourceX = column * FRAME_WIDTH;
    const sourceY = row * FRAME_HEIGHT;
    const scale = Math.max(
      size.cssWidth / FRAME_WIDTH,
      size.cssHeight / FRAME_HEIGHT,
    );
    const destinationWidth = FRAME_WIDTH * scale;
    const destinationHeight = FRAME_HEIGHT * scale;
    const destinationX = (size.cssWidth - destinationWidth) / 2;
    const destinationY = (size.cssHeight - destinationHeight) / 2;

    context.globalAlpha = alpha;
    context.drawImage(
      atlas,
      sourceX,
      sourceY,
      FRAME_WIDTH,
      FRAME_HEIGHT,
      destinationX,
      destinationY,
      destinationWidth,
      destinationHeight,
    );
  }

  function drawFallback(now) {
    animationFrame = null;
    if (!motionEligible() || videoReady || !context || !atlas) return;

    const size = resizeCanvas();
    context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const elapsed = Math.max(0, now - fallbackStartedAt) / 1000;
    const position = (START_FRAME + elapsed * SOURCE_FPS) % FRAME_COUNT;
    const current = Math.floor(position);
    const next = (current + 1) % FRAME_COUNT;
    const linearBlend = position - current;
    const blend = linearBlend * linearBlend * (3 - 2 * linearBlend);

    context.globalAlpha = 1;
    context.clearRect(0, 0, size.cssWidth, size.cssHeight);
    drawAtlasFrame(current, 1, size);
    drawAtlasFrame(next, blend, size);
    context.globalAlpha = 1;

    if (!fallbackReady) {
      fallbackReady = true;
      canvas.classList.add("is-ready");
    }
    setQuality("interpolated-atlas-canvas2d");
    setState("fallback", "display-refresh-canvas2d");
    animationFrame = requestAnimationFrame(drawFallback);
  }

  function startFallback() {
    if (!motionEligible() || videoReady || !context || !atlas) return;
    fallbackStartedAt = performance.now();
    if (animationFrame === null) {
      animationFrame = requestAnimationFrame(drawFallback);
    }
  }

  function stopFallback() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  async function loadFallback() {
    if (!motionEligible()) return;
    setState("loading", "atlas");
    try {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "high";
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Unable to load the mobile atlas"));
      });
      image.src = ATLAS_ASSET;
      await loaded;
      try {
        await image.decode?.();
      } catch {
        // The load event already proves the image is drawable.
      }
      atlas = image;
      context = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
      });
      if (!context) throw new Error("Canvas 2D is unavailable");
      startFallback();
    } catch (error) {
      console.warn("mobile background fallback failed", error);
      setState("poster", "fallback-load-failed");
    }
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

    if (!video.getAttribute("src")) {
      video.src = VIDEO_ASSET;
      video.load();
    }
  }

  function removeGestureRecovery() {
    if (!gestureRecoveryBound) return;
    gestureRecoveryBound = false;
    globalThis.removeEventListener("pointerdown", recoverFromGesture, true);
    globalThis.removeEventListener("touchstart", recoverFromGesture, true);
    globalThis.removeEventListener("keydown", recoverFromGesture, true);
  }

  function recoverFromGesture() {
    attemptPlayback("user-gesture");
  }

  function bindGestureRecovery() {
    if (gestureRecoveryBound) return;
    gestureRecoveryBound = true;
    globalThis.addEventListener("pointerdown", recoverFromGesture, {
      capture: true,
      passive: true,
    });
    globalThis.addEventListener("touchstart", recoverFromGesture, {
      capture: true,
      passive: true,
    });
    globalThis.addEventListener("keydown", recoverFromGesture, {
      capture: true,
    });
  }

  function revealVideo() {
    if (
      video.paused ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !motionEligible()
    ) {
      return false;
    }

    videoReady = true;
    removeGestureRecovery();
    stopFallback();
    setQuality("native-video-2160x3840-24fps");
    setState("video", "decoded-playing-frame");
    return true;
  }

  function scheduleReveal() {
    if (video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => revealVideo());
    } else {
      requestAnimationFrame(() => revealVideo());
    }
  }

  function handlePlaybackFailure(error, reason) {
    const name = error instanceof Error ? error.name : "PlaybackRejected";
    root.dataset.mobileBackgroundV30PlaybackError = name;
    videoReady = false;
    setState(fallbackReady ? "fallback" : "loading", reason + "-" + name);
    startFallback();
    bindGestureRecovery();
  }

  function attemptPlayback(reason = "unspecified") {
    if (!motionEligible() || videoReady) return playInFlight;
    if (playInFlight) return playInFlight;
    configureVideo();

    let result;
    try {
      result = video.play();
    } catch (error) {
      handlePlaybackFailure(error, reason);
      return null;
    }

    playInFlight = Promise.resolve(result)
      .then(() => {
        if (!video.paused) scheduleReveal();
      })
      .catch((error) => handlePlaybackFailure(error, reason))
      .finally(() => {
        playInFlight = null;
      });
    return playInFlight;
  }

  function handleMotionChange() {
    if (!motionEligible()) {
      stopFallback();
      videoReady = false;
      try {
        video.pause();
      } catch {}
      setState("poster", reducedMotion?.matches ? "reduced-motion" : "inactive");
      return;
    }
    startFallback();
    attemptPlayback("motion-change");
  }

  setState("poster", "initial-paint");
  configureVideo();

  if (!motionEligible()) {
    try {
      video.pause();
    } catch {}
    setState("poster", reducedMotion?.matches ? "reduced-motion" : "inactive");
    return;
  }

  loadFallback();

  video.addEventListener("playing", scheduleReveal);
  video.addEventListener("loadeddata", scheduleReveal);
  video.addEventListener("canplay", () => attemptPlayback("canplay"));
  video.addEventListener("timeupdate", () => {
    if (video.currentTime > 0) scheduleReveal();
  });
  video.addEventListener("pause", () => {
    if (!document.hidden && motionEligible()) {
      videoReady = false;
      startFallback();
      setTimeout(() => attemptPlayback("pause-retry"), 1200);
    }
  });
  video.addEventListener("error", () => {
    videoReady = false;
    setState(fallbackReady ? "fallback" : "loading", "video-error");
    startFallback();
    bindGestureRecovery();
  });
  for (const event of ["waiting", "stalled"]) {
    video.addEventListener(event, () => {
      if (!videoReady) startFallback();
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopFallback();
      return;
    }
    if (!videoReady) startFallback();
    attemptPlayback("visibilitychange");
  });

  for (const event of ["pageshow", "focus", "online"]) {
    globalThis.addEventListener(event, () => {
      if (!videoReady) startFallback();
      attemptPlayback(event);
    });
  }

  globalThis.addEventListener("resize", () => {
    resizeCanvas();
    if (!videoReady) startFallback();
  });
  globalThis.addEventListener("orientationchange", () => {
    setTimeout(handleMotionChange, 0);
  });

  mobile?.addEventListener?.("change", handleMotionChange);
  reducedMotion?.addEventListener?.("change", handleMotionChange);

  if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    scheduleReveal();
  }
  attemptPlayback("initial");
})();

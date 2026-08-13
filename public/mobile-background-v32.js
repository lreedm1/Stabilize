(() => {
  "use strict";

  const VERSION = "20260813-mobile-performance-v32-1";
  const MOBILE_QUERY = "(max-width: 980px) and (orientation: portrait)";
  const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
  const VIDEO_ASSET =
    "/scenes/mobile-forest-stream-video-v12-720.mp4?v=" + VERSION;

  const root = document.documentElement;
  const video = document.querySelector("#mobile-background-video");
  const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
  const reducedMotion = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);

  if (mobile?.matches !== true || !(video instanceof HTMLVideoElement)) {
    return;
  }

  let playInFlight = null;
  let frameCheckPending = false;
  let gestureRecoveryBound = false;
  let revealed = false;
  let retryTimer = null;

  function motionEligible() {
    return (
      mobile?.matches === true &&
      reducedMotion?.matches !== true &&
      !document.hidden
    );
  }

  function setState(state, detail = "") {
    root.dataset.mobileBackgroundV32 = state;
    root.dataset.mobileBackgroundV32Version = VERSION;
    root.dataset.mobileBackgroundV32Quality = "direct-static-720x1280-24fps";
    if (detail) root.dataset.mobileBackgroundV32Detail = detail;
    else delete root.dataset.mobileBackgroundV32Detail;
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

    const source = video.querySelector("source[src]");
    if (!video.getAttribute("src") && !source) {
      video.src = VIDEO_ASSET;
    }
  }

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry(reason, delay = 250) {
    if (!motionEligible()) return;
    clearRetry();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      attemptPlayback(reason);
    }, delay);
  }

  function removeGestureRecovery() {
    if (!gestureRecoveryBound) return;
    gestureRecoveryBound = false;
    globalThis.removeEventListener("pointerdown", recoverFromGesture, true);
    globalThis.removeEventListener("touchstart", recoverFromGesture, true);
    globalThis.removeEventListener("keydown", recoverFromGesture, true);
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

  function revealVideo(metadata) {
    const mediaTime = Number(metadata?.mediaTime ?? video.currentTime ?? 0);
    if (
      !motionEligible() ||
      video.paused ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      mediaTime <= 0
    ) {
      return false;
    }

    revealed = true;
    clearRetry();
    removeGestureRecovery();
    setState("video", "progressing-native-frame");
    return true;
  }

  function scheduleFrameCheck() {
    if (revealed || frameCheckPending || !motionEligible()) return;
    frameCheckPending = true;

    const complete = (metadata) => {
      frameCheckPending = false;
      if (!revealVideo(metadata) && !video.paused && motionEligible()) {
        setTimeout(scheduleFrameCheck, 34);
      }
    };

    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback((_now, metadata) => complete(metadata));
    } else {
      requestAnimationFrame(() => complete({ mediaTime: video.currentTime }));
    }
  }

  function handlePlaybackFailure(error, reason) {
    const name = error instanceof Error ? error.name : "PlaybackRejected";
    root.dataset.mobileBackgroundV32PlaybackError = name;
    if (!revealed) setState("poster", `${reason}-${name}`);
    bindGestureRecovery();
  }

  function trackPlayResult(result, reason, replaceInFlight) {
    const tracked = Promise.resolve(result)
      .then(() => {
        if (!video.paused) scheduleFrameCheck();
      })
      .catch((error) => handlePlaybackFailure(error, reason))
      .finally(() => {
        if (playInFlight === tracked) playInFlight = null;
      });
    if (replaceInFlight) playInFlight = tracked;
    return tracked;
  }

  function attemptPlayback(reason = "automatic") {
    if (!motionEligible() || revealed) return playInFlight;
    if (playInFlight) return playInFlight;
    configureVideo();
    setState("loading", reason);

    let result;
    try {
      result = video.play();
    } catch (error) {
      handlePlaybackFailure(error, reason);
      return null;
    }
    return trackPlayResult(result, reason, true);
  }

  function playInsideUserGesture() {
    if (!motionEligible() || revealed) return null;
    configureVideo();

    // This call must stay directly inside the pointer/touch/key handler. Any
    // await, timer, or animation frame before video.play() loses iOS's gesture.
    let result;
    try {
      result = video.play();
    } catch (error) {
      handlePlaybackFailure(error, "user-gesture");
      return null;
    }
    return trackPlayResult(result, "user-gesture", true);
  }

  function recoverFromGesture() {
    playInsideUserGesture();
  }

  function handleMotionChange() {
    if (!motionEligible()) {
      clearRetry();
      removeGestureRecovery();
      revealed = false;
      try {
        video.pause();
      } catch {}
      setState(
        "poster",
        reducedMotion?.matches ? "reduced-motion" : "inactive",
      );
      return;
    }

    bindGestureRecovery();
    attemptPlayback("motion-change");
  }

  setState("poster", "initial-paint");
  configureVideo();

  if (!motionEligible()) {
    setState(
      "poster",
      reducedMotion?.matches ? "reduced-motion" : "inactive",
    );
    return;
  }

  bindGestureRecovery();

  video.addEventListener("playing", scheduleFrameCheck);
  video.addEventListener("loadeddata", scheduleFrameCheck);
  video.addEventListener("timeupdate", () => {
    if (video.currentTime > 0) scheduleFrameCheck();
  });
  video.addEventListener("canplay", () => attemptPlayback("canplay"));
  video.addEventListener("error", () => {
    revealed = false;
    setState("poster", "video-error");
    bindGestureRecovery();
  });
  video.addEventListener("pause", () => {
    if (!document.hidden && motionEligible()) {
      if (!revealed) setState("poster", "paused-before-first-frame");
      bindGestureRecovery();
      scheduleRetry("pause-retry", 350);
    }
  });
  for (const event of ["waiting", "stalled"]) {
    video.addEventListener(event, () => {
      if (!revealed) setState("poster", event);
      scheduleRetry(`${event}-retry`, 350);
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) attemptPlayback("visibilitychange");
  });
  for (const event of ["pageshow", "focus", "online"]) {
    globalThis.addEventListener(event, () => attemptPlayback(event));
  }
  globalThis.addEventListener("orientationchange", () => {
    setTimeout(handleMotionChange, 0);
  });
  mobile?.addEventListener?.("change", handleMotionChange);
  reducedMotion?.addEventListener?.("change", handleMotionChange);

  if (!video.paused && video.currentTime > 0) scheduleFrameCheck();
  attemptPlayback("initial");
})();

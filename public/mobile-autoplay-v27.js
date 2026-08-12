(() => {
  const MOBILE_QUERY =
    "(max-width: 980px), (hover: none) and (pointer: coarse)";
  const root = document.documentElement;
  const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
  const video = document.querySelector("#mobile-background-video");

  if (!(video instanceof HTMLVideoElement) || mobile?.matches !== true) return;

  let attempt = 0;
  let retryTimer = null;
  let gestureRecoveryBound = false;
  const retryDelays = [0, 120, 350, 800, 1600, 3000];

  function setState(state, error = null) {
    root.dataset.mobileAutoplayV27 = state;
    if (error && typeof error.name === "string") {
      root.dataset.mobileVideoAutoplayError = error.name;
    } else if (state === "playing") {
      delete root.dataset.mobileVideoAutoplayError;
    }
  }

  function configure() {
    video.autoplay = true;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = false;
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
  }

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function markPlaying() {
    if (video.paused || video.readyState < 2) return;
    clearRetry();
    attempt = 0;
    video.classList.add("is-playing");
    video.classList.remove("is-autoplay-blocked", "is-failed");
    setState("playing");
  }

  function markFallback(state, error = null) {
    video.classList.remove("is-playing");
    if (state === "failed") video.classList.add("is-failed");
    else video.classList.add("is-autoplay-blocked");
    setState(state, error);
  }

  function scheduleRetry() {
    if (document.hidden || mobile?.matches !== true) return;
    if (attempt >= retryDelays.length) return;
    clearRetry();
    const delay = retryDelays[attempt++];
    retryTimer = setTimeout(tryPlayback, delay);
  }

  function bindGestureRecovery() {
    if (gestureRecoveryBound) return;
    gestureRecoveryBound = true;
    const recover = () => {
      attempt = 0;
      tryPlayback();
    };
    for (const event of ["pointerdown", "touchstart", "keydown"]) {
      globalThis.addEventListener(event, recover, {
        capture: true,
        passive: event !== "keydown",
      });
    }
  }

  async function tryPlayback() {
    if (document.hidden || mobile?.matches !== true) return;
    configure();
    if (!video.paused && video.readyState >= 2) {
      markPlaying();
      return;
    }

    setState("starting");
    try {
      await video.play();
      markPlaying();
    } catch (error) {
      markFallback("blocked", error);
      bindGestureRecovery();
      scheduleRetry();
    }
  }

  configure();
  setState("starting");

  for (const event of ["playing", "timeupdate"]) {
    video.addEventListener(event, markPlaying);
  }
  for (const event of ["loadedmetadata", "loadeddata", "canplay"]) {
    video.addEventListener(event, tryPlayback);
  }
  video.addEventListener("pause", () => {
    if (!document.hidden && mobile?.matches === true) {
      markFallback("paused");
      scheduleRetry();
    }
  });
  video.addEventListener("error", () => {
    clearRetry();
    markFallback("failed");
  });

  mobile?.addEventListener?.("change", (event) => {
    if (event.matches) {
      attempt = 0;
      tryPlayback();
    } else {
      clearRetry();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearRetry();
    else {
      attempt = 0;
      tryPlayback();
    }
  });
  for (const event of ["pageshow", "focus", "online", "orientationchange"]) {
    globalThis.addEventListener(event, () => {
      attempt = 0;
      tryPlayback();
    });
  }

  // Run while the parser is still directly below the video element, then once
  // more after layout. This gives WebKit its earliest valid muted-inline play
  // request instead of waiting for the rest of the application modules.
  tryPlayback();
  queueMicrotask(tryPlayback);
  requestAnimationFrame(tryPlayback);
})();

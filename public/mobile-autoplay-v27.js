(() => {
  const MOBILE_QUERY =
    "(max-width: 980px), (hover: none) and (pointer: coarse)";
  const VIDEO_ASSET =
    "/media/mobile-forest-stream-video-v24-native-1080.mp4";
  const root = document.documentElement;
  const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
  const video = document.querySelector("#mobile-background-video");

  if (!(video instanceof HTMLVideoElement) || mobile?.matches !== true) return;

  let attempt = 0;
  let retryTimer = null;
  let gestureRecoveryBound = false;
  let loadRequested = false;
  const retryDelays = [0, 120, 350, 800, 1600, 3000, 5000];

  function setState(state, error = null) {
    root.dataset.mobileAutoplayV28 = state;
    delete root.dataset.mobileAutoplayV27;
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

    // The separate forest backdrop is the loading/error fallback. Removing the
    // video poster prevents WebKit from treating the visible media layer as a
    // poster-only element while the first muted-inline play request is pending.
    video.removeAttribute("poster");
    video.poster = "";

    // Keep a direct src on the element. Some iOS WebViews defer selecting a
    // nested <source> until the first gesture even though preload="auto" is set.
    if (!(video.currentSrc || video.src || "").includes(VIDEO_ASSET)) {
      video.src = VIDEO_ASSET;
      loadRequested = false;
    }

    if (!loadRequested && video.readyState === HTMLMediaElement.HAVE_NOTHING) {
      loadRequested = true;
      video.load();
    }
  }

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function markPlaying() {
    if (video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
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
    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      markPlaying();
      return;
    }

    setState("starting");
    try {
      const result = video.play();
      if (result && typeof result.then === "function") await result;
      if (!video.paused) markPlaying();
      else {
        markFallback("paused");
        scheduleRetry();
      }
    } catch (error) {
      markFallback("blocked", error);
      bindGestureRecovery();
      scheduleRetry();
    }
  }

  configure();
  setState("starting");

  video.addEventListener("playing", markPlaying);
  video.addEventListener("timeupdate", markPlaying);
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

  // Keep the media element render-visible from the start. WebKit may refuse to
  // autoplay a muted video that CSS marks hidden, even when play() is called.
  // The transparent canvas fallback may sit above it, but the video itself
  // remains an on-screen element throughout the autoplay decision.
  tryPlayback();
  queueMicrotask(tryPlayback);
  requestAnimationFrame(tryPlayback);
})();

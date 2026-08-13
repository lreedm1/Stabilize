(() => {
  const MOBILE_QUERY =
    "(max-width: 980px), (hover: none) and (pointer: coarse)";
  const ATLAS_ASSET =
    "/scenes/mobile-forest-stream-full-atlas-v29-1080.webp?v=20260812-mobile-no-tap-motion-v29-1";
  const FRAME_WIDTH = 1080;
  const FRAME_HEIGHT = 1920;
  const FRAME_COLUMNS = 4;
  const FRAME_COUNT = 8;
  const FRAME_INTERVAL = 1000 / 8;

  const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
  const canvas = document.querySelector("#mobile-full-motion-v29");
  const legacyVideo = document.querySelector("#mobile-background-video");
  const root = document.documentElement;

  if (!(canvas instanceof HTMLCanvasElement) || mobile?.matches !== true) return;

  const context = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });
  if (!context) return;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  let atlas = null;
  let running = false;
  let frameIndex = 0;
  let timer = null;
  let animationFrame = null;
  let nextFrameAt = 0;
  let cssWidth = 0;
  let cssHeight = 0;
  let pixelRatio = 1;

  function retireGestureGatedMedia() {
    if (!(legacyVideo instanceof HTMLVideoElement)) return;
    try {
      legacyVideo.pause();
    } catch {}
    legacyVideo.autoplay = false;
    legacyVideo.removeAttribute("autoplay");
    legacyVideo.preload = "none";
    legacyVideo.style.setProperty("display", "none", "important");
    legacyVideo.style.setProperty("visibility", "hidden", "important");
    legacyVideo.style.setProperty("opacity", "0", "important");
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(
      1,
      Math.round(rect.width || document.documentElement.clientWidth || innerWidth || 1),
    );
    const nextHeight = Math.max(
      1,
      Math.round(rect.height || innerHeight || document.documentElement.clientHeight || 1),
    );
    const sourceLimitedRatio = Math.max(
      1,
      Math.min(FRAME_WIDTH / nextWidth, FRAME_HEIGHT / nextHeight),
    );
    const nextRatio = Math.max(
      1,
      Math.min(globalThis.devicePixelRatio || 1, 2.5, sourceLimitedRatio),
    );

    if (
      nextWidth === cssWidth &&
      nextHeight === cssHeight &&
      Math.abs(nextRatio - pixelRatio) < 0.01
    ) {
      return;
    }

    cssWidth = nextWidth;
    cssHeight = nextHeight;
    pixelRatio = nextRatio;
    canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
    canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
  }

  function drawFrame(index) {
    if (!(atlas instanceof HTMLImageElement) || !atlas.complete || atlas.naturalWidth <= 0) {
      return false;
    }

    resizeCanvas();

    const column = index % FRAME_COLUMNS;
    const row = Math.floor(index / FRAME_COLUMNS);
    const sourceX = column * FRAME_WIDTH;
    const sourceY = row * FRAME_HEIGHT;

    const scale = Math.max(cssWidth / FRAME_WIDTH, cssHeight / FRAME_HEIGHT);
    const destinationWidth = FRAME_WIDTH * scale;
    const destinationHeight = FRAME_HEIGHT * scale;
    const destinationX = (cssWidth - destinationWidth) / 2;
    const destinationY = (cssHeight - destinationHeight) / 2;

    context.clearRect(0, 0, cssWidth, cssHeight);
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

    canvas.classList.add("is-ready");
    root.dataset.mobileNoTapMotion = "playing";
    return true;
  }

  function clearSchedule() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  function schedule(delay = FRAME_INTERVAL) {
    clearSchedule();
    if (!running || document.hidden || mobile?.matches !== true) return;
    timer = setTimeout(() => {
      timer = null;
      animationFrame = requestAnimationFrame(step);
    }, Math.max(0, delay));
  }

  function step(now) {
    animationFrame = null;
    if (!running || document.hidden || mobile?.matches !== true) {
      stop();
      return;
    }

    if (!nextFrameAt) nextFrameAt = now;
    if (now + 1 >= nextFrameAt) {
      drawFrame(frameIndex);
      frameIndex = (frameIndex + 1) % FRAME_COUNT;
      nextFrameAt += FRAME_INTERVAL;
      if (nextFrameAt < now - FRAME_INTERVAL) {
        nextFrameAt = now + FRAME_INTERVAL;
      }
    }
    schedule(nextFrameAt - performance.now());
  }

  function start() {
    if (
      document.hidden ||
      mobile?.matches !== true ||
      !(atlas instanceof HTMLImageElement) ||
      !atlas.complete ||
      atlas.naturalWidth <= 0
    ) {
      return;
    }

    retireGestureGatedMedia();
    resizeCanvas();
    drawFrame(frameIndex);
    if (running) return;
    running = true;
    nextFrameAt = performance.now() + FRAME_INTERVAL;
    schedule(FRAME_INTERVAL);
  }

  function stop() {
    running = false;
    nextFrameAt = 0;
    clearSchedule();
    if (document.hidden) root.dataset.mobileNoTapMotion = "paused";
  }

  function loadAtlas() {
    if (atlas instanceof HTMLImageElement) return;
    root.dataset.mobileNoTapMotion = "loading";
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "high";
    image.onload = () => {
      atlas = image;
      frameIndex = 0;
      start();
    };
    image.onerror = () => {
      root.dataset.mobileNoTapMotion = "failed";
    };
    image.src = ATLAS_ASSET;
    atlas = image;
  }

  retireGestureGatedMedia();
  loadAtlas();

  mobile?.addEventListener?.("change", (event) => {
    if (event.matches) {
      loadAtlas();
      start();
    } else {
      stop();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  for (const event of ["pageshow", "focus", "online"]) {
    globalThis.addEventListener(event, start);
  }
  globalThis.addEventListener("resize", () => {
    resizeCanvas();
    drawFrame(frameIndex);
  });
  globalThis.addEventListener("orientationchange", () => {
    setTimeout(() => {
      resizeCanvas();
      drawFrame(frameIndex);
      start();
    }, 0);
  });
  globalThis.addEventListener("pagehide", stop);
})();

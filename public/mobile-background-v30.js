(() => {
  "use strict";

  const VERSION = "20260813-mobile-background-v30-1";
  const MOBILE_QUERY = "(hover: none) and (pointer: coarse)";
  const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
  const POSTER_ASSET =
    `/scenes/mobile-forest-stream-v24-native-1080.webp?v=${VERSION}`;
  const ATLAS_ASSET =
    `/scenes/mobile-forest-stream-full-atlas-v29-1080.webp?v=${VERSION}`;
  const VIDEO_ASSET =
    `/media/mobile-forest-stream-video-v24-native-1080.mp4?v=${VERSION}`;

  const POSTER_WIDTH = 2160;
  const POSTER_HEIGHT = 3840;
  const FRAME_WIDTH = 1080;
  const FRAME_HEIGHT = 1920;
  const FRAME_COLUMNS = 4;
  const FRAME_ROWS = 2;
  const FRAME_COUNT = 8;
  const SOURCE_FPS = 8;
  const REFERENCE_FRAME = 4; // The poster was extracted at 0.5 seconds.
  const FADE_MS = 260;
  const MAX_PIXEL_RATIO = 3;

  const mobile = globalThis.matchMedia?.(MOBILE_QUERY);
  const reducedMotion = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);
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

  let poster = null;
  let atlas = null;
  let renderer = null;
  let animationFrame = null;
  let fallbackRunning = false;
  let fallbackStartAt = 0;
  let fallbackStartPosition = REFERENCE_FRAME;
  let fallbackReady = false;
  let videoReady = false;
  let revealRequest = null;
  let playAttempt = null;
  let retryTimer = null;
  let gestureRecoveryBound = false;
  let stallTimer = null;

  function dataSaverEnabled() {
    return navigator?.connection?.saveData === true;
  }

  function motionEligible() {
    return (
      mobile?.matches === true &&
      reducedMotion?.matches !== true &&
      !dataSaverEnabled() &&
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

  function clearTimer(name) {
    if (name === "retry" && retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (name === "stall" && stallTimer !== null) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  }

  function loadImage(url, priority = "auto") {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = priority;
      image.onload = async () => {
        try {
          await image.decode?.();
        } catch {
          // The load event already proves the image is usable.
        }
        resolve(image);
      };
      image.onerror = () => reject(new Error(`Unable to load ${url}`));
      image.src = url;
    });
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to create WebGL shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Unknown shader error";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to create WebGL program");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown link error";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function createTexture(gl, image) {
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to create WebGL texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image,
    );
    return texture;
  }

  function coverCrop(width, height) {
    const targetAspect = width / height;
    const sourceAspect = FRAME_WIDTH / FRAME_HEIGHT;
    if (targetAspect < sourceAspect) {
      const visibleWidth = targetAspect / sourceAspect;
      return {
        offsetX: (1 - visibleWidth) / 2,
        offsetY: 0,
        scaleX: visibleWidth,
        scaleY: 1,
      };
    }
    const visibleHeight = sourceAspect / targetAspect;
    return {
      offsetX: 0,
      offsetY: (1 - visibleHeight) / 2,
      scaleX: 1,
      scaleY: visibleHeight,
    };
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
    const sourceLimit = Math.max(
      1,
      Math.min(POSTER_WIDTH / cssWidth, POSTER_HEIGHT / cssHeight),
    );
    const pixelRatio = Math.max(
      1,
      Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO, sourceLimit),
    );
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { cssWidth, cssHeight, width, height, pixelRatio };
  }

  function createWebGLRenderer() {
    if (!(poster instanceof HTMLImageElement) || !(atlas instanceof HTMLImageElement)) {
      return null;
    }

    const gl =
      canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
      }) || canvas.getContext("experimental-webgl");
    if (!(gl instanceof WebGLRenderingContext)) return null;

    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (
      maxTextureSize < poster.naturalWidth ||
      maxTextureSize < poster.naturalHeight ||
      maxTextureSize < atlas.naturalWidth ||
      maxTextureSize < atlas.naturalHeight
    ) {
      return null;
    }

    const vertexSource = `
      attribute vec2 aPosition;
      attribute vec2 aUv;
      varying vec2 vUv;
      void main() {
        vUv = aUv;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
    const fragmentSource = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uPoster;
      uniform sampler2D uAtlas;
      uniform vec2 uCropOffset;
      uniform vec2 uCropScale;
      uniform float uCurrentFrame;
      uniform float uNextFrame;
      uniform float uBlend;
      uniform float uReferenceFrame;
      uniform float uMotionGain;

      vec2 atlasUv(vec2 sourceUv, float frame) {
        float column = mod(frame, ${FRAME_COLUMNS.toFixed(1)});
        float row = floor(frame / ${FRAME_COLUMNS.toFixed(1)});
        return vec2(
          (sourceUv.x + column) / ${FRAME_COLUMNS.toFixed(1)},
          (sourceUv.y + row) / ${FRAME_ROWS.toFixed(1)}
        );
      }

      void main() {
        vec2 sourceUv = uCropOffset + vUv * uCropScale;
        vec3 sharpPoster = texture2D(uPoster, sourceUv).rgb;
        vec3 referenceFrame = texture2D(
          uAtlas,
          atlasUv(sourceUv, uReferenceFrame)
        ).rgb;
        vec3 currentFrame = texture2D(
          uAtlas,
          atlasUv(sourceUv, uCurrentFrame)
        ).rgb;
        vec3 nextFrame = texture2D(
          uAtlas,
          atlasUv(sourceUv, uNextFrame)
        ).rgb;
        vec3 interpolatedFrame = mix(currentFrame, nextFrame, uBlend);
        vec3 motionDelta = interpolatedFrame - referenceFrame;
        vec3 result = clamp(sharpPoster + motionDelta * uMotionGain, 0.0, 1.0);
        gl_FragColor = vec4(result, 1.0);
      }
    `;

    let program;
    try {
      program = createProgram(gl, vertexSource, fragmentSource);
    } catch (error) {
      console.warn("mobile background WebGL initialization failed", error);
      return null;
    }

    const buffer = gl.createBuffer();
    if (!buffer) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 1,
         1, -1, 1, 1,
        -1,  1, 0, 0,
         1,  1, 1, 0,
      ]),
      gl.STATIC_DRAW,
    );

    gl.useProgram(program);
    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const uvLocation = gl.getAttribLocation(program, "aUv");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 16, 8);

    const posterTexture = createTexture(gl, poster);
    const atlasTexture = createTexture(gl, atlas);
    const cropOffsetLocation = gl.getUniformLocation(program, "uCropOffset");
    const cropScaleLocation = gl.getUniformLocation(program, "uCropScale");
    const currentLocation = gl.getUniformLocation(program, "uCurrentFrame");
    const nextLocation = gl.getUniformLocation(program, "uNextFrame");
    const blendLocation = gl.getUniformLocation(program, "uBlend");
    const referenceLocation = gl.getUniformLocation(program, "uReferenceFrame");
    const gainLocation = gl.getUniformLocation(program, "uMotionGain");

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, posterTexture);
    gl.uniform1i(gl.getUniformLocation(program, "uPoster"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.uniform1i(gl.getUniformLocation(program, "uAtlas"), 1);
    gl.uniform1f(referenceLocation, REFERENCE_FRAME);
    gl.uniform1f(gainLocation, 1.0);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    return {
      quality: "sharp-poster-plus-interpolated-motion-webgl",
      draw(position) {
        const size = resizeCanvas();
        const crop = coverCrop(size.cssWidth, size.cssHeight);
        const wrapped = ((position % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
        const current = Math.floor(wrapped);
        const next = (current + 1) % FRAME_COUNT;
        const blend = wrapped - current;

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.uniform2f(cropOffsetLocation, crop.offsetX, crop.offsetY);
        gl.uniform2f(cropScaleLocation, crop.scaleX, crop.scaleY);
        gl.uniform1f(currentLocation, current);
        gl.uniform1f(nextLocation, next);
        gl.uniform1f(blendLocation, blend);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return true;
      },
      destroy() {
        gl.deleteTexture(posterTexture);
        gl.deleteTexture(atlasTexture);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      },
    };
  }

  function createCanvas2DRenderer() {
    if (!(atlas instanceof HTMLImageElement)) return null;
    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

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

    return {
      quality: "interpolated-atlas-canvas2d",
      draw(position) {
        const size = resizeCanvas();
        context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        const wrapped = ((position % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
        const current = Math.floor(wrapped);
        const next = (current + 1) % FRAME_COUNT;
        const blend = wrapped - current;
        context.globalAlpha = 1;
        context.clearRect(0, 0, size.cssWidth, size.cssHeight);
        drawAtlasFrame(current, 1, size);
        drawAtlasFrame(next, blend, size);
        context.globalAlpha = 1;
        return true;
      },
      destroy() {},
    };
  }

  function drawFallback(now) {
    animationFrame = null;
    if (!fallbackRunning || !motionEligible() || videoReady || !renderer) {
      return;
    }
    const elapsed = Math.max(0, now - fallbackStartAt) / 1000;
    const position = fallbackStartPosition + elapsed * SOURCE_FPS;
    if (renderer.draw(position)) {
      if (!fallbackReady) {
        fallbackReady = true;
        canvas.classList.add("is-ready");
      }
      setQuality(renderer.quality);
      setState("fallback", "display-refresh-interpolation");
    }
    animationFrame = requestAnimationFrame(drawFallback);
  }

  function startFallback(position = null) {
    if (!motionEligible() || !renderer || videoReady) return;
    if (Number.isFinite(position)) {
      fallbackStartPosition = position;
    } else if (!fallbackRunning) {
      fallbackStartPosition = REFERENCE_FRAME;
    }
    fallbackStartAt = performance.now();
    fallbackRunning = true;
    if (animationFrame === null) {
      animationFrame = requestAnimationFrame(drawFallback);
    }
  }

  function stopFallback() {
    fallbackRunning = false;
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  async function initializeFallback() {
    if (!motionEligible()) {
      setState("poster", reducedMotion?.matches ? "reduced-motion" : "data-saver");
      return;
    }
    setState("loading", "poster-and-atlas");
    try {
      [poster, atlas] = await Promise.all([
        loadImage(POSTER_ASSET, "high"),
        loadImage(ATLAS_ASSET, "high"),
      ]);
      renderer = createWebGLRenderer() || createCanvas2DRenderer();
      if (!renderer) throw new Error("No supported canvas renderer");
      startFallback(REFERENCE_FRAME);
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
    video.setAttribute("x-webkit-airplay", "deny");
    video.setAttribute("preload", "auto");

    const expected = new URL(VIDEO_ASSET, location.href).href;
    const current = video.currentSrc || video.src || "";
    if (current !== expected) {
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
      videoReady ||
      video.paused ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !motionEligible()
    ) {
      return;
    }

    videoReady = true;
    clearTimer("retry");
    clearTimer("stall");
    removeGestureRecovery();
    setQuality("native-video-2160x3840-24fps");
    setState("video", "decoded-playing-frame");
    setTimeout(stopFallback, FADE_MS + 80);
  }

  function scheduleReveal() {
    if (
      revealRequest !== null ||
      video.paused ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return;
    }

    if (typeof video.requestVideoFrameCallback === "function") {
      revealRequest = video.requestVideoFrameCallback(() => {
        revealRequest = null;
        revealVideo();
      });
      return;
    }

    revealRequest = requestAnimationFrame(() => {
      revealRequest = requestAnimationFrame(() => {
        revealRequest = null;
        revealVideo();
      });
    });
  }

  function restoreFallback(detail = "video-unavailable") {
    if (!motionEligible()) {
      videoReady = false;
      setState("poster", detail);
      stopFallback();
      return;
    }
    const position = Number.isFinite(video.currentTime)
      ? (video.currentTime * SOURCE_FPS) % FRAME_COUNT
      : REFERENCE_FRAME;
    videoReady = false;
    startFallback(position);
    if (fallbackReady) setState("fallback", detail);
  }

  function scheduleRetry(delay = 1800) {
    if (!motionEligible() || videoReady) return;
    clearTimer("retry");
    retryTimer = setTimeout(() => {
      retryTimer = null;
      attemptPlayback("scheduled-retry");
    }, delay);
  }

  async function attemptPlayback(reason = "unspecified") {
    if (!motionEligible() || videoReady) return;
    if (playAttempt) return playAttempt;
    configureVideo();

    playAttempt = (async () => {
      try {
        const result = video.play();
        if (result && typeof result.then === "function") await result;
        if (!video.paused) scheduleReveal();
      } catch (error) {
        const name = error instanceof Error ? error.name : "PlaybackRejected";
        root.dataset.mobileBackgroundV30PlaybackError = name;
        restoreFallback(`autoplay-${name}`);
        bindGestureRecovery();
        scheduleRetry(reason === "user-gesture" ? 3000 : 1800);
      } finally {
        playAttempt = null;
      }
    })();

    return playAttempt;
  }

  function scheduleStallFallback() {
    clearTimer("stall");
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        restoreFallback("video-stalled");
        scheduleRetry(1200);
      }
    }, 900);
  }

  function handleMotionPreferenceChange() {
    if (!motionEligible()) {
      stopFallback();
      videoReady = false;
      try {
        video.pause();
      } catch {}
      setState("poster", reducedMotion?.matches ? "reduced-motion" : "data-saver");
      return;
    }
    if (!renderer && !poster && !atlas) initializeFallback();
    else startFallback();
    attemptPlayback("preference-change");
  }

  setState("poster", "initial-paint");
  configureVideo();
  initializeFallback();

  video.addEventListener("playing", scheduleReveal);
  video.addEventListener("timeupdate", () => {
    if (video.currentTime > 0) scheduleReveal();
  });
  for (const event of ["loadeddata", "canplay"]) {
    video.addEventListener(event, () => attemptPlayback(event));
  }
  video.addEventListener("pause", () => {
    if (!document.hidden && motionEligible()) restoreFallback("video-paused");
  });
  video.addEventListener("error", () => {
    restoreFallback("video-error");
    bindGestureRecovery();
  });
  video.addEventListener("waiting", scheduleStallFallback);
  video.addEventListener("stalled", scheduleStallFallback);

  mobile?.addEventListener?.("change", handleMotionPreferenceChange);
  reducedMotion?.addEventListener?.("change", handleMotionPreferenceChange);
  navigator?.connection?.addEventListener?.("change", handleMotionPreferenceChange);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopFallback();
      clearTimer("retry");
      clearTimer("stall");
      return;
    }
    restoreFallback("page-visible");
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
    setTimeout(() => {
      resizeCanvas();
      if (!videoReady) startFallback();
      attemptPlayback("orientationchange");
    }, 0);
  });
  globalThis.addEventListener("pagehide", () => {
    stopFallback();
    clearTimer("retry");
    clearTimer("stall");
  });

  attemptPlayback("initial");
})();

const TARGET_FRAME_MS = 1000 / 30;
const MAX_PIXEL_RATIO = 1.5;

export const SCENE_ASSETS = Object.freeze({
  landscape: Object.freeze([
    Object.freeze({
      width: 1280,
      height: 720,
      src: "/scenes/lake-valley-landscape-1280.webp",
    }),
    Object.freeze({
      width: 2560,
      height: 1440,
      src: "/scenes/lake-valley-landscape-2560.webp",
    }),
    Object.freeze({
      width: 3840,
      height: 2160,
      src: "/scenes/lake-valley-landscape-3840.webp",
    }),
  ]),
  portrait: Object.freeze([
    Object.freeze({
      width: 720,
      height: 1280,
      src: "/scenes/lake-valley-portrait-720.webp",
    }),
    Object.freeze({
      width: 1440,
      height: 2560,
      src: "/scenes/lake-valley-portrait-1440.webp",
    }),
    Object.freeze({
      width: 2160,
      height: 3840,
      src: "/scenes/lake-valley-portrait-2160.webp",
    }),
  ]),
});

const clamp = (value, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

const mix = (from, to, amount) => from + (to - from) * amount;

export function selectSceneAsset({ width, height, pixelRatio = 1 }) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const safeRatio = clamp(Number(pixelRatio) || 1, 1, 2);
  const orientation = safeHeight > safeWidth * 1.08 ? "portrait" : "landscape";
  const candidates = SCENE_ASSETS[orientation];
  const targetWidth = safeWidth * safeRatio;

  return (
    candidates.find((candidate) => candidate.width >= targetWidth) ||
    candidates.at(-1)
  );
}

export function shouldUsePhotoScene(scope = globalThis) {
  const motionQuery = scope?.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (motionQuery?.matches) return false;

  const navigatorValue = scope?.navigator;
  if (navigatorValue?.connection?.saveData === true) return false;
  if (
    Number.isFinite(navigatorValue?.deviceMemory) &&
    navigatorValue.deviceMemory <= 2
  ) {
    return false;
  }
  if (
    Number.isFinite(navigatorValue?.hardwareConcurrency) &&
    navigatorValue.hardwareConcurrency <= 2
  ) {
    return false;
  }

  return true;
}

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform vec2 u_image_size;
uniform float u_time;
uniform float u_warmth;
uniform float u_mist;
uniform float u_wind;
uniform float u_ripple;
uniform float u_energy;

varying vec2 v_uv;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float lower = mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), local.x);
  float upper = mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + 1.0), local.x);
  return mix(lower, upper, local.y);
}

float fogNoise(vec2 point) {
  float value = 0.0;
  value += valueNoise(point) * 0.58;
  value += valueNoise(point * 2.03 + 17.4) * 0.27;
  value += valueNoise(point * 4.09 - 8.2) * 0.15;
  return value;
}

vec2 coverUv(vec2 uv) {
  float viewportAspect = u_resolution.x / max(u_resolution.y, 1.0);
  float imageAspect = u_image_size.x / max(u_image_size.y, 1.0);
  if (viewportAspect > imageAspect) {
    uv.y = 0.5 + (uv.y - 0.5) * imageAspect / viewportAspect;
  } else {
    uv.x = 0.5 + (uv.x - 0.5) * viewportAspect / imageAspect;
  }
  return uv;
}

void main() {
  vec2 sceneUv = coverUv(v_uv);
  float sceneY = sceneUv.y;

  // The photograph is treated as five soft depth bands. The offsets stay in
  // the 1-3 px range so the scene gains depth without looking like a cinemagraph.
  float sky = smoothstep(0.63, 0.76, sceneY);
  float distant = smoothstep(0.52, 0.61, sceneY) * (1.0 - smoothstep(0.72, 0.84, sceneY));
  float water = 1.0 - smoothstep(0.48, 0.555, sceneY);
  float foreground = (1.0 - smoothstep(0.12, 0.38, sceneY)) * (1.0 - water * 0.45);
  float forest = clamp(1.0 - sky - distant - water * 0.75, 0.0, 1.0);

  float drift = sin(u_time * 0.055) * (0.45 + u_wind * 0.75 + u_energy * 0.28);
  float depthPixels = sky * -1.0 + distant * 0.5 + forest * 1.35 + foreground * 2.4;
  sceneUv.x += drift * depthPixels / max(u_image_size.x, 1.0);

  float waveA = sin(sceneUv.y * 155.0 + sceneUv.x * 18.0 + u_time * (0.38 + u_wind * 0.42));
  float waveB = sin(sceneUv.x * 235.0 - sceneUv.y * 27.0 - u_time * (0.52 + u_energy * 0.26));
  float waveC = sin((sceneUv.x + sceneUv.y) * 79.0 + u_time * 0.21);
  float rippleStrength = (0.00011 + u_ripple * 0.00031 + u_energy * 0.00008) * water;
  sceneUv.x += (waveA + waveB * 0.42) * rippleStrength;
  sceneUv.y += (waveB * 0.25 + waveC * 0.18) * rippleStrength;
  sceneUv = clamp(sceneUv, vec2(0.001), vec2(0.999));

  vec3 color = texture2D(u_scene, sceneUv).rgb;

  float horizon = exp(-pow((sceneY - 0.535) * 14.5, 2.0));
  vec2 fogPoint = vec2(sceneUv.x * 3.4 + u_time * (0.004 + u_wind * 0.008), sceneUv.y * 15.0);
  float movingFog = 0.48 + fogNoise(fogPoint) * 0.52;
  float fogAlpha = horizon * movingFog * (0.025 + u_mist * 0.105 + u_energy * 0.012);
  vec3 coolFog = vec3(0.74, 0.82, 0.84);
  vec3 warmFog = vec3(0.92, 0.84, 0.70);
  color = mix(color, mix(coolFog, warmFog, u_warmth * 0.42), fogAlpha);

  float sunDistance = distance(v_uv, vec2(0.88, 0.79));
  float sunlight = exp(-sunDistance * 4.7) * (0.008 + u_warmth * 0.019);
  float reflection = water * exp(-abs(v_uv.x - 0.72) * 7.5) * (0.004 + u_warmth * 0.014);
  color += vec3(1.0, 0.72, 0.43) * (sunlight + reflection);
  color = mix(color, color * vec3(1.035, 1.005, 0.965), u_warmth * 0.16);

  float vignette = smoothstep(0.45, 0.92, distance(v_uv, vec2(0.5, 0.5)));
  color *= 1.0 - vignette * 0.075;
  float grain = hash21(gl_FragCoord.xy + floor(u_time * 8.0)) - 0.5;
  color += grain * 0.0035;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate a WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const details = gl.getShaderInfoLog(shader) || "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(details);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to allocate a WebGL program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const details = gl.getProgramInfoLog(program) || "Unknown program error";
    gl.deleteProgram(program);
    throw new Error(details);
  }
  return program;
}

function imageFor(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Unable to load the photographic scene"));
    image.src = src;
  });
}

function renderPixelRatio(width, height) {
  const portrait = height > width * 1.08;
  const maximumWidth = portrait ? 2160 : 3840;
  const maximumHeight = portrait ? 3840 : 2160;
  return clamp(
    Math.min(
      window.devicePixelRatio || 1,
      MAX_PIXEL_RATIO,
      maximumWidth / Math.max(width, 1),
      maximumHeight / Math.max(height, 1),
    ),
    0.5,
    MAX_PIXEL_RATIO,
  );
}

export function createPhotoScene(canvas, callbacks = {}) {
  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  let program;
  try {
    program = createProgram(gl);
  } catch (error) {
    callbacks.onFailure?.(error);
    return null;
  }

  const positionBuffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!positionBuffer || !texture) {
    callbacks.onFailure?.(new Error("Unable to allocate WebGL scene resources"));
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const uniforms = Object.freeze({
    scene: gl.getUniformLocation(program, "u_scene"),
    resolution: gl.getUniformLocation(program, "u_resolution"),
    imageSize: gl.getUniformLocation(program, "u_image_size"),
    time: gl.getUniformLocation(program, "u_time"),
    warmth: gl.getUniformLocation(program, "u_warmth"),
    mist: gl.getUniformLocation(program, "u_mist"),
    wind: gl.getUniformLocation(program, "u_wind"),
    ripple: gl.getUniformLocation(program, "u_ripple"),
    energy: gl.getUniformLocation(program, "u_energy"),
  });
  gl.uniform1i(uniforms.scene, 0);

  const state = {
    width: 1,
    height: 1,
    imageWidth: 1,
    imageHeight: 1,
    active: true,
    ready: false,
    failed: false,
    time: 0,
    warmth: 0.46,
    targetWarmth: 0.46,
    mist: 0.42,
    targetMist: 0.42,
    wind: 0.28,
    targetWind: 0.28,
    ripple: 0.34,
    targetRipple: 0.34,
    energy: 0,
  };
  let currentAsset = null;
  let loadSequence = 0;
  let animationFrame = 0;
  let resizeFrame = 0;
  let lastTime = performance.now();
  let lastPaint = 0;

  function draw() {
    if (!state.ready || state.failed) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.imageSize, state.imageWidth, state.imageHeight);
    gl.uniform1f(uniforms.time, state.time);
    gl.uniform1f(uniforms.warmth, state.warmth);
    gl.uniform1f(uniforms.mist, state.mist);
    gl.uniform1f(uniforms.wind, state.wind);
    gl.uniform1f(uniforms.ripple, state.ripple);
    gl.uniform1f(uniforms.energy, state.energy);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  async function loadAsset(asset) {
    const sequence = ++loadSequence;
    try {
      const image = await imageFor(asset.src);
      if (sequence !== loadSequence || state.failed) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGB,
        gl.RGB,
        gl.UNSIGNED_BYTE,
        image,
      );
      state.imageWidth = image.naturalWidth || asset.width;
      state.imageHeight = image.naturalHeight || asset.height;
      state.ready = true;
      draw();
      callbacks.onReady?.(asset);
      start();
    } catch (error) {
      if (sequence !== loadSequence) return;
      fail(error);
    }
  }

  function chooseAsset() {
    const pixelRatio = renderPixelRatio(state.width, state.height);
    const asset = selectSceneAsset({
      width: state.width,
      height: state.height,
      pixelRatio,
    });
    if (currentAsset?.src === asset.src) return;
    currentAsset = asset;
    void loadAsset(asset);
  }

  function resize() {
    state.width = Math.max(
      1,
      document.documentElement.clientWidth || window.innerWidth,
    );
    state.height = Math.max(
      1,
      document.documentElement.clientHeight || window.innerHeight,
    );
    const pixelRatio = renderPixelRatio(state.width, state.height);
    canvas.width = Math.max(1, Math.round(state.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(state.height * pixelRatio));
    chooseAsset();
    draw();
  }

  function scheduleResize() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
    });
  }

  function settle(elapsed) {
    const ease = 1 - Math.exp(-elapsed / 5_400);
    state.warmth = mix(state.warmth, state.targetWarmth, ease);
    state.mist = mix(state.mist, state.targetMist, ease);
    state.wind = mix(state.wind, state.targetWind, ease);
    state.ripple = mix(state.ripple, state.targetRipple, ease);
    state.energy *= Math.exp(-elapsed / 8_500);
    state.time += elapsed / 1_000;
  }

  function frame(now) {
    animationFrame = 0;
    if (
      !state.active ||
      state.failed ||
      document.hidden ||
      motionPreference.matches
    ) {
      return;
    }
    if (now - lastPaint >= TARGET_FRAME_MS) {
      const elapsed = clamp(now - lastTime, 0, 80);
      lastTime = now;
      lastPaint = now;
      settle(elapsed);
      draw();
    }
    animationFrame = requestAnimationFrame(frame);
  }

  function start() {
    if (
      animationFrame ||
      !state.active ||
      !state.ready ||
      state.failed ||
      document.hidden ||
      motionPreference.matches
    ) {
      return;
    }
    lastTime = performance.now();
    animationFrame = requestAnimationFrame(frame);
  }

  function stop() {
    if (!animationFrame) return;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function fail(error) {
    if (state.failed) return;
    state.failed = true;
    stop();
    callbacks.onFailure?.(error);
  }

  function ingest(signal) {
    if (!signal?.count) return;
    const influence = clamp(
      0.08 + Math.log2(signal.count + 1) * 0.035,
      0.1,
      0.32,
    );
    const warmth = 0.2 + signal.temperature * 0.58;
    const mist = 0.14 + signal.moisture * 0.62;
    const wind = 0.08 + signal.wind * 0.54;
    const ripple = 0.12 + signal.wind * 0.36 + signal.elevation * 0.18;
    state.targetWarmth = mix(state.targetWarmth, warmth, influence);
    state.targetMist = mix(state.targetMist, mist, influence);
    state.targetWind = mix(state.targetWind, wind, influence);
    state.targetRipple = mix(state.targetRipple, ripple, influence);
    state.energy = clamp(state.energy + 0.08 + Math.log1p(signal.count) * 0.055);
  }

  function setActive(value) {
    state.active = Boolean(value);
    if (state.active) start();
    else stop();
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    fail(new Error("The photographic scene lost its WebGL context"));
  });
  window.addEventListener("resize", scheduleResize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  const handleMotionPreference = () => {
    if (motionPreference.matches) stop();
    else start();
  };
  if (typeof motionPreference.addEventListener === "function") {
    motionPreference.addEventListener("change", handleMotionPreference);
  } else {
    motionPreference.addListener(handleMotionPreference);
  }

  resize();
  return { ingest, setActive };
}

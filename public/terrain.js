const UINT32_MAX = 0xffffffff;
const MAX_SIGNAL_TOKENS = 256;
const TARGET_FRAME_MS = 1000 / 30;
const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu;

const clamp = (value, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

const mix = (from, to, amount) => from + (to - from) * amount;

function avalanche(value) {
  let hash = value >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function hashText(value, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  const text = String(value || "");

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return avalanche(hash);
}

function unitFromByte(hash, shift) {
  return ((hash >>> shift) & 0xff) / 0xff;
}

export function terrainTokenSignal(value) {
  const tokens = String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(TOKEN_PATTERN) || [];
  const sampled = tokens.slice(-MAX_SIGNAL_TOKENS);

  if (!sampled.length) {
    return {
      count: 0,
      signature: 0,
      elevation: 0.5,
      moisture: 0.58,
      temperature: 0.48,
      wind: 0.42,
    };
  }

  let signature = 0x811c9dc5;
  let elevation = 0;
  let moisture = 0;
  let temperature = 0;
  let wind = 0;

  sampled.forEach((token, index) => {
    const tokenHash = hashText(
      token,
      avalanche(signature ^ Math.imul(index + 1, 0x9e3779b1)),
    );
    signature = avalanche(signature ^ tokenHash ^ index);
    elevation += unitFromByte(tokenHash, 0);
    moisture += unitFromByte(tokenHash, 8);
    temperature += unitFromByte(tokenHash, 16);
    wind += unitFromByte(tokenHash, 24);
  });

  const scale = 1 / sampled.length;
  return {
    count: tokens.length,
    signature,
    elevation: elevation * scale,
    moisture: moisture * scale,
    temperature: temperature * scale,
    wind: wind * scale,
  };
}

function smootherStep(value) {
  const amount = clamp(value);
  return amount * amount * amount * (amount * (amount * 6 - 15) + 10);
}

function smoothRange(edgeA, edgeB, value) {
  return smootherStep((value - edgeA) / (edgeB - edgeA));
}

function latticeNoise(index, seed) {
  return avalanche((index | 0) ^ seed) / UINT32_MAX;
}

function valueNoise(worldX, seed) {
  const left = Math.floor(worldX);
  const amount = smootherStep(worldX - left);
  return mix(
    latticeNoise(left, seed),
    latticeNoise(left + 1, seed),
    amount,
  );
}

function octaveNoise(worldX, seed, octaves, gain, lacunarity) {
  let frequency = 1;
  let amplitude = 1;
  let total = 0;
  let normalization = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    total +=
      valueNoise(worldX * frequency, avalanche(seed + octave * 0x9e3779b1)) *
      amplitude;
    normalization += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return total / normalization;
}

function ridgedNoise(worldX, seed, octaves = 4) {
  let frequency = 1;
  let amplitude = 1;
  let total = 0;
  let normalization = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    const base = valueNoise(
      worldX * frequency,
      avalanche(seed + octave * 0x85ebca6b),
    );
    const ridge = 1 - Math.abs(base * 2 - 1);
    total += ridge * ridge * amplitude;
    normalization += amplitude;
    amplitude *= 0.53;
    frequency *= 2.07;
  }

  return total / normalization;
}

/*
 * An original terrain field built from Minecraft's high-level terrain ideas:
 * broad continentalness, erosion, ridged peaks, detail, and climate. The
 * layers are continuous and two-dimensional rather than a voxel density map.
 */
export function minecraftTerrainHeight(worldX, layer = 0, controls = {}) {
  const layerIndex = Math.max(0, Math.floor(Number(layer) || 0));
  const seed = Number.isFinite(controls.seed)
    ? Number(controls.seed) >>> 0
    : 0x53a9f17d;
  const offset = Number.isFinite(controls.offset) ? controls.offset : 0;
  const elevationValue = Number(controls.elevation);
  const moistureValue = Number(controls.moisture);
  const elevation = clamp(Number.isFinite(elevationValue) ? elevationValue : 0.5);
  const moisture = clamp(Number.isFinite(moistureValue) ? moistureValue : 0.58);
  const layerScale = 1 + layerIndex * 0.24;
  const world = (Number(worldX) + offset) / layerScale;

  const continentalness = octaveNoise(
    world * 0.00062,
    seed ^ 0x68bc21eb,
    5,
    0.56,
    2.01,
  );
  const erosion = octaveNoise(
    world * 0.0019 + 17.3,
    seed ^ 0x02e5be93,
    4,
    0.52,
    2.11,
  );
  const ridges = ridgedNoise(
    world * 0.0048 - 31.7,
    seed ^ 0x967a889b,
  );
  const detail = octaveNoise(
    world * 0.011 + 5.9,
    seed ^ 0x4cf5ad43,
    3,
    0.48,
    2.19,
  );

  const landmass = smoothRange(0.16, 0.84, continentalness);
  const peakMask = smoothRange(0.4, 0.78, continentalness);
  const softenedRidges = ridges * mix(0.9, 0.58, moisture);
  const peaks = softenedRidges * peakMask * (1 - erosion * 0.56);
  const climateLift = (elevation - 0.5) * 0.2;

  return clamp(
    0.18 +
      landmass * 0.47 +
      peaks * 0.25 -
      erosion * 0.1 +
      (detail - 0.5) * 0.08 +
      climateLift,
  );
}

function colorMix(from, to, amount, alpha = 1) {
  const mixed = from.map((channel, index) =>
    Math.round(mix(channel, to[index], clamp(amount))),
  );
  return `rgba(${mixed[0]}, ${mixed[1]}, ${mixed[2]}, ${alpha})`;
}

export function lakeValleyOpening(screenX, viewportWidth, centerRatio = 0.5) {
  const safeWidth = Math.max(1, Number(viewportWidth) || 1);
  const center = safeWidth * clamp(Number(centerRatio) || 0.5, 0.35, 0.65);
  const distance = Math.abs(Number(screenX) - center) / (safeWidth * 0.54);
  const centerBias = 1 - smootherStep(clamp(distance));
  return centerBias * centerBias;
}

function createTerrain(canvas) {
  const context = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });
  if (!context) return null;

  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dayNumber = Math.floor(Date.now() / 86_400_000);
  const state = {
    seed: avalanche(dayNumber ^ 0x5a17b1e5),
    worldX: (dayNumber % 4096) * 37,
    offset: 0,
    targetOffset: 0,
    elevation: 0.5,
    targetElevation: 0.5,
    moisture: 0.6,
    targetMoisture: 0.6,
    temperature: 0.46,
    targetTemperature: 0.46,
    wind: 0.42,
    targetWind: 0.42,
    energy: 0,
  };

  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let animationFrame = 0;
  let resizeFrame = 0;
  let lastTime = performance.now();
  let lastPaint = -Infinity;

  const layers = [
    { base: 0.56, amplitude: 0.3, parallax: 0.34, scale: 1.45 },
    { base: 0.7, amplitude: 0.29, parallax: 0.62, scale: 1.18 },
    { base: 0.83, amplitude: 0.27, parallax: 1, scale: 1 },
  ];

  function controlsFor(layerIndex) {
    return {
      seed: avalanche(state.seed + layerIndex * 0x9e3779b1),
      offset: state.offset * (0.55 + layerIndex * 0.22),
      elevation: state.elevation,
      moisture: state.moisture,
    };
  }

  function terrainY(screenX, layerIndex, controls = controlsFor(layerIndex)) {
    const layer = layers[layerIndex];
    const world =
      state.worldX * layer.parallax + screenX * layer.scale;
    const terrain = minecraftTerrainHeight(
      world,
      layerIndex,
      controls,
    );
    return height * (layer.base - terrain * layer.amplitude);
  }

  function lakeHorizonY() {
    return height * (0.565 - (state.elevation - 0.5) * 0.018);
  }

  function valleyCenterRatio() {
    return 0.51 + Math.sin(state.worldX * 0.00017) * 0.018;
  }

  function bankY(screenX, controls = controlsFor(2)) {
    const opening = lakeValleyOpening(
      screenX,
      width,
      valleyCenterRatio(),
    );
    const shoreline = octaveNoise(
      (state.worldX + screenX * 1.8) * 0.0043,
      state.seed ^ 0x71ac9e37,
      3,
      0.52,
      2.06,
    );
    return (
      terrainY(screenX, 2, controls) +
      opening * height * 0.57 +
      (shoreline - 0.5) * height * 0.055
    );
  }

  function terrainPoints(layerIndex, transformY = null) {
    const step = Math.max(6, Math.ceil(width / 190));
    const points = [];
    const controls = controlsFor(layerIndex);

    for (let x = -step; x <= width + step; x += step) {
      const y = terrainY(x, layerIndex, controls);
      points.push({
        x,
        y: transformY ? transformY(x, y, controls) : y,
      });
    }

    return points;
  }

  function traceSurface(points) {
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      context.quadraticCurveTo(
        previous.x,
        previous.y,
        (previous.x + point.x) / 2,
        (previous.y + point.y) / 2,
      );
    }
    const finalPoint = points.at(-1);
    context.lineTo(finalPoint.x, finalPoint.y);
  }

  function drawSky() {
    const coolTop = [68, 105, 138];
    const warmTop = [121, 91, 126];
    const coolHorizon = [195, 222, 213];
    const warmHorizon = [250, 186, 128];
    const warmth = clamp(state.temperature * 0.78 + state.energy * 0.12);

    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, colorMix(coolTop, warmTop, warmth));
    sky.addColorStop(
      0.7,
      colorMix(coolHorizon, warmHorizon, warmth, 1),
    );
    sky.addColorStop(1, colorMix([196, 217, 209], [232, 202, 163], warmth));
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);

    const glowX = width * (0.7 + Math.sin(state.worldX * 0.00012) * 0.025);
    const glowY = height * 0.2;
    const glowRadius = Math.max(width, height) * (0.22 + state.energy * 0.04);
    const glow = context.createRadialGradient(
      glowX,
      glowY,
      0,
      glowX,
      glowY,
      glowRadius,
    );
    glow.addColorStop(0, `rgba(255, 239, 184, ${0.34 + state.energy * 0.14})`);
    glow.addColorStop(0.22, "rgba(255, 235, 181, 0.13)");
    glow.addColorStop(1, "rgba(255, 244, 213, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    context.beginPath();
    context.arc(glowX, glowY, Math.max(12, height * 0.024), 0, Math.PI * 2);
    context.fillStyle = `rgba(255, 235, 180, ${0.28 + state.energy * 0.08})`;
    context.fill();
  }

  function drawTerrainLayer(layerIndex, points = terrainPoints(layerIndex)) {
    context.beginPath();
    context.moveTo(points[0].x, height);
    traceSurface(points);
    const finalPoint = points.at(-1);
    context.lineTo(finalPoint.x, height);
    context.closePath();

    const coolColors = [
      [[84, 116, 116], [65, 96, 94]],
      [[57, 99, 78], [40, 76, 59]],
      [[42, 81, 59], [27, 60, 42]],
    ];
    const warmColors = [
      [[129, 126, 91], [99, 107, 76]],
      [[96, 111, 66], [68, 91, 53]],
      [[65, 93, 49], [38, 69, 39]],
    ];
    const warmth = clamp(state.temperature * 0.78);
    const top = colorMix(
      coolColors[layerIndex][0],
      warmColors[layerIndex][0],
      warmth,
      0.78 + layerIndex * 0.08,
    );
    const bottom = colorMix(
      coolColors[layerIndex][1],
      warmColors[layerIndex][1],
      warmth,
      0.9 + layerIndex * 0.04,
    );
    const fill = context.createLinearGradient(0, height * 0.42, 0, height);
    fill.addColorStop(0, top);
    fill.addColorStop(1, bottom);
    context.fillStyle = fill;
    context.fill();

    context.strokeStyle = colorMix(
      [233, 240, 224],
      [246, 226, 174],
      warmth,
      0.14 + layerIndex * 0.04,
    );
    context.lineWidth = 1;
    context.stroke();

    return points;
  }

  function drawMountainReflection(points, color, strength) {
    const horizon = lakeHorizonY();
    context.beginPath();
    context.moveTo(points[0].x, horizon);
    for (const point of points) {
      const reflectedY = horizon + Math.max(0, horizon - point.y) * 0.58;
      context.lineTo(point.x, reflectedY);
    }
    context.lineTo(points.at(-1).x, horizon);
    context.closePath();
    context.fillStyle = `rgba(${color.join(", ")}, ${strength})`;
    context.fill();
  }

  function drawLake(farMountains, middleMountains) {
    const horizon = lakeHorizonY();
    const warmth = clamp(state.temperature * 0.78 + state.energy * 0.1);
    const water = context.createLinearGradient(0, horizon, 0, height);
    water.addColorStop(
      0,
      colorMix([180, 204, 201], [231, 194, 145], warmth),
    );
    water.addColorStop(
      0.45,
      colorMix([105, 148, 151], [162, 139, 100], warmth),
    );
    water.addColorStop(
      1,
      colorMix([55, 96, 105], [93, 91, 67], warmth),
    );
    context.fillStyle = water;
    context.fillRect(0, horizon, width, height - horizon);

    context.save();
    context.beginPath();
    context.rect(0, horizon, width, height - horizon);
    context.clip();
    drawMountainReflection(farMountains, [65, 94, 98], 0.15);
    drawMountainReflection(middleMountains, [37, 78, 69], 0.2);

    const glowX = width * (0.7 + Math.sin(state.worldX * 0.00012) * 0.025);
    const reflection = context.createLinearGradient(0, horizon, 0, height);
    reflection.addColorStop(0, `rgba(255, 231, 176, ${0.24 + state.energy * 0.08})`);
    reflection.addColorStop(1, "rgba(255, 218, 148, 0)");
    context.beginPath();
    context.moveTo(glowX - width * 0.018, horizon);
    context.lineTo(glowX + width * 0.018, horizon);
    context.lineTo(glowX + width * 0.16, height);
    context.lineTo(glowX - width * 0.16, height);
    context.closePath();
    context.fillStyle = reflection;
    context.fill();

    const lakeDepth = Math.max(1, height - horizon);
    const phase = state.worldX * 0.018;
    context.lineCap = "round";
    for (let index = 0; index < 16; index += 1) {
      const depth = (index + 1) / 17;
      const y = horizon + lakeDepth * depth * depth;
      const rippleWidth = width * mix(0.045, 0.27, depth);
      const drift = Math.sin(phase * (0.34 + depth) + index * 1.7) * width * 0.025;
      context.beginPath();
      context.moveTo(glowX + drift - rippleWidth, y);
      context.lineTo(glowX + drift + rippleWidth, y);
      context.strokeStyle = `rgba(255, 234, 188, ${mix(0.19, 0.045, depth)})`;
      context.lineWidth = mix(0.7, 2.2, depth);
      context.stroke();
    }

    for (let index = 0; index < 12; index += 1) {
      const depth = (index + 0.5) / 12;
      const y = horizon + lakeDepth * depth;
      const waveOffset = Math.sin(phase + index * 2.1) * 20;
      context.beginPath();
      context.moveTo(-40 + waveOffset, y);
      context.lineTo(width + 40 + waveOffset, y);
      context.strokeStyle = `rgba(226, 238, 225, ${mix(0.11, 0.025, depth)})`;
      context.lineWidth = 0.7;
      context.stroke();
    }
    context.restore();
  }

  function drawValleyBanks() {
    const points = terrainPoints(2, (x, _y, controls) => bankY(x, controls));
    context.beginPath();
    context.moveTo(points[0].x, height);
    traceSurface(points);
    context.lineTo(points.at(-1).x, height);
    context.closePath();

    const warmth = clamp(state.temperature * 0.72);
    const bank = context.createLinearGradient(0, lakeHorizonY(), 0, height);
    bank.addColorStop(0, colorMix([43, 76, 61], [74, 83, 49], warmth));
    bank.addColorStop(0.72, colorMix([27, 60, 43], [55, 68, 37], warmth));
    bank.addColorStop(1, colorMix([29, 47, 35], [57, 52, 32], warmth));
    context.fillStyle = bank;
    context.fill();

    context.strokeStyle = colorMix(
      [190, 210, 188],
      [230, 201, 145],
      warmth,
      0.22,
    );
    context.lineWidth = 1;
    context.stroke();
  }

  function drawForest() {
    const spacing = mix(48, 29, state.moisture);
    const drift = state.worldX * 0.34;
    const startIndex = Math.floor(drift / spacing) - 2;
    const endIndex = startIndex + Math.ceil(width / spacing) + 5;
    const warmth = clamp(state.temperature * 0.7);
    const foregroundControls = controlsFor(2);

    context.fillStyle = colorMix(
      [21, 56, 43],
      [42, 70, 35],
      warmth,
      0.55,
    );

    for (let treeIndex = startIndex; treeIndex <= endIndex; treeIndex += 1) {
      const treeNoise = latticeNoise(treeIndex, state.seed ^ 0x6d2b79f5);
      if (treeNoise < mix(0.38, 0.14, state.moisture)) continue;

      const x = treeIndex * spacing - drift;
      const groundY = bankY(x, foregroundControls) + 3;
      if (groundY > height + 8) continue;
      const perspective = clamp(
        (groundY - lakeHorizonY()) / Math.max(1, height - lakeHorizonY()),
      );
      const treeHeight = (16 + treeNoise * 28) * mix(0.75, 1.3, perspective);
      const treeWidth = treeHeight * 0.42;

      context.fillRect(x - 0.7, groundY - treeHeight * 0.22, 1.4, treeHeight * 0.24);
      context.beginPath();
      context.moveTo(x, groundY - treeHeight);
      context.lineTo(x - treeWidth * 0.55, groundY - treeHeight * 0.45);
      context.lineTo(x - treeWidth * 0.27, groundY - treeHeight * 0.48);
      context.lineTo(x - treeWidth, groundY - treeHeight * 0.1);
      context.lineTo(x + treeWidth, groundY - treeHeight * 0.1);
      context.lineTo(x + treeWidth * 0.27, groundY - treeHeight * 0.48);
      context.lineTo(x + treeWidth * 0.55, groundY - treeHeight * 0.45);
      context.closePath();
      context.fill();
    }
  }

  function draw() {
    drawSky();
    const farMountains = drawTerrainLayer(0);
    const middleMountains = drawTerrainLayer(1);
    drawLake(farMountains, middleMountains);
    drawValleyBanks();
    drawForest();

    const veil = context.createLinearGradient(0, 0, 0, height);
    veil.addColorStop(0, "rgba(248, 247, 238, 0.025)");
    veil.addColorStop(0.52, "rgba(248, 241, 220, 0.065)");
    veil.addColorStop(0.62, "rgba(238, 243, 232, 0.12)");
    veil.addColorStop(1, "rgba(226, 235, 223, 0.06)");
    context.fillStyle = veil;
    context.fillRect(0, 0, width, height);
  }

  function settleToTargets(elapsed) {
    const climateEase = 1 - Math.exp(-elapsed / 4_800);
    const offsetEase = 1 - Math.exp(-elapsed / 3_200);
    state.elevation = mix(state.elevation, state.targetElevation, climateEase);
    state.moisture = mix(state.moisture, state.targetMoisture, climateEase);
    state.temperature = mix(
      state.temperature,
      state.targetTemperature,
      climateEase,
    );
    state.wind = mix(state.wind, state.targetWind, climateEase);
    state.offset = mix(state.offset, state.targetOffset, offsetEase);
    state.energy *= Math.exp(-elapsed / 7_500);
  }

  function frame(now) {
    animationFrame = 0;
    if (document.hidden || motionPreference.matches) return;

    if (now - lastPaint >= TARGET_FRAME_MS) {
      const elapsed = clamp(now - lastTime, 0, 80);
      lastTime = now;
      lastPaint = now;
      settleToTargets(elapsed);
      state.worldX +=
        (elapsed / 1_000) * (4.2 + state.wind * 3.5 + state.energy * 8.5);
      draw();
    }

    animationFrame = requestAnimationFrame(frame);
  }

  function start() {
    if (animationFrame || document.hidden || motionPreference.matches) return;
    lastTime = performance.now();
    animationFrame = requestAnimationFrame(frame);
  }

  function stop() {
    if (!animationFrame) return;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function resize() {
    width = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
    height = Math.max(1, document.documentElement.clientHeight || window.innerHeight);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    draw();
  }

  function scheduleResize() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
    });
  }

  function handleMotionPreference() {
    if (motionPreference.matches) {
      stop();
      state.elevation = state.targetElevation;
      state.moisture = state.targetMoisture;
      state.temperature = state.targetTemperature;
      state.wind = state.targetWind;
      state.offset = state.targetOffset;
      draw();
    } else {
      start();
    }
  }

  function ingest(signal) {
    if (!signal.count) return;
    const influence = clamp(
      0.12 + Math.log2(signal.count + 1) * 0.045,
      0.12,
      0.42,
    );
    state.targetElevation = mix(
      state.targetElevation,
      signal.elevation,
      influence,
    );
    state.targetMoisture = mix(
      state.targetMoisture,
      signal.moisture,
      influence,
    );
    state.targetTemperature = mix(
      state.targetTemperature,
      signal.temperature,
      influence,
    );
    state.targetWind = mix(state.targetWind, signal.wind, influence);
    state.targetOffset +=
      (signal.signature / UINT32_MAX - 0.5) * 150 +
      Math.min(signal.count, 160) * 0.35;
    state.energy = clamp(
      state.energy + 0.14 + Math.log1p(signal.count) * 0.075,
    );

    if (motionPreference.matches) handleMotionPreference();
  }

  window.addEventListener("resize", scheduleResize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  if (typeof motionPreference.addEventListener === "function") {
    motionPreference.addEventListener("change", handleMotionPreference);
  } else {
    motionPreference.addListener(handleMotionPreference);
  }

  resize();
  start();
  return { ingest };
}

const terrainCanvas =
  typeof document === "undefined"
    ? null
    : document.querySelector("#terrain-background");
const terrain =
  typeof HTMLCanvasElement !== "undefined" &&
  terrainCanvas instanceof HTMLCanvasElement
    ? createTerrain(terrainCanvas)
    : null;

export function modulateTerrain(value) {
  const signal = terrainTokenSignal(value);
  terrain?.ingest(signal);
  return signal;
}

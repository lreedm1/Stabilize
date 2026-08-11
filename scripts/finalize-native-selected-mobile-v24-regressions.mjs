import { readdir, readFile, writeFile } from "node:fs/promises";

const NATIVE_FINALIZER =
  "node scripts/finalize-native-selected-mobile-v24.mjs";
const REGRESSION_FINALIZER =
  "node scripts/finalize-native-selected-mobile-v24-regressions.mjs";
const VERSION = "20260810-native-selected-mobile-v24-1";
const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v24-native-1080.webp";
const POSTER_NAME = "mobile-forest-stream-v24-native-1080";
const NATIVE_TAIL =
  "node scripts/finalize-decision-grade-impact.mjs && " +
  `${NATIVE_FINALIZER} && ${REGRESSION_FINALIZER}`;
const ZOOM_SAFE_QUERY =
  "(orientation: portrait) and (hover: none) and (pointer: coarse)";
const ZOOM_STYLE_MARKER = "mobile-zoom-stable-style";
const FOUR_K_RENDER_MARKER = "mobile-video-4k-render-v1-start";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

const packagePath = "package.json";
const packageData = JSON.parse(await readFile(packagePath, "utf8"));
const policy = packageData.scripts?.["apply:prompt-policy"];
if (typeof policy !== "string" || !policy.trim()) {
  throw new Error("package.json is missing apply:prompt-policy");
}

const canonicalPolicy = [
  ...policy
    .split(" && ")
    .filter(
      (command) =>
        command !== NATIVE_FINALIZER && command !== REGRESSION_FINALIZER,
    ),
  NATIVE_FINALIZER,
  REGRESSION_FINALIZER,
].join(" && ");
packageData.scripts["apply:prompt-policy"] = canonicalPolicy;
await writeFile(packagePath, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");

// Several focused regression tests intentionally pin the complete generator
// chain. Keep those literals and tail assertions aligned after older
// generators rebuild them.
const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/finalize-decision-grade-impact\.mjs[^"\n]*"/g;
const oldDecisionTail =
  "/finalize-decision-grade-impact\\.mjs$/";
const newDecisionTail =
  "/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs$/";
const oldClientTail =
  "/apply-client-response-time\\.mjs && node scripts\\/finalize-decision-grade-impact\\.mjs$/";
const newClientTail =
  "/apply-client-response-time\\.mjs && node scripts\\/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs$/";
const testNames = (await readdir("test"))
  .filter((name) => name.endsWith(".mjs"))
  .sort();

for (const name of testNames) {
  await update(`test/${name}`, (source) =>
    source
      .replace(commandLiteralPattern, JSON.stringify(canonicalPolicy))
      .replaceAll(oldClientTail, newClientTail)
      .replaceAll(oldDecisionTail, newDecisionTail),
  );
}

await update("test/mobile-background-loading.test.mjs", (source) =>
  source
    .replace(
      "/finalize-native-selected-mobile-v24\\.mjs$/",
      "/finalize-native-selected-mobile-v24-regressions\\.mjs$/",
    )
    .replaceAll(
      "Exact canvas mobile release is live",
      "Native video and canvas fallback are live",
    ),
);

await update("test/shared-site-theme.test.mjs", (source) =>
  source
    .replace(
      /^const VERSION = "[^"]+";/m,
      `const VERSION = "${VERSION}";`,
    )
    .replaceAll(
      "/scenes/mobile-forest-stream-v23-ai-2160.webp",
      POSTER_ASSET,
    )
    .replaceAll(
      "/scenes/mobile-forest-stream-v14-retina-2160.webp",
      POSTER_ASSET,
    )
    .replaceAll("mobile-forest-stream-v23-ai-2160", POSTER_NAME)
    .replaceAll("mobile-forest-stream-v14-retina-2160", POSTER_NAME),
);

// The older v23 selector performs one intentionally broad source-label
// replacement. Collapse any repetition it creates before the clean-tree gate.
// Also make mobile eligibility independent of CSS viewport width. Pinch zoom in
// iOS Safari can change width-query results even though the device is still the
// same portrait touch phone.
await update("public/mobile-quality.js", (source) => {
  let next = source;
  while (
    next.includes(
      "selected-forest-stream-native-source-native-source",
    )
  ) {
    next = next.replaceAll(
      "selected-forest-stream-native-source-native-source",
      "selected-forest-stream-native-source",
    );
  }

  next = next.replace(
    /const MOBILE_BACKGROUND_QUERY =\n\s+"[^"]+";/,
    `const MOBILE_BACKGROUND_QUERY =\n  "${ZOOM_SAFE_QUERY}";`,
  );

  if (!next.includes(ZOOM_STYLE_MARKER)) {
    const anchor = "const MAX_AUTOPLAY_RETRIES = 10;";
    if (!next.includes(anchor)) {
      throw new Error("Could not find mobile video configuration anchor.");
    }
    const runtimeStyle = `${anchor}\n\nfunction installZoomStableStyles() {\n  if (document.getElementById("${ZOOM_STYLE_MARKER}")) return;\n  const style = document.createElement("style");\n  style.id = "${ZOOM_STYLE_MARKER}";\n  style.textContent = \`@media ${ZOOM_SAFE_QUERY} {\n    .photo-backdrop {\n      background-image: url("/scenes/mobile-forest-stream-v14-retina-2160.webp") !important;\n      background-size: cover !important;\n      background-position: 50% 50% !important;\n      background-repeat: no-repeat !important;\n    }\n    #photo-backdrop-image { visibility: hidden !important; opacity: 0 !important; }\n    .mobile-background-video {\n      position: fixed !important; inset: 0 !important; z-index: 0 !important;\n      display: block !important; width: 100% !important; height: 100% !important;\n      object-fit: cover !important; object-position: 50% 50% !important;\n      pointer-events: none !important;\n    }\n    html[data-mobile-background="video-playing"] .mobile-background-video.is-playing,\n    .mobile-background-video.is-playing { visibility: visible !important; opacity: 1 !important; }\n    .mobile-motion-canvas.is-ready {\n      display: block !important; visibility: visible !important; opacity: 1 !important;\n    }\n  }\`;\n  document.head.append(style);\n}\n\ninstallZoomStableStyles();`;
    next = next.replace(anchor, runtimeStyle);
  }

  if (!next.includes(FOUR_K_RENDER_MARKER)) {
    next = `${next.trimEnd()}\n\n/* ${FOUR_K_RENDER_MARKER} */\n(() => {\n  const RENDER_WIDTH = 2160;\n  const RENDER_HEIGHT = 3840;\n  const sourceVideo = document.querySelector("#mobile-background-video");\n  const portraitTouch = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);\n  let canvas = null;\n  let context = null;\n  let frameHandle = null;\n  let frameMode = null;\n\n  function eligible4k() {\n    return (\n      sourceVideo instanceof HTMLVideoElement &&\n      portraitTouch?.matches === true &&\n      !document.hidden\n    );\n  }\n\n  function ensureCanvas() {\n    if (!(sourceVideo instanceof HTMLVideoElement)) return null;\n    if (canvas instanceof HTMLCanvasElement && context) return canvas;\n\n    canvas = document.createElement("canvas");\n    canvas.id = "mobile-background-video-4k";\n    canvas.width = RENDER_WIDTH;\n    canvas.height = RENDER_HEIGHT;\n    canvas.setAttribute("aria-hidden", "true");\n    canvas.style.position = "fixed";\n    canvas.style.inset = "0";\n    canvas.style.zIndex = "0";\n    canvas.style.width = "100%";\n    canvas.style.height = "100%";\n    canvas.style.pointerEvents = "none";\n    canvas.style.userSelect = "none";\n    canvas.style.transform = "translate3d(0, 0, 0)";\n    canvas.style.backfaceVisibility = "hidden";\n    canvas.style.setProperty("opacity", "0", "important");\n    canvas.style.setProperty("visibility", "hidden", "important");\n\n    context = canvas.getContext("2d", { alpha: false, desynchronized: true });\n    if (!context) {\n      canvas = null;\n      return null;\n    }\n    context.imageSmoothingEnabled = true;\n    context.imageSmoothingQuality = "high";\n    sourceVideo.insertAdjacentElement("afterend", canvas);\n    return canvas;\n  }\n\n  function drawFrame() {\n    if (\n      !eligible4k() ||\n      !(canvas instanceof HTMLCanvasElement) ||\n      !context ||\n      sourceVideo.readyState < 2 ||\n      sourceVideo.videoWidth <= 0 ||\n      sourceVideo.videoHeight <= 0\n    ) return false;\n\n    const sourceAspect = sourceVideo.videoWidth / sourceVideo.videoHeight;\n    const targetAspect = RENDER_WIDTH / RENDER_HEIGHT;\n    let sx = 0;\n    let sy = 0;\n    let sw = sourceVideo.videoWidth;\n    let sh = sourceVideo.videoHeight;\n    if (sourceAspect > targetAspect) {\n      sw = sourceVideo.videoHeight * targetAspect;\n      sx = (sourceVideo.videoWidth - sw) / 2;\n    } else if (sourceAspect < targetAspect) {\n      sh = sourceVideo.videoWidth / targetAspect;\n      sy = (sourceVideo.videoHeight - sh) / 2;\n    }\n\n    context.drawImage(sourceVideo, sx, sy, sw, sh, 0, 0, RENDER_WIDTH, RENDER_HEIGHT);\n    canvas.style.setProperty("visibility", "visible", "important");\n    canvas.style.setProperty("opacity", "1", "important");\n    sourceVideo.style.setProperty("visibility", "hidden", "important");\n    sourceVideo.style.setProperty("opacity", "0", "important");\n    document.documentElement.dataset.mobileVideoSourceQuality = "native-source-1080x1920";\n    document.documentElement.dataset.mobileVideoRender = "2160x3840";\n    document.documentElement.dataset.mobileVideoQuality = "4k-render-2160x3840";\n    return true;\n  }\n\n  function loop() {\n    frameHandle = null;\n    frameMode = null;\n    if (!drawFrame() || sourceVideo.paused) return;\n    if (typeof sourceVideo.requestVideoFrameCallback === "function") {\n      frameMode = "video";\n      frameHandle = sourceVideo.requestVideoFrameCallback(loop);\n    } else {\n      frameMode = "animation";\n      frameHandle = requestAnimationFrame(loop);\n    }\n  }\n\n  function start() {\n    if (!eligible4k() || sourceVideo.paused) return;\n    if (!ensureCanvas() || frameHandle !== null) return;\n    loop();\n  }\n\n  function stop() {\n    if (frameHandle !== null) {\n      if (frameMode === "video" && typeof sourceVideo.cancelVideoFrameCallback === "function") {\n        try { sourceVideo.cancelVideoFrameCallback(frameHandle); } catch {}\n      } else if (frameMode === "animation") {\n        cancelAnimationFrame(frameHandle);\n      }\n    }\n    frameHandle = null;\n    frameMode = null;\n    if (canvas instanceof HTMLCanvasElement) {\n      canvas.style.setProperty("opacity", "0", "important");\n      canvas.style.setProperty("visibility", "hidden", "important");\n    }\n    if (sourceVideo instanceof HTMLVideoElement) {\n      sourceVideo.style.removeProperty("opacity");\n      sourceVideo.style.removeProperty("visibility");\n    }\n  }\n\n  if (sourceVideo instanceof HTMLVideoElement) {\n    for (const event of ["playing", "loadeddata", "canplay"]) {\n      sourceVideo.addEventListener(event, start);\n    }\n    sourceVideo.addEventListener("pause", stop);\n    sourceVideo.addEventListener("error", stop);\n  }\n  portraitTouch?.addEventListener?.("change", (event) => {\n    if (event.matches) start();\n    else stop();\n  });\n  document.addEventListener("visibilitychange", () => {\n    if (document.hidden) stop();\n    else start();\n  });\n  globalThis.addEventListener("pageshow", start);\n  globalThis.addEventListener("orientationchange", () => setTimeout(start, 0));\n  globalThis.addEventListener("pagehide", stop);\n  start();\n})();\n/* mobile-video-4k-render-v1-end */\n`;
  }

  return next;
});

await update("public/mobile-static-fallback-fix-20260811.css", () => `/* Zoom-stable portrait-touch background rules.\n   Do not key these layers to CSS viewport width: iOS Safari can reevaluate\n   width media queries while pinch-zooming and expose the desktop lake asset. */\n@media ${ZOOM_SAFE_QUERY} {\n  .photo-backdrop {\n    background-image: url("/scenes/mobile-forest-stream-v14-retina-2160.webp") !important;\n    background-size: cover !important;\n    background-position: 50% 50% !important;\n    background-repeat: no-repeat !important;\n  }\n\n  .photo-backdrop > picture,\n  .photo-backdrop > img,\n  #photo-backdrop-image {\n    visibility: hidden !important;\n    opacity: 0 !important;\n  }\n\n  .mobile-background-video {\n    position: fixed !important;\n    z-index: 0 !important;\n    inset: 0 !important;\n    display: block !important;\n    width: 100% !important;\n    height: 100% !important;\n    object-fit: cover !important;\n    object-position: 50% 50% !important;\n    pointer-events: none !important;\n  }\n\n  html[data-mobile-background="video-playing"] .mobile-background-video.is-playing,\n  .mobile-background-video.is-playing {\n    visibility: visible !important;\n    opacity: 1 !important;\n  }\n\n  .mobile-motion-canvas.is-ready {\n    display: block !important;\n    visibility: visible !important;\n    opacity: 1 !important;\n  }\n}\n`);

// The historical canvas workflow used to prove that no video existed. The
// native release intentionally keeps the canvas as a fallback beneath one
// visible video element, so the fallback gate must verify coexistence instead.
await update(".github/workflows/verify-mobile-background.yml", (source) =>
  source
    .replaceAll(
      "&& ! grep -Fq 'id=\"mobile-background-video\"' \"$tmpdir/live.html\" \\",
      "&& grep -Fq 'id=\"mobile-background-video\"' \"$tmpdir/live.html\" \\",
    )
    .replaceAll(
      "&& ! grep -Fq 'mobile-quality.js' \"$tmpdir/live.html\" \\",
      "&& grep -Fq 'mobile-quality.js' \"$tmpdir/live.html\" \\",
    )
    .replaceAll(
      "if (first.videoCount !== 0 || second.videoCount !== 0) {",
      "if (first.videoCount !== 1 || second.videoCount !== 1) {",
    )
    .replaceAll(
      'throw new Error("A tap-gated background video is still present.");',
      'throw new Error("The native background video is missing or duplicated.");',
    )
    .replaceAll(
      "Production serves the exact Retina-poster plus canvas-motion release.",
      "Production serves the native video with its exact canvas fallback.",
    ),
);

if (!canonicalPolicy.endsWith(NATIVE_TAIL)) {
  throw new Error("The native finalizers are not the canonical policy tail.");
}

console.log(
  "Finalized repeatable native mobile media policy, zoom-stable selection, and 4K display rendering.",
);

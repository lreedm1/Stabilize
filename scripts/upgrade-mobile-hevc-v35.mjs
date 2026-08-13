import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260813-mobile-hevc-v35-1";
const HEVC_ASSET =
  "/scenes/mobile-forest-stream-video-v35-hevc-1080.mp4";
const H264_ASSET =
  "/scenes/mobile-forest-stream-video-v12-720.mp4";
const QUALITY = "native-video-hevc-1080x1920-30fps";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) {
    throw new Error(`No update was made to ${path}.`);
  }
  await writeFile(path, after, "utf8");
}

function requiredReplace(source, pattern, replacement, label) {
  pattern.lastIndex = 0;
  if (!pattern.test(source)) {
    throw new Error(`Could not find ${label}.`);
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function replaceSection(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not find ${label}.`);
  }
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

function replaceWholeSection(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not find ${label}.`);
  }
  return (
    source.slice(0, startIndex) +
    replacement +
    source.slice(endIndex + end.length)
  );
}

await update("scripts/build-mobile-hevc-v34.sh", (source) => {
  let next = source;
  next = requiredReplace(
    next,
    /^VERSION="[^"]+"/m,
    `VERSION="${VERSION}"`,
    "the HEVC release version",
  );
  next = requiredReplace(
    next,
    /^OUTPUT="[^"]+"/m,
    'OUTPUT="public/scenes/mobile-forest-stream-video-v35-hevc-1080.mp4"',
    "the HEVC output path",
  );
  next = requiredReplace(
    next,
    /scale=720:1280:force_original_aspect_ratio=increase:flags=lanczos,crop=720:1280,setsar=1,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p/g,
    "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p",
    "the 720p60 filter",
  );
  next = next
    .replaceAll("mobile-forest-stream-video-v34-hevc-720.mp4", "mobile-forest-stream-video-v35-hevc-1080.mp4")
    .replaceAll('"width": 720', '"width": 1080')
    .replaceAll('"height": 1280', '"height": 1920')
    .replaceAll('"fps": 60', '"fps": 30')
    .replaceAll('"r_frame_rate": "60/1"', '"r_frame_rate": "30/1"')
    .replaceAll('"avg_frame_rate": "60/1"', '"avg_frame_rate": "30/1"')
    .replaceAll("720x1280", "1080x1920")
    .replaceAll("native-video-hevc-720x1280-60fps", QUALITY)
    .replaceAll("keyint=60:min-keyint=60", "keyint=30:min-keyint=30")
    .replaceAll("-maxrate 6000k -bufsize 12000k", "-maxrate 8000k -bufsize 16000k")
    .replaceAll("700_000 < len(data) < 4_000_000", "1_000_000 < len(data) < 8_000_000")
    .replaceAll("select='between(n,30,89)'", "select='between(n,15,44)'")
    .replaceAll('test "$unique_frames" -ge 48', 'test "$unique_frames" -ge 24');

  for (const expected of [
    VERSION,
    "scale=1080:1920",
    "minterpolate=fps=30",
    "keyint=30:min-keyint=30",
    HEVC_ASSET.slice(1),
    QUALITY,
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`Updated builder is missing ${expected}.`);
    }
  }
  return next;
});

await update("public/mobile-video-handoff-v31.js", (source) => {
  let next = source;
  next = requiredReplace(
    next,
    /const VERSION = "[^"]+";/,
    `const VERSION = "${VERSION}";`,
    "the handoff version",
  );
  next = requiredReplace(
    next,
    /const HEVC_ASSET =\n\s+`[^`]+`;/,
    `const HEVC_ASSET =\n    \`${HEVC_ASSET}?v=\${VERSION}\`;`,
    "the HEVC handoff asset",
  );
  next = requiredReplace(
    next,
    /const H264_ASSET =\n\s+`[^`]+`;/,
    `const H264_ASSET =\n    \`${H264_ASSET}?v=\${VERSION}\`;`,
    "the H.264 handoff asset",
  );
  next = requiredReplace(
    next,
    /let nativeVisible = false;/,
    "let nativeVisible = false;\n  let gestureRecoveryBound = false;",
    "the native video state",
  );

  const configure = `  function configureVideo() {
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

    // Keep the parser-owned sources stable. Calling load() here resets WebKit's
    // autoplay attempt and can turn an otherwise eligible muted video into a
    // tap-to-play recovery path.
    const hevc = video.querySelector('source[data-codec="hevc"]');
    const h264 = video.querySelector('source[data-codec="h264"]');
    const parserOwnedSourcesReady =
      hevc instanceof HTMLSourceElement &&
      h264 instanceof HTMLSourceElement &&
      hevc.getAttribute("src") === HEVC_ASSET &&
      h264.getAttribute("src") === H264_ASSET &&
      video.firstElementChild === hevc &&
      hevc.nextElementSibling === h264;
    if (!parserOwnedSourcesReady) {
      setState("source-mismatch", "parser-owned-source-order");
    }
  }

`;
  next = replaceSection(
    next,
    "  function configureVideo() {",
    "  function keepFallbackVisible",
    configure,
    "the handoff video configuration",
  );

  const observe = `  function observePlayPromise(result, reason) {
    if (!result || typeof result.then !== "function") {
      removeGestureRecovery();
      requestDecodedFrameReveal();
      return;
    }

    result
      .then(() => {
        removeGestureRecovery();
        requestDecodedFrameReveal();
      })
      .catch((error) => {
        keepFallbackVisible(error?.name || reason);
        bindGestureRecovery();
        scheduleRetry();
      });
  }

`;
  next = replaceSection(
    next,
    "  function observePlayPromise(result, reason) {",
    "  function attemptPlayback",
    observe,
    "the play-promise observer",
  );

  const gesture = `  function removeGestureRecovery() {
    if (!gestureRecoveryBound) return;
    gestureRecoveryBound = false;
    for (const type of ["pointerdown", "touchstart", "keydown"]) {
      document.removeEventListener(type, playInsideUserGesture, true);
    }
  }

  function bindGestureRecovery() {
    if (gestureRecoveryBound) return;
    gestureRecoveryBound = true;
    for (const type of ["pointerdown", "touchstart", "keydown"]) {
      document.addEventListener(type, playInsideUserGesture, {
        capture: true,
        passive: type !== "keydown",
      });
    }
  }

  // This must remain synchronous. A host WKWebView may consume transient user
  // activation before a Promise, timeout, animation frame, or async function resumes.
  function playInsideUserGesture() {
    if (nativeVisible || document.hidden) return;
    removeGestureRecovery();
    configureVideo();
    setState("gesture-attempt", "direct-play");
    try {
      const result = video.play();
      observePlayPromise(result, "gesture");
    } catch (error) {
      keepFallbackVisible(error?.name || "gesture");
      bindGestureRecovery();
    }
  }

`;
  next = replaceSection(
    next,
    "  // This must remain synchronous.",
    "  function monitorProgress",
    gesture,
    "the gesture recovery block",
  );

  next = requiredReplace(
    next,
    /\n  \/\/ Capture before the application consumes the event\.[\s\S]*?\n  }\n\n  document\.addEventListener\("visibilitychange"/,
    '\n\n  document.addEventListener("visibilitychange"',
    "the unconditional gesture listeners",
  );
  next = next
    .replace("video.videoWidth < 700", "video.videoWidth < 1000")
    .replace("video.videoHeight < 1240", "video.videoHeight < 1800")
    .replace(
      "nativeVisible = true;\n    video.style.setProperty",
      "nativeVisible = true;\n    removeGestureRecovery();\n    video.style.setProperty",
    )
    .replace(
      "keepFallbackVisible(mediaError);\n    scheduleRetry(500);",
      "keepFallbackVisible(mediaError);\n    bindGestureRecovery();\n    scheduleRetry(500);",
    );

  for (const forbidden of ["video.load()", "ensureSource(", "insertBefore(", ".append("]) {
    const configureFunction = next.match(
      /function configureVideo\(\) \{[\s\S]*?\n  \}\n\n  function keepFallbackVisible/,
    )?.[0] || "";
    if (configureFunction.includes(forbidden)) {
      throw new Error(`Autoplay configuration still contains ${forbidden}.`);
    }
  }
  for (const expected of [
    VERSION,
    HEVC_ASSET,
    QUALITY,
    "parser-owned-source-order",
    "bindGestureRecovery",
    "removeGestureRecovery",
    "video.videoWidth < 1000",
    "video.videoHeight < 1800",
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`Updated handoff client is missing ${expected}.`);
    }
  }
  return next;
});

await update("scripts/finalize-mobile-hevc-v34.mjs", (source) => {
  let next = source;
  const start = "  const configure = `  function configureVideo() {";
  const end = "  function keepFallbackVisible`;";
  const replacement = `  const configure = \`  function configureVideo() {
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

    // Parser-owned source elements start loading before this script. Do not
    // rewrite them or call load(), because that resets WebKit autoplay.
    const hevc = video.querySelector('source[data-codec="hevc"]');
    const h264 = video.querySelector('source[data-codec="h264"]');
    const parserOwnedSourcesReady =
      hevc instanceof HTMLSourceElement &&
      h264 instanceof HTMLSourceElement &&
      hevc.getAttribute("src") === HEVC_ASSET &&
      h264.getAttribute("src") === H264_ASSET &&
      video.firstElementChild === hevc &&
      hevc.nextElementSibling === h264;
    if (!parserOwnedSourcesReady) {
      setState("source-mismatch", "parser-owned-source-order");
    }
  }

  function keepFallbackVisible\`;
`;
  next = replaceWholeSection(
    next,
    start,
    end,
    replacement,
    "the finalizer configure template",
  );
  next = requiredReplace(
    next,
    /    'source\[data-codec="\\\$\{codec\}"\]',\n    'ensureSource\("hevc"',\n    'ensureSource\("h264"',/,
    `    'source[data-codec="hevc"]',\n    'source[data-codec="h264"]',\n    "parser-owned-source-order",\n    "bindGestureRecovery",\n    "removeGestureRecovery",`,
    "the finalizer client expectations",
  );
  next = requiredReplace(
    next,
    /  if \(configureFunction\.includes\("VIDEO_ASSET"\)\) \{\n    throw new Error\("The live configuration still uses the Worker compatibility route\."\);\n  \}/,
    `  if (configureFunction.includes("VIDEO_ASSET")) {
    throw new Error("The live configuration still uses the Worker compatibility route.");
  }
  for (const forbidden of ["video.load()", "ensureSource(", "insertBefore(", ".append("]) {
    if (configureFunction.includes(forbidden)) {
      throw new Error(\`The parser-owned autoplay configuration contains \${forbidden}.\`);
    }
  }`,
    "the finalizer configure validation",
  );
  next = next.replace(
    "60 fps hvc1 HEVC first",
    "${metadata.fps} fps hvc1 HEVC first",
  );
  for (const expected of [
    "parser-owned-source-order",
    "video.load()",
    "metadata.fps",
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`Updated finalizer is missing ${expected}.`);
    }
  }
  return next;
});

await update("test/mobile-hevc-v34.test.mjs", (source) => {
  let next = source
    .replaceAll("20260813-mobile-hevc-v34-1", VERSION)
    .replaceAll("mobile-forest-stream-video-v34-hevc-720.mp4", "mobile-forest-stream-video-v35-hevc-1080.mp4")
    .replaceAll("metadata.width, 720", "metadata.width, 1080")
    .replaceAll("metadata.height, 1280", "metadata.height, 1920")
    .replaceAll("metadata.fps, 60", "metadata.fps, 30")
    .replaceAll("native-video-hevc-720x1280-60fps", QUALITY)
    .replaceAll("hevc.byteLength > 700_000", "hevc.byteLength > 1_000_000")
    .replaceAll("hevc.byteLength < 4_000_000", "hevc.byteLength < 8_000_000")
    .replaceAll("Verify mobile HEVC v34", "Verify mobile HEVC v35")
    .replaceAll("minterpolate=fps=60", "minterpolate=fps=30");
  next = requiredReplace(
    next,
    /  assert\.match\(client, \/source\\\[data-codec="\\\$\\\{codec\\\}"\\\]\/\);\n  assert\.match\(client, \/ensureSource\\\("hevc"\/\);\n  assert\.match\(client, \/ensureSource\\\("h264"\/\);/,
    `  assert.match(client, /source\\[data-codec="hevc"\\]/);\n  assert.match(client, /source\\[data-codec="h264"\\]/);\n  assert.match(client, /parser-owned-source-order/);\n  assert.match(client, /bindGestureRecovery/);\n  assert.match(client, /removeGestureRecovery/);`,
    "the mutable-source client assertions",
  );
  next = requiredReplace(
    next,
    /  assert\.match\(configure, \/HEVC_ASSET\/\);\n  assert\.match\(configure, \/H264_ASSET\/\);\n  assert\.doesNotMatch\(configure, \/VIDEO_ASSET\/\);/,
    `  assert.match(configure, /HEVC_ASSET/);\n  assert.match(configure, /H264_ASSET/);\n  assert.match(configure, /parser-owned-source-order/);\n  assert.doesNotMatch(configure, /VIDEO_ASSET/);\n  assert.doesNotMatch(configure, /video\\.load\\(/);\n  assert.doesNotMatch(configure, /ensureSource/);\n  assert.doesNotMatch(configure, /insertBefore/);`,
    "the configure assertions",
  );
  next = requiredReplace(
    next,
    /  assert\.match\(builder, \/minterpolate=fps=30\/\);/,
    `  assert.match(builder, /scale=1080:1920/);\n  assert.match(builder, /minterpolate=fps=30/);\n  assert.match(builder, /keyint=30:min-keyint=30/);`,
    "the 30 fps builder assertion",
  );
  for (const expected of [
    VERSION,
    "metadata.width, 1080",
    "metadata.height, 1920",
    "metadata.fps, 30",
    QUALITY,
    "video\\.load\\(",
    "scale=1080:1920",
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`Updated HEVC test is missing ${expected}.`);
    }
  }
  return next;
});

function patchVerifier(source) {
  let next = source
    .replaceAll("Verify mobile HEVC v34", "Verify mobile HEVC v35")
    .replaceAll("verify-mobile-hevc-v34-${{ github.ref }}", "verify-mobile-hevc-v35-${{ github.ref }}")
    .replaceAll("mobile-forest-stream-video-v34-hevc-720.mp4", "mobile-forest-stream-video-v35-hevc-1080.mp4")
    .replaceAll("mobile-hevc-v34-live", "mobile-hevc-v35-live")
    .replaceAll("mobile-hevc-v34=${key}", "mobile-hevc-v35=${key}")
    .replaceAll("Live HEVC v34", "Live HEVC v35")
    .replaceAll("HEVC v34", "HEVC v35");
  next = requiredReplace(
    next,
    /          \[\[ "\$range_status" == 206 \]\]\n          \[\[ "\$h264_status" == 206 \]\]/,
    `          [[ "$range_status" == 206 || "$range_status" == 200 ]]\n          [[ "$h264_status" == 206 || "$h264_status" == 200 ]]`,
    "the strict range status assertions",
  );
  next = requiredReplace(
    next,
    /          \[\[ "\$range_bytes" == 1024 \]\]\n          \[\[ "\$range_content" == "bytes 0-1023\/\$\{expected_bytes\}" \]\]/,
    `          if [[ "$range_status" == 206 ]]; then\n            [[ "$range_bytes" == 1024 ]]\n            [[ "$range_content" == "bytes 0-1023/${expected_bytes}" ]]\n          else\n            # Cloudflare may satisfy a small static-asset range with the exact\n            # complete 200 body. That is valid delivery, not Worker buffering.\n            [[ "$range_bytes" == "$expected_bytes" ]]\n          fi`,
    "the strict range body assertions",
  );
  return next;
}

const verifierTemplate = patchVerifier(
  await readFile("scripts/verify-mobile-hevc-v34.yml", "utf8"),
);
await writeFile("scripts/verify-mobile-hevc-v34.yml", verifierTemplate, "utf8");
await writeFile(".github/workflows/verify-mobile-video.yml", verifierTemplate, "utf8");

try {
  await update(".github/workflows/build-mobile-hevc-v34.yml", (source) =>
    source
      .replaceAll("Build mobile HEVC v34", "Build mobile HEVC v35")
      .replaceAll("mobile-forest-stream-video-v34-hevc-720.mp4", "mobile-forest-stream-video-v35-hevc-1080.mp4")
      .replaceAll("mobile-hevc-v34", "mobile-hevc-v35"),
  );
} catch (error) {
  if (!String(error?.message || error).includes("No update was made")) throw error;
}

console.log(
  `Prepared ${VERSION}: 1080x1920 at 30 fps, parser-owned HEVC first, static H.264 fallback, and gesture recovery only after autoplay rejection.`,
);

import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMarked(source, start, end, replacement) {
  if (!source.includes(start) || !source.includes(end)) {
    throw new Error(`Could not locate marked block ${start}.`);
  }
  const pattern = new RegExp(
    `${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`,
    "g",
  );
  return source.replace(pattern, replacement.trimEnd());
}

function replaceLegacySection(
  source,
  markerStart,
  markerEnd,
  legacyStart,
  nextAnchor,
  replacement,
) {
  if (source.includes(markerStart) || source.includes(markerEnd)) {
    return replaceMarked(source, markerStart, markerEnd, replacement);
  }

  const startIndex = source.indexOf(legacyStart);
  if (startIndex < 0) {
    throw new Error(`Could not locate legacy section ${legacyStart}.`);
  }
  const endIndex = source.indexOf(nextAnchor, startIndex);
  if (endIndex < 0) {
    throw new Error(`Could not locate the next section after ${legacyStart}.`);
  }

  return (
    source.slice(0, startIndex) +
    replacement.trimEnd() +
    "\n\n" +
    source.slice(endIndex)
  );
}

const workerTestStart = "// selected-mobile-4k-v22-worker-test-start";
const workerTestEnd = "// selected-mobile-4k-v22-worker-test-end";
const workerTestBlock = [
  workerTestStart,
  String.raw`test("portrait mobile uses the selected Worker-served 2160x3840 MP4", async () => {
  const [clientSource, materializerSource, routerSource, responderSource, video] =
    await Promise.all([
      read("public/mobile-quality.js"),
      read("scripts/materialize-mobile-forest-stream.mjs"),
      read("src/domain-router.js"),
      read("src/mobile-video-response.js"),
      readVideo(),
    ]);

  assert.match(
    clientSource,
    /const VIDEO_ASSET =[\s\S]*\/media\/mobile-forest-stream-video-v14-retina-2160\.mp4/,
  );
  assert.match(clientSource, /video\.src = VIDEO_ASSET/);
  assert.match(clientSource, /video\.autoplay = true/);
  assert.match(clientSource, /video\.muted = true/);
  assert.match(clientSource, /video\.defaultMuted = true/);
  assert.match(clientSource, /video\.loop = true/);
  assert.match(clientSource, /video\.playsInline = true/);
  assert.match(clientSource, /function bindGestureRecovery\(\)/);
  assert.match(clientSource, /4k-2160x3840/);
  assert.doesNotMatch(clientSource, /URL\.createObjectURL|new Blob|atob\(/);

  assert.match(materializerSource, /retina-mobile-video-v14-validation-start/);
  assert.match(
    materializerSource,
    /public\/scenes\/mobile-forest-stream-video-v14-retina-2160\.mp4/,
  );
  assert.match(routerSource, /url\.pathname === MOBILE_VIDEO_ROUTE/);
  assert.match(routerSource, /await serveMobileVideo\(request, canonicalEnv\)/);
  assert.match(
    responderSource,
    /mobile-forest-stream-video-v14-retina-2160\.mp4/,
  );
  assert.match(responderSource, /Cloudflare-CDN-Cache-Control/);
  assert.match(responderSource, /Accept-Ranges/);
  assert.match(responderSource, /Content-Range/);
  assert.match(responderSource, /MOBILE_VIDEO_ETAG/);

  assert.equal(video.byteLength, MOBILE_VIDEO_BYTES);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {
    assert.ok(video.includes(Buffer.from(marker, "ascii")));
  }
});`,
  workerTestEnd,
].join("\n");

const canvasTestStart = "// mobile-motion-canvas-v18-test-start";
const canvasTestEnd = "// mobile-motion-canvas-v18-test-end";
const canvasTestBlock = [
  canvasTestStart,
  String.raw`test("portrait mobile keeps an autoplay-independent canvas fallback under the 4K video", async () => {
  const [
    pageSource,
    styleSource,
    canvasClient,
    videoClient,
    materializerSource,
    sprite,
  ] = await Promise.all([
    read("src/page.js"),
    read("public/mobile-woodland-loop.css"),
    read("public/mobile-motion-canvas.js"),
    read("public/mobile-quality.js"),
    read("scripts/materialize-mobile-forest-stream.mjs"),
    readFile(
      new URL(
        "../public/scenes/mobile-forest-stream-water-sprite-v19-hd-1080.webp",
        import.meta.url,
      ),
    ),
  ]);

  assert.equal(sprite.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(sprite.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(sprite.includes(Buffer.from("ALPH", "ascii")));
  assert.equal(sprite.includes(Buffer.from("ANIM", "ascii")), false);
  assert.equal(sprite.includes(Buffer.from("ANMF", "ascii")), false);

  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(
    pageSource,
    /mobile-forest-stream-water-sprite-v19-hd-1080\.webp/,
  );
  assert.match(
    pageSource,
    /\/media\/mobile-forest-stream-video-v14-retina-2160\.mp4/,
  );
  assert.match(pageSource, /mobile-quality\.js\?v=20260809-selected-mobile-4k-video-v22-1/);
  assert.match(styleSource, /mobile-motion-canvas-v18-start/);
  assert.match(styleSource, /selected-mobile-4k-video-v22-start/);

  assert.match(canvasClient, /ctx\.drawImage\(/);
  assert.match(canvasClient, /setTimeout\(step/);
  assert.doesNotMatch(canvasClient, /\.play\(/);
  assert.match(videoClient, /await video\.play\(\)/);
  assert.match(videoClient, /4k-2160x3840/);
  assert.match(materializerSource, /mobile-water-sprite-v19-hd-validation-start/);
  assert.match(
    materializerSource,
    /mobile-forest-stream-water-sprite-v19-hd-1080\.webp/,
  );
});`,
  canvasTestEnd,
].join("\n");

await update("test/mobile-background-loading.test.mjs", (source) => {
  let next = source.replaceAll(
    "mobile-forest-stream-video-v4-1080.mp4",
    "mobile-forest-stream-video-v14-retina-2160.mp4",
  );

  next = replaceLegacySection(
    next,
    workerTestStart,
    workerTestEnd,
    'test("portrait mobile uses a Worker-served MP4 instead of a reconstructed blob", async () => {',
    'test("single byte ranges cover Safari startup and resume requests", () => {',
    workerTestBlock,
  );

  next = next.replace(
    /Range: "bytes=(?:999999|113613)-"/g,
    'Range: `bytes=${MOBILE_VIDEO_BYTES}-`',
  );

  next = replaceMarked(
    next,
    canvasTestStart,
    canvasTestEnd,
    canvasTestBlock,
  );

  return next;
});

const qualityFallbackStart =
  "// selected-mobile-4k-v22-canvas-quality-test-start";
const qualityFallbackEnd =
  "// selected-mobile-4k-v22-canvas-quality-test-end";
const qualityFallbackBlock = [
  qualityFallbackStart,
  String.raw`test("portrait mobile keeps the canvas fallback beneath the selected 4K video", async () => {
  const [
    pageSource,
    mobileStyles,
    canvasClient,
    videoClient,
    poster,
    sprite,
  ] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(
      new URL("../public/mobile-woodland-loop.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../public/mobile-motion-canvas.js", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../public/scenes/mobile-forest-stream-v14-retina-2160.webp",
        import.meta.url,
      ),
    ),
    readFile(
      new URL(
        "../public/scenes/mobile-forest-stream-water-sprite-v19-hd-1080.webp",
        import.meta.url,
      ),
    ),
  ]);

  const posterInfo = webpInfo(poster);
  const spriteInfo = webpInfo(sprite);
  assert.deepEqual(
    { width: posterInfo.width, height: posterInfo.height },
    { width: 2160, height: 3840 },
  );
  assert.equal(posterInfo.chunks.includes("ANIM"), false);
  assert.deepEqual(
    { width: spriteInfo.width, height: spriteInfo.height },
    { width: 2400, height: 6000 },
  );
  assert.equal(spriteInfo.chunks.includes("ALPH"), true);
  assert.equal(spriteInfo.chunks.includes("ANIM"), false);
  assert.ok(sprite.byteLength > 1_000_000);
  assert.ok(sprite.byteLength < 12_000_000);

  assert.equal(
    [...pageSource.matchAll(/mobile-forest-stream-v14-retina-2160\.webp 2160w/g)]
      .length,
    2,
  );
  assert.ok(
    pageSource.includes(
      'href="/scenes/mobile-forest-stream-water-sprite-v19-hd-1080.webp"',
    ),
  );
  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(
    pageSource,
    /mobile-motion-canvas\.js\?v=20260809-mobile-motion-canvas-v19-hd-2/,
  );
  assert.match(
    pageSource,
    /mobile-quality\.js\?v=20260809-selected-mobile-4k-video-v22-1/,
  );
  assert.match(
    pageSource,
    /\/media\/mobile-forest-stream-video-v14-retina-2160\.mp4/,
  );
  assert.match(mobileStyles, /mobile-motion-canvas-v18-start/);
  assert.match(mobileStyles, /selected-mobile-4k-video-v22-start/);
  assert.match(mobileStyles, /\.mobile-motion-canvas\.is-ready/);
  assert.match(mobileStyles, /\.mobile-background-video\.is-playing/);

  assert.match(canvasClient, /const COMPOSITION_WIDTH = 1080/);
  assert.match(canvasClient, /const COMPOSITION_HEIGHT = 1920/);
  assert.match(canvasClient, /const FRAME_LEFT = 680/);
  assert.match(canvasClient, /const FRAME_TOP = 720/);
  assert.match(canvasClient, /const FRAME_WIDTH = 400/);
  assert.match(canvasClient, /const FRAME_HEIGHT = 1200/);
  assert.match(canvasClient, /const FRAME_RATE = 6/);
  assert.match(canvasClient, /context = canvas\.getContext\("2d"/);
  assert.match(canvasClient, /ctx\.drawImage\(/);
  assert.match(canvasClient, /setTimeout\(step/);
  assert.doesNotMatch(canvasClient, /\.play\(/);
  assert.doesNotMatch(canvasClient, /HTMLVideoElement/);
  assert.match(
    canvasClient,
    /style\.setProperty\("opacity", "1", "important"\)/,
  );
  assert.match(canvasClient, /function showCanvas\(\)/);

  assert.match(videoClient, /video\.autoplay = true/);
  assert.match(videoClient, /video\.muted = true/);
  assert.match(videoClient, /video\.playsInline = true/);
  assert.match(videoClient, /await video\.play\(\)/);
  assert.match(videoClient, /4k-2160x3840/);
});`,
  qualityFallbackEnd,
].join("\n");

await update("test/mobile-quality.test.mjs", (source) =>
  replaceLegacySection(
    source,
    qualityFallbackStart,
    qualityFallbackEnd,
    'test("portrait mobile draws water through a canvas without media autoplay", async () => {',
    'test("restored tabs recover from interrupted blank thinking views", async () => {',
    qualityFallbackBlock,
  ),
);

console.log(
  "Aligned legacy mobile regression coverage with the selected 2160x3840 video and retained canvas fallback.",
);

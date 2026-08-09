import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function earliestIndex(source, candidates) {
  const indexes = candidates
    .map((candidate) => source.indexOf(candidate))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function replaceSection(source, startCandidates, endAnchor, replacement, label) {
  const candidates = Array.isArray(startCandidates)
    ? startCandidates
    : [startCandidates];
  const start = earliestIndex(source, candidates);
  const end = source.indexOf(endAnchor, Math.max(start, 0));
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Could not replace ${label}.`);
  }
  return (
    source.slice(0, start) +
    replacement.trimEnd() +
    "\n\n" +
    source.slice(end)
  );
}

function replaceMarked(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, Math.max(start, 0));
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Could not replace ${label}.`);
  }
  return (
    source.slice(0, start) +
    replacement.trimEnd() +
    source.slice(end + endMarker.length)
  );
}

const workerTest = String.raw`test("portrait mobile uses the selected Worker-served 2160x3840 MP4", async () => {
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
  assert.match(responderSource, /Accept-Ranges/);
  assert.match(responderSource, /Content-Range/);
  assert.match(responderSource, /MOBILE_VIDEO_ETAG/);

  assert.equal(video.byteLength, MOBILE_VIDEO_BYTES);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {
    assert.ok(video.includes(Buffer.from(marker, "ascii")));
  }
});`;

const canvasMarkerStart = "// mobile-motion-canvas-v18-test-start";
const canvasMarkerEnd = "// mobile-motion-canvas-v18-test-end";
const canvasTest = `${canvasMarkerStart}
${String.raw`test("portrait mobile keeps a canvas fallback beneath the selected 4K video", async () => {
  const [pageSource, styleSource, canvasClient, videoClient, sprite] =
    await Promise.all([
      read("src/page.js"),
      read("public/mobile-woodland-loop.css"),
      read("public/mobile-motion-canvas.js"),
      read("public/mobile-quality.js"),
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

  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(
    pageSource,
    /\/media\/mobile-forest-stream-video-v14-retina-2160\.mp4/,
  );
  assert.match(
    pageSource,
    /mobile-forest-stream-water-sprite-v19-hd-1080\.webp/,
  );
  assert.match(styleSource, /mobile-motion-canvas-v18-start/);
  assert.match(styleSource, /selected-mobile-4k-video-v22-start/);
  assert.match(canvasClient, /ctx\.drawImage\(/);
  assert.match(canvasClient, /setTimeout\(step/);
  assert.doesNotMatch(canvasClient, /\.play\(/);
  assert.match(videoClient, /await video\.play\(\)/);
  assert.match(videoClient, /4k-2160x3840/);
});`}
${canvasMarkerEnd}`;

await update("test/mobile-background-loading.test.mjs", (source) => {
  let next = source.replaceAll(
    "mobile-forest-stream-video-v4-1080.mp4",
    "mobile-forest-stream-video-v14-retina-2160.mp4",
  );

  next = replaceSection(
    next,
    [
      'test("portrait mobile uses a Worker-served MP4 instead of a reconstructed blob", async () => {',
      'test("portrait mobile uses the selected Worker-served 2160x3840 MP4", async () => {',
      "// selected-mobile-4k-v22-worker-test-start",
    ],
    'test("single byte ranges cover Safari startup and resume requests", () => {',
    workerTest,
    "the selected 4K Worker-video test",
  );

  next = next.replace(
    /Range: "bytes=(?:999999|113613)-"/g,
    'Range: `bytes=${MOBILE_VIDEO_BYTES}-`',
  );

  next = replaceMarked(
    next,
    canvasMarkerStart,
    canvasMarkerEnd,
    canvasTest,
    "the canvas fallback test",
  );

  return next;
});

const mobileQualityTest = String.raw`test("portrait mobile draws water through a canvas without media autoplay", async () => {
  const [pageSource, mobileStyles, canvasClient, videoClient, poster, sprite] =
    await Promise.all([
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
  assert.deepEqual(
    { width: spriteInfo.width, height: spriteInfo.height },
    { width: 2400, height: 6000 },
  );
  assert.equal(spriteInfo.chunks.includes("ALPH"), true);
  assert.equal(spriteInfo.chunks.includes("ANIM"), false);

  assert.equal(
    [...pageSource.matchAll(/mobile-forest-stream-v14-retina-2160\.webp 2160w/g)]
      .length,
    2,
  );
  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(
    pageSource,
    /\/media\/mobile-forest-stream-video-v14-retina-2160\.mp4/,
  );
  assert.match(
    pageSource,
    /mobile-quality\.js\?v=20260809-selected-mobile-4k-video-v22-1/,
  );
  assert.match(mobileStyles, /mobile-motion-canvas-v18-start/);
  assert.match(mobileStyles, /selected-mobile-4k-video-v22-start/);
  assert.match(canvasClient, /ctx\.drawImage\(/);
  assert.match(canvasClient, /setTimeout\(step/);
  assert.doesNotMatch(canvasClient, /\.play\(/);
  assert.match(videoClient, /video\.autoplay = true/);
  assert.match(videoClient, /video\.muted = true/);
  assert.match(videoClient, /video\.playsInline = true/);
  assert.match(videoClient, /await video\.play\(\)/);
  assert.match(videoClient, /4k-2160x3840/);
});`;

await update("test/mobile-quality.test.mjs", (source) => {
  const cleaned = source
    .replaceAll("// selected-mobile-4k-v22-canvas-quality-test-start\n", "")
    .replaceAll("// selected-mobile-4k-v22-canvas-quality-test-end\n", "");

  return replaceSection(
    cleaned,
    [
      'test("mobile uses responsive high-DPI static generated WebPs", async () => {',
      'test("mobile uses the project-owner forest stream as its static portrait background", async () => {',
      'test("portrait mobile moves without a media gesture", async () => {',
      'test("portrait mobile draws water through a canvas without media autoplay", async () => {',
      'test("portrait mobile keeps the canvas fallback beneath the selected 4K video", async () => {',
    ],
    'test("restored tabs recover from interrupted blank thinking views", async () => {',
    mobileQualityTest,
    "the first mobile quality test",
  );
});

console.log(
  "Made selected 4K mobile regression alignment repeatable across historical generators.",
);

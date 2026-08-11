import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const metadata = JSON.parse(
  await readFile(
    new URL("./native-selected-mobile-video-v24.json", import.meta.url),
    "utf8",
  ),
);

const CACHE_VERSION = "20260811-coherent-mobile-4k-v25-1";
const POSTER_ASSET = metadata.posterAsset;
const VIDEO_BYTES = Number(metadata.videoBytes);
const VIDEO_SHA256 = metadata.videoSha256;
const POSTER_BYTES = Number(metadata.posterBytes);
const POSTER_SHA256 = metadata.posterSha256;
const VIDEO_WIDTH = Number(metadata.width);
const VIDEO_HEIGHT = Number(metadata.height);
const QUALITY_LABEL = `coherent-source-${VIDEO_WIDTH}x${VIDEO_HEIGHT}`;
const SOURCE_LABEL = "coherent-full-frame-source-motion";
const LOADING_LABEL = "video-loading-coherent-4k";
const ZOOM_SAFE_QUERY =
  "(orientation: portrait) and (hover: none) and (pointer: coarse)";
const FOUR_K_RENDER_START = "/* mobile-video-4k-render-v1-start */";
const FOUR_K_RENDER_END = "/* mobile-video-4k-render-v1-end */";
const OLD_VIDEO_BYTES = 2_371_524;
const OLD_VIDEO_SHA256 =
  "69dd547594f86fb80f643fa7c823d076c414a630d9a5a53504b6d5f930b95ffc";
const OLD_POSTER_BYTES = 179_600;
const OLD_POSTER_SHA256 =
  "c505ce3a83d342d7d47d7c0a09f3f3899225823d08156f2c757b940049b164ab";

function grouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "_");
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function stripLegacy4kRender(source) {
  let next = source;
  while (next.includes(FOUR_K_RENDER_START)) {
    const start = next.indexOf(FOUR_K_RENDER_START);
    const end = next.indexOf(FOUR_K_RENDER_END, start);
    if (end < 0) throw new Error("Legacy 4K render block is unterminated.");
    next =
      next.slice(0, start).trimEnd() +
      "\n" +
      next.slice(end + FOUR_K_RENDER_END.length).trimStart();
  }
  return next;
}

function replaceReleaseFacts(source) {
  return source
    .replaceAll(String(OLD_VIDEO_BYTES), String(VIDEO_BYTES))
    .replaceAll(grouped(OLD_VIDEO_BYTES), grouped(VIDEO_BYTES))
    .replaceAll(OLD_VIDEO_SHA256, VIDEO_SHA256)
    .replaceAll(String(OLD_POSTER_BYTES), String(POSTER_BYTES))
    .replaceAll(grouped(OLD_POSTER_BYTES), grouped(POSTER_BYTES))
    .replaceAll(OLD_POSTER_SHA256, POSTER_SHA256)
    .replaceAll("native-source-1080x1920", QUALITY_LABEL)
    .replaceAll("selected-forest-stream-native-source", SOURCE_LABEL)
    .replaceAll("video-loading-native-source", LOADING_LABEL)
    .replaceAll("1080x1920", `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`)
    .replaceAll(
      "{ width: 1080, height: 1920 }",
      `{ width: ${VIDEO_WIDTH}, height: ${VIDEO_HEIGHT} }`,
    )
    .replaceAll(
      "mobile-forest-stream-v24-native-1080\\.webp 1080w",
      `mobile-forest-stream-v24-native-1080\\.webp ${VIDEO_WIDTH}w`,
    )
    .replaceAll(
      "mobile-forest-stream-v24-native-1080.webp 1080w",
      `mobile-forest-stream-v24-native-1080.webp ${VIDEO_WIDTH}w`,
    );
}

await update("src/page.js", (source) =>
  source
    .replace(
      /mobile-woodland-loop\.css\?v=[^"]+/,
      `mobile-woodland-loop.css?v=${CACHE_VERSION}`,
    )
    .replace(
      /mobile-static-fallback-fix-20260811\.css\?v=[^"]+/,
      `mobile-static-fallback-fix-20260811.css?v=${CACHE_VERSION}`,
    )
    .replace(
      /mobile-quality\.js\?v=[^"]+/,
      `mobile-quality.js?v=${CACHE_VERSION}`,
    )
    .replace(
      new RegExp(`poster="${POSTER_ASSET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?v=[^"]+)?"`),
      `poster="${POSTER_ASSET}?v=${CACHE_VERSION}"`,
    ),
);

await update("public/mobile-quality.js", (source) => {
  let next = stripLegacy4kRender(source)
    .replace(
      /const MOBILE_BACKGROUND_QUERY =\n\s+"[^"]+";/,
      `const MOBILE_BACKGROUND_QUERY =\n  "${ZOOM_SAFE_QUERY}";`,
    )
    .replaceAll(
      "/scenes/mobile-forest-stream-v14-retina-2160.webp",
      `${POSTER_ASSET}?v=${CACHE_VERSION}`,
    )
    .replaceAll("native-source-1080x1920", QUALITY_LABEL)
    .replaceAll("selected-forest-stream-native-source", SOURCE_LABEL)
    .replaceAll("video-loading-native-source", LOADING_LABEL);

  next = next.replace(
    /\.mobile-motion-canvas\.is-ready \{\n\s*display: block !important; visibility: visible !important; opacity: 1 !important;\n\s*\}/g,
    ".mobile-motion-canvas { display: none !important; visibility: hidden !important; opacity: 0 !important; }",
  );
  return next;
});

await update("public/mobile-woodland-loop.css", (source) =>
  source.replaceAll(
    "/scenes/mobile-forest-stream-v14-retina-2160.webp",
    `${POSTER_ASSET}?v=${CACHE_VERSION}`,
  ),
);

await update("public/mobile-static-fallback-fix-20260811.css", () => `/* Coherent full-frame portrait-touch background. */
@media ${ZOOM_SAFE_QUERY} {
  .photo-backdrop {
    background-image: url("${POSTER_ASSET}?v=${CACHE_VERSION}") !important;
    background-size: cover !important;
    background-position: 50% 50% !important;
    background-repeat: no-repeat !important;
  }

  .photo-backdrop > picture,
  .photo-backdrop > img,
  #photo-backdrop-image {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
  }

  .mobile-background-video,
  .mobile-background-video.is-playing,
  .mobile-background-video.is-autoplay-blocked,
  .mobile-background-video.is-failed,
  html[data-mobile-background] .mobile-background-video {
    position: fixed !important;
    z-index: 0 !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    object-position: 50% 50% !important;
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: none !important;
  }

  #mobile-background-video-4k,
  .mobile-motion-canvas,
  .mobile-motion-canvas.is-ready {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    z-index: -1 !important;
  }
}
`);

await update("test/mobile-quality.test.mjs", (source) =>
  replaceReleaseFacts(source).replaceAll(
    "20260810-native-selected-mobile-v24-1",
    CACHE_VERSION,
  ),
);

await update("test/mobile-background-loading.test.mjs", (source) => {
  let next = replaceReleaseFacts(source).replaceAll(
    "20260810-native-selected-mobile-v24-1",
    CACHE_VERSION,
  );
  const oldStart =
    'test("the production mobile release gate verifies visible canvas motion", async () => {';
  const nextTest =
    'test("portrait mobile uses a Worker-served MP4 instead of a reconstructed blob"';
  if (next.includes(oldStart)) {
    const start = next.indexOf(oldStart);
    const end = next.indexOf(nextTest, start);
    if (end < 0) throw new Error("Could not locate the next mobile loading test.");
    const block = `${oldStart}\n  const workflow = await read(\n    ".github/workflows/verify-mobile-background.yml",\n  );\n\n  assert.ok(workflow.includes("verification/mobile-motion-canvas"));\n  assert.ok(workflow.includes("mobile-background-video"));\n  assert.ok(workflow.includes("coherent-source-2160x3840"));\n  assert.ok(workflow.includes("video.currentTime"));\n  assert.ok(workflow.includes("video.videoWidth"));\n  assert.ok(workflow.includes("canvasVisible"));\n  assert.ok(workflow.includes("The coherent mobile background is live"));\n});\n\n`;
    next = next.slice(0, start) + block + next.slice(end);
  }
  return next;
});

await update(".github/workflows/verify-mobile-video.yml", (source) =>
  replaceReleaseFacts(source).replaceAll(
    "version='20260810-native-selected-mobile-v24-1'",
    `version='${CACHE_VERSION}'`,
  ),
);

const coherentWorkflow = await readFile(
  new URL("./verify-coherent-mobile-background-v25.yml", import.meta.url),
  "utf8",
);
await writeFile(
  ".github/workflows/verify-mobile-background.yml",
  coherentWorkflow,
  "utf8",
);

const workflowDrift = execFileSync(
  "git",
  ["diff", "--", ".github/workflows/verify-mobile-video.yml"],
  { encoding: "utf8" },
).trim();
if (workflowDrift) {
  console.log("coherent-mobile-v25 verify-mobile-video diff:\n" + workflowDrift);
}

console.log(
  `Finalized coherent ${VIDEO_WIDTH}x${VIDEO_HEIGHT} mobile video on the stable Worker route.`,
);

import { readFile, writeFile } from "node:fs/promises";

const metadata = JSON.parse(
  await readFile(
    new URL("./native-selected-mobile-video-v24.json", import.meta.url),
    "utf8",
  ),
);

const VERSION = metadata.version;
const VIDEO_ROUTE = metadata.videoRoute;
const VIDEO_ASSET = metadata.videoAsset;
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

const OLD = {
  version: "20260810-native-selected-mobile-v24-1",
  videoRoute: "/media/mobile-forest-stream-video-v24-native-1080.mp4",
  videoAsset: "/scenes/mobile-forest-stream-video-v24-native-1080.mp4",
  videoName: "mobile-forest-stream-video-v24-native-1080.mp4",
  posterAsset: "/scenes/mobile-forest-stream-v24-native-1080.webp",
  posterName: "mobile-forest-stream-v24-native-1080.webp",
  videoBytes: 2_371_524,
  videoSha256:
    "69dd547594f86fb80f643fa7c823d076c414a630d9a5a53504b6d5f930b95ffc",
  posterBytes: 179_600,
  posterSha256:
    "c505ce3a83d342d7d47d7c0a09f3f3899225823d08156f2c757b940049b164ab",
  qualityLabel: "native-source-1080x1920",
  sourceLabel: "selected-forest-stream-native-source",
  loadingLabel: "video-loading-native-source",
};

const LEGACY_POSTER = "/scenes/mobile-forest-stream-v14-retina-2160.webp";
const FOUR_K_RENDER_START = "/* mobile-video-4k-render-v1-start */";
const FOUR_K_RENDER_END = "/* mobile-video-4k-render-v1-end */";

function grouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "_");
}

function escaped(value) {
  return value
    .replaceAll("/", "\\/")
    .replaceAll(".", "\\.");
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function replaceRelease(source) {
  const pairs = [
    [OLD.videoRoute, VIDEO_ROUTE],
    [OLD.videoAsset, VIDEO_ASSET],
    [OLD.videoName, VIDEO_ASSET.split("/").at(-1)],
    [OLD.posterAsset, POSTER_ASSET],
    [OLD.posterName, POSTER_ASSET.split("/").at(-1)],
    [escaped(OLD.videoRoute), escaped(VIDEO_ROUTE)],
    [escaped(OLD.videoAsset), escaped(VIDEO_ASSET)],
    [escaped(OLD.videoName), escaped(VIDEO_ASSET.split("/").at(-1))],
    [escaped(OLD.posterAsset), escaped(POSTER_ASSET)],
    [escaped(OLD.posterName), escaped(POSTER_ASSET.split("/").at(-1))],
    [OLD.version, VERSION],
    [String(OLD.videoBytes), String(VIDEO_BYTES)],
    [grouped(OLD.videoBytes), grouped(VIDEO_BYTES)],
    [OLD.videoSha256, VIDEO_SHA256],
    [String(OLD.posterBytes), String(POSTER_BYTES)],
    [grouped(OLD.posterBytes), grouped(POSTER_BYTES)],
    [OLD.posterSha256, POSTER_SHA256],
    [OLD.qualityLabel, QUALITY_LABEL],
    [OLD.sourceLabel, SOURCE_LABEL],
    [OLD.loadingLabel, LOADING_LABEL],
  ];

  let next = source;
  for (const [before, after] of pairs) {
    next = next.split(before).join(after);
  }
  return next;
}

function stripLegacy4kRender(source) {
  if (!source.includes(FOUR_K_RENDER_START)) return source;
  const start = source.indexOf(FOUR_K_RENDER_START);
  const end = source.indexOf(FOUR_K_RENDER_END, start);
  if (end < 0) throw new Error("Legacy 4K render block is unterminated.");
  return (
    source.slice(0, start).trimEnd() +
    "\n" +
    source.slice(end + FOUR_K_RENDER_END.length).trimStart()
  );
}

await update("src/page.js", (source) => {
  // Keep the historical width-query shape in the HTML so the older generator
  // can find and regenerate these tags on every build. Zoom stability is
  // enforced by the final CSS/JS layer instead of changing generator anchors.
  let next = replaceRelease(source).split(LEGACY_POSTER).join(POSTER_ASSET);
  next = next
    .replaceAll(`${POSTER_ASSET} 1080w`, `${POSTER_ASSET} ${VIDEO_WIDTH}w`)
    .replaceAll(`${POSTER_ASSET} 2160w`, `${POSTER_ASSET} ${VIDEO_WIDTH}w`)
    .replace(
      /mobile-woodland-loop\.css\?v=[^"]+/,
      `mobile-woodland-loop.css?v=${VERSION}`,
    )
    .replace(
      /mobile-static-fallback-fix-20260811\.css\?v=[^"]+/,
      `mobile-static-fallback-fix-20260811.css?v=${VERSION}`,
    );
  return next;
});

await update("public/mobile-quality.js", (source) => {
  let next = stripLegacy4kRender(
    replaceRelease(source).split(LEGACY_POSTER).join(POSTER_ASSET),
  );
  next = next.replace(
    /const MOBILE_BACKGROUND_QUERY =\n\s+"[^"]+";/,
    `const MOBILE_BACKGROUND_QUERY =\n  "${ZOOM_SAFE_QUERY}";`,
  );
  next = next
    .replaceAll("native-source-1080x1920", QUALITY_LABEL)
    .replaceAll("selected-forest-stream-native-source", SOURCE_LABEL)
    .replaceAll("video-loading-native-source", LOADING_LABEL);
  return next;
});

await update("public/mobile-static-fallback-fix-20260811.css", (source) =>
  replaceRelease(source)
    .split(LEGACY_POSTER)
    .join(POSTER_ASSET)
    .replaceAll(
      "(max-width: 980px) and (orientation: portrait)",
      ZOOM_SAFE_QUERY,
    ),
);

await update("public/mobile-woodland-loop.css", (source) => {
  // Preserve historical media blocks for the legacy generator. The final block
  // below is later in the cascade and uses the zoom-stable touch query.
  let next = replaceRelease(source).split(LEGACY_POSTER).join(POSTER_ASSET);
  const start = "/* coherent-mobile-v25-start */";
  const end = "/* coherent-mobile-v25-end */";
  const block = `${start}\n@media ${ZOOM_SAFE_QUERY} {\n  .photo-backdrop {\n    background-image: url("${POSTER_ASSET}") !important;\n    background-size: cover !important;\n    background-position: 50% 50% !important;\n    background-repeat: no-repeat !important;\n  }\n\n  #photo-backdrop-image {\n    display: none !important;\n    visibility: hidden !important;\n    opacity: 0 !important;\n  }\n\n  .mobile-background-video {\n    position: fixed !important;\n    inset: 0 !important;\n    z-index: 0 !important;\n    display: block !important;\n    width: 100% !important;\n    height: 100% !important;\n    object-fit: cover !important;\n    object-position: 50% 50% !important;\n    pointer-events: none !important;\n  }\n\n  html[data-mobile-background="video-playing"] .mobile-background-video.is-playing,\n  .mobile-background-video.is-playing {\n    visibility: visible !important;\n    opacity: 1 !important;\n  }\n\n  /* The historical water canvas remains in the DOM for its fallback tests,\n     but it must never composite over the coherent full-frame video. */\n  .mobile-motion-canvas {\n    z-index: -1 !important;\n  }\n}\n${end}`;
  const first = next.indexOf(start);
  if (first >= 0) {
    const last = next.indexOf(end, first);
    if (last < 0) throw new Error("Coherent mobile CSS block is unterminated.");
    return (
      next.slice(0, first).trimEnd() +
      "\n\n" +
      block +
      "\n" +
      next.slice(last + end.length).trimStart()
    );
  }
  return `${next.trimEnd()}\n\n${block}\n`;
});

for (const path of [
  "public/guides.css",
  "public/_headers",
  ".github/workflows/verify-mobile-video.yml",
  ".github/workflows/verify-mobile-background.yml",
]) {
  await update(path, (source) => replaceRelease(source));
}

await update(".github/workflows/verify-mobile-video.yml", (source) =>
  source
    .replaceAll("1080x1920", `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`)
    .replaceAll(
      "native-source 1080x1920",
      `coherent-source ${VIDEO_WIDTH}x${VIDEO_HEIGHT}`,
    ),
);

// Only media-focused tests are rewritten here. General pipeline assertions are
// deliberately left to the existing canonical regression finalizer so this
// release stays idempotent across repeated npm test / npm run check passes.
await update("test/mobile-quality.test.mjs", (source) =>
  replaceRelease(source)
    .replaceAll(`${POSTER_ASSET} 1080w`, `${POSTER_ASSET} ${VIDEO_WIDTH}w`)
    .replaceAll(
      "{ width: 1080, height: 1920 }",
      `{ width: ${VIDEO_WIDTH}, height: ${VIDEO_HEIGHT} }`,
    )
    .replaceAll("native-source-1080x1920", QUALITY_LABEL),
);

await update("test/mobile-background-loading.test.mjs", (source) =>
  replaceRelease(source),
);

await update("test/shared-site-theme.test.mjs", (source) =>
  replaceRelease(source).split(LEGACY_POSTER).join(POSTER_ASSET),
);

console.log(
  `Finalized coherent mobile video ${VIDEO_WIDTH}x${VIDEO_HEIGHT}: ${VIDEO_ROUTE}.`,
);

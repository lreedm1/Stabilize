import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260813-mobile-background-v30-1";
const POSTER_ASSET = "/scenes/mobile-forest-stream-v24-native-1080.webp";
const ATLAS_ASSET = "/scenes/mobile-forest-stream-full-atlas-v29-1080.webp";
const VIDEO_ASSET = "/media/mobile-forest-stream-video-v24-native-1080.mp4";
const STYLE_ASSET = "/mobile-background-v30.css";
const CLIENT_ASSET = "/mobile-background-v30.js";
const TEST_PATH = "test/mobile-background-v30.test.mjs";

const HEAD_START = "<!-- mobile-background-v30-head-start -->";
const HEAD_END = "<!-- mobile-background-v30-head-end -->";
const MEDIA_START = "<!-- mobile-background-v30-media-start -->";
const MEDIA_END = "<!-- mobile-background-v30-media-end -->";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeMarked(source, start, end) {
  const hasStart = source.includes(start);
  const hasEnd = source.includes(end);
  if (!hasStart && !hasEnd) return source;
  if (hasStart !== hasEnd) {
    throw new Error(`Incomplete marked block: ${start}`);
  }
  const pattern = new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*(?:\\n|$)`,
    "g",
  );
  return source.replace(pattern, "");
}

function removeAssetTags(source, assetNames) {
  let next = source;
  for (const asset of assetNames) {
    const escaped = escapeRegExp(asset);
    next = next.replace(
      new RegExp(
        `^[ \\t]*<(?:link|script)[^>\\n]*${escaped}[^>\\n]*>(?:</script>)?[ \\t]*\\n?`,
        "gm",
      ),
      "",
    );
  }
  return next;
}

const headBlock = `    ${HEAD_START}
    <!-- Keep this preload in the historical responsive shape. Older media
         generators run before this finalizer and need an idempotent target on
         subsequent builds; v30 still replaces their runtime output below. -->
    <link
      rel="preload"
      as="image"
      href="${POSTER_ASSET}?v=${VERSION}"
      imagesrcset="
        ${POSTER_ASSET}?v=${VERSION} 2160w
      "
      imagesizes="100vw"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />
    <link
      rel="preload"
      as="image"
      href="${ATLAS_ASSET}?v=${VERSION}"
      media="(hover: none) and (pointer: coarse)"
      type="image/webp"
      fetchpriority="high"
    />
    <link rel="stylesheet" href="${STYLE_ASSET}?v=${VERSION}" />
    ${HEAD_END}`;

const mediaBlock = `    ${MEDIA_START}
    <video
      id="mobile-background-video"
      class="mobile-background-video"
      muted
      loop
      playsinline
      preload="none"
      poster="${POSTER_ASSET}?v=${VERSION}"
      data-src="${VIDEO_ASSET}?v=${VERSION}"
      aria-hidden="true"
      tabindex="-1"
      disablepictureinpicture
      disableremoteplayback
      x-webkit-airplay="deny"
    ></video>
    <canvas
      id="mobile-background-v30"
      class="mobile-background-v30"
      aria-hidden="true"
    ></canvas>
    <script src="${CLIENT_ASSET}?v=${VERSION}"></script>
    ${MEDIA_END}`;

await update("src/page.js", (source) => {
  let next = source;

  for (const [start, end] of [
    [
      "<!-- selected-mobile-4k-video-v22-preload-start -->",
      "<!-- selected-mobile-4k-video-v22-preload-end -->",
    ],
    [
      "<!-- mobile-motion-canvas-v18-preloads-start -->",
      "<!-- mobile-motion-canvas-v18-preloads-end -->",
    ],
    ["<!-- mobile-full-motion-v29-head-start -->", "<!-- mobile-full-motion-v29-head-end -->"],
    [HEAD_START, HEAD_END],
    ["<!-- mobile-motion-canvas-v18-start -->", "<!-- mobile-motion-canvas-v18-end -->"],
    ["<!-- selected-mobile-4k-video-v22-start -->", "<!-- selected-mobile-4k-video-v22-end -->"],
    ["<!-- mobile-full-motion-v29-canvas-start -->", "<!-- mobile-full-motion-v29-canvas-end -->"],
    [MEDIA_START, MEDIA_END],
    [
      "<!-- mobile-motion-canvas-v18-script-start -->",
      "<!-- mobile-motion-canvas-v18-script-end -->",
    ],
    [
      "<!-- selected-mobile-4k-video-v22-script-start -->",
      "<!-- selected-mobile-4k-video-v22-script-end -->",
    ],
    ["<!-- mobile-full-motion-v29-script-start -->", "<!-- mobile-full-motion-v29-script-end -->"],
  ]) {
    next = removeMarked(next, start, end);
  }

  next = removeAssetTags(next, [
    "mobile-woodland-loop.css",
    "mobile-static-fallback-fix-20260811.css",
    "mobile-orientation-v26.css",
    "mobile-autoplay-v27.css",
    "mobile-full-motion-v29.css",
    "mobile-background-v30.css",
    "mobile-autoplay-v27.js",
    "mobile-motion-canvas.js",
    "mobile-quality.js",
    "mobile-full-motion-v29.js",
    "mobile-background-v30.js",
  ]);

  const headAnchor = "  </head>";
  if (!next.includes(headAnchor)) {
    throw new Error("Could not find the page head insertion point.");
  }
  next = next.replace(headAnchor, `${headBlock}\n${headAnchor}`);

  // Keep </picture> immediately followed by #photo-background so the older
  // canvas generator can run on the next pass. The v30 media elements still
  // parse before the application shell and long before the app modules.
  const mediaAnchor = '    <div class="page-shell">';
  if (!next.includes(mediaAnchor)) {
    throw new Error("Could not find the mobile background insertion point.");
  }
  next = next.replace(mediaAnchor, `${mediaBlock}\n${mediaAnchor}`);

  const earlyClient = next.indexOf(`${CLIENT_ASSET}?v=${VERSION}`);
  const appClient = next.indexOf("/app.js?v=");
  if (earlyClient < 0 || appClient < 0 || earlyClient >= appClient) {
    throw new Error("The v30 controller must run before the application modules.");
  }

  for (const expected of [
    `${POSTER_ASSET}?v=${VERSION}`,
    `${ATLAS_ASSET}?v=${VERSION}`,
    `${VIDEO_ASSET}?v=${VERSION}`,
    `${STYLE_ASSET}?v=${VERSION}`,
    `${CLIENT_ASSET}?v=${VERSION}`,
    'id="mobile-background-video"',
    'id="mobile-background-v30"',
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`The v30 page is missing ${expected}.`);
    }
  }

  for (const obsolete of [
    "/mobile-autoplay-v27.js",
    "/mobile-motion-canvas.js",
    "/mobile-quality.js",
    "/mobile-full-motion-v29.js",
    "/mobile-autoplay-v27.css",
    "/mobile-full-motion-v29.css",
    'id="mobile-motion-canvas"',
    'id="mobile-full-motion-v29"',
  ]) {
    if (next.includes(obsolete)) {
      throw new Error(`An obsolete mobile background layer remains: ${obsolete}`);
    }
  }

  if (next.split('id="mobile-background-video"').length - 1 !== 1) {
    throw new Error("Expected exactly one mobile video element.");
  }
  if (next.split('id="mobile-background-v30"').length - 1 !== 1) {
    throw new Error("Expected exactly one v30 fallback canvas.");
  }

  return next;
});

await update("package.json", (source) => {
  const data = JSON.parse(source);
  const command = data.scripts?.["test:node"];
  if (typeof command !== "string") {
    throw new Error("package.json is missing test:node.");
  }

  const obsoleteTests = new Set([
    "test/mobile-quality.test.mjs",
    "test/mobile-autoplay-v27.test.mjs",
    "test/mobile-full-motion-v29.test.mjs",
    "test/mobile-background-loading.test.mjs",
  ]);
  const tokens = command.split(/\s+/).filter(Boolean);
  const firstObsolete = tokens.findIndex((token) => obsoleteTests.has(token));
  const filtered = tokens.filter(
    (token) => !obsoleteTests.has(token) && token !== TEST_PATH,
  );
  const insertionIndex = firstObsolete >= 0
    ? Math.min(firstObsolete, filtered.length)
    : Math.max(0, filtered.indexOf("test/domain.test.mjs"));
  filtered.splice(insertionIndex, 0, TEST_PATH);
  data.scripts["test:node"] = filtered.join(" ");
  return `${JSON.stringify(data, null, 2)}\n`;
});

await update("public/_headers", (source) => {
  const start = "# mobile-background-v30-start";
  const end = "# mobile-background-v30-end";
  const block = `${start}
/mobile-background-v30.js
  Content-Type: text/javascript; charset=utf-8
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

/mobile-background-v30.css
  Content-Type: text/css; charset=utf-8
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
${end}`;

  if (source.includes(start) || source.includes(end)) {
    if (!source.includes(start) || !source.includes(end)) {
      throw new Error("Incomplete v30 header block.");
    }
    const pattern = new RegExp(
      `${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`,
      "g",
    );
    return source.replace(pattern, block);
  }
  return `${source.trimEnd()}\n\n${block}\n`;
});

console.log(
  `Finalized the single-controller mobile background ${VERSION}: sharp poster, display-refresh interpolation, and native 4K handoff.`,
);

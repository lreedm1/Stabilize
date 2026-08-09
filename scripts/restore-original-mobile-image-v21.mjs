import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260809-selected-mobile-4k-video-v22-1";
const ORIGINAL_POSTER =
  "/scenes/mobile-forest-stream-v14-retina-2160.webp";
const VIDEO_ROUTE =
  "/media/mobile-forest-stream-video-v14-retina-2160.mp4";
const VIDEO_ASSET =
  "/scenes/mobile-forest-stream-video-v14-retina-2160.mp4";
const VIDEO_BYTES = 5_006_520;
const VIDEO_ETAG =
  '"16f5b59a82b6ba8a2820a548c4fd0395d59304dec8bf4c6fcfb68b1d423377ff"';
const REPLACEMENT_PREFIX =
  "/scenes/mobile-forest-stream-v20-true-hd-1440";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripMarked(source, start, end) {
  if (!source.includes(start) && !source.includes(end)) return source;
  if (!source.includes(start) || !source.includes(end)) {
    throw new Error(`Incomplete marked block: ${start}`);
  }
  const pattern = new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*(?:\\n|$)`,
    "g",
  );
  return source.replace(pattern, "");
}

function replaceMarked(source, start, end, replacement, append = false) {
  const normalized = `${replacement.trimEnd()}\n`;
  if (!source.includes(start) || !source.includes(end)) {
    if (source.includes(start) || source.includes(end)) {
      throw new Error(`Incomplete marked block: ${start}`);
    }
    if (append) return `${source.trimEnd()}\n\n${normalized}`;
    throw new Error(`Missing marked block: ${start}`);
  }
  const pattern = new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*(?:\\n|$)`,
    "g",
  );
  return source.replace(pattern, normalized);
}

function insertBefore(source, anchor, block, label) {
  if (source.includes(block.trim())) return source;
  if (!source.includes(anchor)) throw new Error(`Missing ${label} anchor.`);
  return source.replace(anchor, `${block.trimEnd()}\n${anchor}`);
}

function insertAfter(source, anchor, block, label) {
  if (source.includes(block.trim())) return source;
  if (!source.includes(anchor)) throw new Error(`Missing ${label} anchor.`);
  return source.replace(anchor, `${anchor}\n${block.trimEnd()}`);
}

const preloadStart = "<!-- selected-mobile-4k-video-v22-preload-start -->";
const preloadEnd = "<!-- selected-mobile-4k-video-v22-preload-end -->";
const preloadBlock = `    ${preloadStart}
    <link
      rel="preload"
      as="video"
      href="${VIDEO_ROUTE}"
      media="(max-width: 980px) and (orientation: portrait)"
      type="video/mp4"
    />
    ${preloadEnd}`;

const videoStart = "<!-- selected-mobile-4k-video-v22-start -->";
const videoEnd = "<!-- selected-mobile-4k-video-v22-end -->";
const videoBlock = `    ${videoStart}
    <video
      id="mobile-background-video"
      class="mobile-background-video"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
      poster="${ORIGINAL_POSTER}"
      aria-hidden="true"
      tabindex="-1"
    >
      <source src="${VIDEO_ROUTE}" type="video/mp4" />
    </video>
    ${videoEnd}`;

const scriptStart = "<!-- selected-mobile-4k-video-v22-script-start -->";
const scriptEnd = "<!-- selected-mobile-4k-video-v22-script-end -->";
const scriptBlock = `    ${scriptStart}
    <script type="module" src="/mobile-quality.js?v=${VERSION}"></script>
    ${scriptEnd}`;

await update("src/page.js", (source) => {
  let next = source;
  next = stripMarked(
    next,
    "<!-- mobile-hd-background-v20-preloads-start -->",
    "<!-- mobile-hd-background-v20-preloads-end -->",
  );
  next = stripMarked(
    next,
    "<!-- mobile-hd-background-v20-start -->",
    "<!-- mobile-hd-background-v20-end -->",
  );
  next = stripMarked(
    next,
    "<!-- mobile-hd-background-v20-script-start -->",
    "<!-- mobile-hd-background-v20-script-end -->",
  );

  if (next.includes(preloadStart)) {
    next = replaceMarked(next, preloadStart, preloadEnd, preloadBlock);
  } else {
    next = insertBefore(
      next,
      "    <!-- mobile-motion-canvas-v18-preloads-start -->",
      preloadBlock,
      "mobile preload",
    );
  }

  if (next.includes(videoStart)) {
    next = replaceMarked(next, videoStart, videoEnd, videoBlock);
  } else {
    next = insertAfter(
      next,
      "    <!-- mobile-motion-canvas-v18-end -->",
      videoBlock,
      "mobile canvas",
    );
  }

  if (next.includes(scriptStart)) {
    next = replaceMarked(next, scriptStart, scriptEnd, scriptBlock);
  } else {
    next = insertAfter(
      next,
      "    <!-- mobile-motion-canvas-v18-script-end -->",
      scriptBlock,
      "mobile canvas script",
    );
  }

  next = next.replace(
    /mobile-woodland-loop\.css\?v=[^"]+/,
    `mobile-woodland-loop.css?v=${VERSION}`,
  );

  const posterReferences =
    next.split(`${ORIGINAL_POSTER} 2160w`).length - 1;
  if (posterReferences !== 2) {
    throw new Error(
      `Expected two selected-scene poster references, found ${posterReferences}`,
    );
  }
  if (next.includes(REPLACEMENT_PREFIX)) {
    throw new Error("The wrong replacement scene is still referenced.");
  }
  if (next.includes("mobile-hd-background")) {
    throw new Error("The wrong replacement video layer is still present.");
  }
  if (next.split('id="mobile-motion-canvas"').length - 1 !== 1) {
    throw new Error("Expected exactly one selected-scene motion canvas.");
  }
  if (next.split('id="mobile-background-video"').length - 1 !== 1) {
    throw new Error("Expected exactly one selected-scene 4K video.");
  }
  if (next.split(`src="${VIDEO_ROUTE}"`).length - 1 !== 1) {
    throw new Error("Expected exactly one 4K video source.");
  }
  return next;
});

const styleStart = "/* selected-mobile-4k-video-v22-start */";
const styleEnd = "/* selected-mobile-4k-video-v22-end */";
const styleBlock = `${styleStart}
@media (max-width: 980px) and (orientation: portrait) {
  html .mobile-background-video {
    position: fixed;
    z-index: 0;
    inset: 0;
    display: block !important;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 50%;
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none;
    user-select: none;
    transform: translate3d(0, 0, 0);
    -webkit-transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    contain: strict;
    will-change: opacity;
  }

  html[data-mobile-background="video-playing"] .mobile-background-video {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }
}
${styleEnd}`;

await update("public/mobile-woodland-loop.css", (source) => {
  let next = stripMarked(
    source,
    "/* mobile-hd-background-v20-start */",
    "/* mobile-hd-background-v20-end */",
  );
  if (next.includes(styleStart)) {
    return replaceMarked(next, styleStart, styleEnd, styleBlock);
  }
  return `${next.trimEnd()}\n\n${styleBlock}\n`;
});

await update("public/_headers", (source) =>
  stripMarked(
    source,
    "# mobile-hd-background-v20-start",
    "# mobile-hd-background-v20-end",
  ),
);

await update("public/mobile-quality.js", (source) => {
  let next = source
    .replace(
      'const VIDEO_ASSET = "/media/mobile-forest-stream-video-v4-1080.mp4";',
      `const VIDEO_ASSET = "${VIDEO_ROUTE}";`,
    )
    .replace(
      'const RETINA_VIDEO_ASSET =\n  "/scenes/mobile-forest-stream-video-v14-retina-2160.mp4";',
      `const RETINA_VIDEO_ASSET =\n  "${VIDEO_ROUTE}";`,
    )
    .replace(
      'fallbackStep === 0 ? "retina" : "fallback";',
      'fallbackStep === 0 ? "4k-2160x3840" : "fallback";',
    );

  if (!next.includes(`const VIDEO_ASSET = "${VIDEO_ROUTE}";`)) {
    throw new Error("The mobile client did not receive the 4K Worker route.");
  }
  if (!next.includes(`"${VIDEO_ROUTE}";`)) {
    throw new Error("The Retina source did not receive the 4K Worker route.");
  }
  if (!next.includes('"4k-2160x3840"')) {
    throw new Error("The mobile client does not report 4K playback quality.");
  }
  return next;
});

await update("src/mobile-video-response.js", (source) => {
  let next = source
    .replace(
      /export const MOBILE_VIDEO_ROUTE =\n  "[^"]+";/,
      `export const MOBILE_VIDEO_ROUTE =\n  "${VIDEO_ROUTE}";`,
    )
    .replace(
      /export const MOBILE_VIDEO_ASSET_PATH =\n  "[^"]+";/,
      `export const MOBILE_VIDEO_ASSET_PATH =\n  "${VIDEO_ASSET}";`,
    )
    .replace(
      /export const MOBILE_VIDEO_BYTES = [\d_]+;/,
      "export const MOBILE_VIDEO_BYTES = 5_006_520;",
    )
    .replace(
      /export const MOBILE_VIDEO_ETAG =\n  '[^']+';/,
      `export const MOBILE_VIDEO_ETAG =\n  '${VIDEO_ETAG}';`,
    );

  for (const expected of [
    VIDEO_ROUTE,
    VIDEO_ASSET,
    "5_006_520",
    VIDEO_ETAG,
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`The 4K video responder is missing ${expected}.`);
    }
  }
  return next;
});

await update("test/mobile-background-loading.test.mjs", (source) => {
  let next = source.replaceAll(
    "mobile-forest-stream-video-v4-1080.mp4",
    "mobile-forest-stream-video-v14-retina-2160.mp4",
  );
  next = next.replace(
    "/materialize\\/mobile-forest-stream-video-1080-v4/",
    "/retina-mobile-video-v14-validation-start/",
  );
  return next;
});

await update("test/mobile-quality.test.mjs", (source) => {
  let next = stripMarked(
    source,
    "// mobile-hd-background-v20-quality-test-start",
    "// mobile-hd-background-v20-quality-test-end",
  );

  const testStart = "// original-mobile-image-v21-quality-test-start";
  const testEnd = "// original-mobile-image-v21-quality-test-end";
  const testBlock = `${testStart}
test("portrait mobile plays the selected forest-stream scene through the 4K route", async () => {
  const [pageSource, styleSource, videoClient, canvasClient] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-motion-canvas.js", import.meta.url), "utf8"),
    ]);

  assert.equal(
    [...pageSource.matchAll(/mobile-forest-stream-v14-retina-2160\\.webp 2160w/g)]
      .length,
    2,
  );
  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(
    pageSource,
    /\\/media\\/mobile-forest-stream-video-v14-retina-2160\\.mp4/,
  );
  assert.match(pageSource, /mobile-motion-canvas\\.js\\?v=/);
  assert.match(pageSource, /mobile-quality\\.js\\?v=${VERSION}/);
  assert.match(pageSource, /mobile-woodland-loop\\.css\\?v=${VERSION}/);
  assert.doesNotMatch(pageSource, /mobile-hd-background/);
  assert.doesNotMatch(pageSource, /mobile-forest-stream-v20-true-hd-1440/);
  assert.match(styleSource, /selected-mobile-4k-video-v22-start/);
  assert.match(styleSource, /data-mobile-background="video-playing"/);
  assert.match(
    videoClient,
    /\\/media\\/mobile-forest-stream-video-v14-retina-2160\\.mp4/,
  );
  assert.match(videoClient, /4k-2160x3840/);
  assert.match(
    canvasClient,
    /mobile-forest-stream-water-sprite-v19-hd-1080\\.webp/,
  );
});
${testEnd}`;

  if (next.includes(testStart)) {
    next = stripMarked(next, testStart, testEnd);
  }
  return `${next.trimEnd()}\n\n${testBlock}\n`;
});

console.log(
  `Restored the selected forest-stream scene and made its ${VIDEO_BYTES}-byte 2160x3840 MP4 the primary portrait-mobile background (${VERSION}).`,
);

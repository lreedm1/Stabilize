import { readFile, writeFile } from "node:fs/promises";

const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v14-retina-2160.webp";
const POSTER_FILENAME = "mobile-forest-stream-v14-retina-2160.webp";
const POSTER_WIDTH = 2160;
const POSTER_HEIGHT = 3840;
const SPRITE_ASSET =
  "/scenes/mobile-forest-stream-water-sprite-v18-540.webp";
const SPRITE_FILENAME = "mobile-forest-stream-water-sprite-v18-540.webp";
const SPRITE_WIDTH = 3240;
const SPRITE_HEIGHT = 4800;
const VERSION = "20260809-mobile-motion-canvas-v18-1";
const STATIC_PAGES = [
  "public/about.html",
  "public/floor-first.html",
  "public/how-it-works.html",
  "public/privacy.html",
  "public/safety.html",
  "public/support.html",
  "public/sustainability.html",
];

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function replaceRequired(source, pattern, replacement, label) {
  if (source.includes(replacement)) return source;
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Could not replace ${label}`);
  return next;
}

function replaceMarked(source, variants, replacement) {
  const normalized = `${replacement.trimEnd()}\n`;
  for (const [start, end] of variants) {
    if (!source.includes(start)) continue;
    const pattern = new RegExp(
      `[ \t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \t]*(?:\\n|$)`,
    );
    return source.replace(pattern, normalized);
  }
  const suffix = source.endsWith("\n") ? "" : "\n";
  return `${source}${suffix}\n${normalized}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripMarked(source, start, end) {
  if (!source.includes(start)) return source;
  return source.replace(
    new RegExp(
      `\\n?\\s*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`,
    ),
    "\n",
  );
}

const preloadStart = "<!-- mobile-motion-canvas-v18-preloads-start -->";
const preloadEnd = "<!-- mobile-motion-canvas-v18-preloads-end -->";
const preloadBlock = `    ${preloadStart}
    <link
      rel="preload"
      as="image"
      href="${POSTER_ASSET}"
      imagesrcset="
        ${POSTER_ASSET} ${POSTER_WIDTH}w
      "
      imagesizes="100vw"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />
    <link
      rel="preload"
      as="image"
      href="${SPRITE_ASSET}"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />
    ${preloadEnd}`;

const mobileSource = `      <source
        media="(max-width: 980px) and (orientation: portrait)"
        type="image/webp"
        sizes="100vw"
        srcset="\\n          ${POSTER_ASSET} ${POSTER_WIDTH}w\\n        "
      />`;

const canvasStart = "<!-- mobile-motion-canvas-v18-start -->";
const canvasEnd = "<!-- mobile-motion-canvas-v18-end -->";
const canvasBlock = `    ${canvasStart}
    <canvas
      id="mobile-motion-canvas"
      class="mobile-motion-canvas"
      aria-hidden="true"
    ></canvas>
    ${canvasEnd}
`;

const scriptStart = "<!-- mobile-motion-canvas-v18-script-start -->";
const scriptEnd = "<!-- mobile-motion-canvas-v18-script-end -->";
const scriptBlock = `    ${scriptStart}
    <script src="/mobile-motion-canvas.js?v=${VERSION}" defer></script>
    ${scriptEnd}
`;

await update("src/page.js", (source) => {
  let next = source;

  if (next.includes(preloadStart)) {
    next = replaceMarked(next, [[preloadStart, preloadEnd]], preloadBlock);
  } else {
    next = replaceRequired(
      next,
      /    <link\n      rel="preload"\n      as="image"\n      href="\/scenes\/mobile-[^"]+"\n      imagesrcset="[\s\S]*?"\n      imagesizes="100vw"\n      media="\(max-width: 980px\) and \(orientation: portrait\)"\n      type="image\/webp"\n      fetchpriority="high"\n    \/>/,
      preloadBlock,
      "the portrait mobile preload",
    );
  }

  next = replaceRequired(
    next,
    /      <source\n        media="\(max-width: 980px\) and \(orientation: portrait\)"\n        type="image\/webp"\n        sizes="100vw"\n        srcset="[\s\S]*?"\n      \/>/,
    mobileSource,
    "the portrait mobile picture source",
  );

  for (const [start, end] of [
    ["<!-- retina-mobile-video-v15-start -->", "<!-- retina-mobile-video-v15-end -->"],
    ["<!-- retina-mobile-video-v14-start -->", "<!-- retina-mobile-video-v14-end -->"],
  ]) {
    next = stripMarked(next, start, end);
  }
  next = next.replace(
    /\n?    <video\n      id="mobile-background-video"[\s\S]*?<\/video>\n?/,
    "\n",
  );
  next = next.replace(
    /\n?    <script src="\/mobile-quality\.js\?v=[^"]+"><\/script>\n?/,
    "\n",
  );

  if (next.includes(canvasStart)) {
    next = replaceMarked(next, [[canvasStart, canvasEnd]], canvasBlock);
  } else {
    next = replaceRequired(
      next,
      /    <\/picture>\n    <canvas\n      id="photo-background"/,
      `    </picture>\n${canvasBlock}    <canvas\n      id="photo-background"`,
      "the canvas insertion point",
    );
  }

  if (next.includes(scriptStart)) {
    next = replaceMarked(next, [[scriptStart, scriptEnd]], scriptBlock);
  } else {
    next = replaceRequired(
      next,
      /  <\/body>/,
      `${scriptBlock}  </body>`,
      "the mobile motion script insertion point",
    );
  }

  next = next.replace(
    /mobile-woodland-loop\.css\?v=[^"]+/,
    `mobile-woodland-loop.css?v=${VERSION}`,
  );

  const posterReferences =
    next.split(`${POSTER_ASSET} ${POSTER_WIDTH}w`).length - 1;
  if (posterReferences !== 2) {
    throw new Error(
      `Expected two Retina poster references, found ${posterReferences}`,
    );
  }
  if (next.split(SPRITE_ASSET).length - 1 !== 1) {
    throw new Error("Expected one sprite preload reference");
  }
  if (next.split('id="mobile-motion-canvas"').length - 1 !== 1) {
    throw new Error("Expected one mobile motion canvas");
  }
  if (next.split("mobile-motion-canvas.js").length - 1 !== 1) {
    throw new Error("Expected one mobile motion client script");
  }
  return next;
});

const styleStart = "/* mobile-motion-canvas-v18-start */";
const styleEnd = "/* mobile-motion-canvas-v18-end */";
const styleBlock = `${styleStart}
/* Keep the full 2160px poster sharp. Only transparent stream pixels are drawn
   over it, so motion does not depend on video.play() or animated-image policy. */
.mobile-background-video {
  display: none !important;
}

.mobile-motion-canvas {
  display: none;
}

@media (max-width: 980px) and (orientation: portrait) {
  .photo-backdrop img {
    object-fit: cover;
    object-position: 50% 50%;
    image-rendering: auto;
  }

  .mobile-motion-canvas {
    position: fixed;
    z-index: 0;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    opacity: 0;
    pointer-events: none;
    user-select: none;
    transform: translate3d(0, 0, 0);
    -webkit-transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    contain: strict;
    transition: opacity 120ms ease;
  }

  .mobile-motion-canvas.is-ready {
    opacity: 1;
  }
}
${styleEnd}
`;

await update("public/mobile-woodland-loop.css", (source) =>
  replaceMarked(
    source,
    [
      [styleStart, styleEnd],
      ["/* no-tap-mobile-motion-v16-start */", "/* no-tap-mobile-motion-v16-end */"],
      ["/* retina-mobile-video-v15-start */", "/* retina-mobile-video-v15-end */"],
      ["/* retina-mobile-video-v14-start */", "/* retina-mobile-video-v14-end */"],
    ],
    styleBlock,
  ),
);

const guideMobileBlock = `@media (max-width: 980px) and (orientation: portrait) {
  body::before {
    background-image: url("${POSTER_ASSET}");
    background-position: 50% 50%;
    filter: none;
  }
}`;

await update("public/guides.css", (source) =>
  replaceRequired(
    source,
    /@media \(max-width: 980px\) and \(orientation: portrait\) \{\n  body::before \{[\s\S]*?\n  \}\n\}/,
    guideMobileBlock,
    "the guide portrait background",
  ),
);

for (const path of STATIC_PAGES) {
  await update(path, (source) =>
    source.replace(
      /href="\/guides\.css(?:\?v=[^"]*)?"/g,
      `href="/guides.css?v=${VERSION}"`,
    ),
  );
}

const headersStart = "# mobile-motion-canvas-v18-start";
const headersEnd = "# mobile-motion-canvas-v18-end";
const headersBlock = `${headersStart}
/mobile-motion-canvas.js
  Content-Type: text/javascript; charset=utf-8
  Cache-Control: no-store, max-age=0

${SPRITE_ASSET}
  Content-Type: image/webp
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
${headersEnd}
`;
await update("public/_headers", (source) =>
  replaceMarked(source, [[headersStart, headersEnd]], headersBlock),
);

const mobileQualityTest = `test("portrait mobile draws water through a canvas without media autoplay", async () => {
  const [pageSource, mobileStyles, clientSource, poster, sprite] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-motion-canvas.js", import.meta.url), "utf8"),
      readFile(new URL("../public/scenes/${POSTER_FILENAME}", import.meta.url)),
      readFile(new URL("../public/scenes/${SPRITE_FILENAME}", import.meta.url)),
    ]);

  const posterInfo = webpInfo(poster);
  const spriteInfo = webpInfo(sprite);
  assert.deepEqual(
    { width: posterInfo.width, height: posterInfo.height },
    { width: ${POSTER_WIDTH}, height: ${POSTER_HEIGHT} },
  );
  assert.equal(posterInfo.chunks.includes("ANIM"), false);
  assert.deepEqual(
    { width: spriteInfo.width, height: spriteInfo.height },
    { width: ${SPRITE_WIDTH}, height: ${SPRITE_HEIGHT} },
  );
  assert.equal(spriteInfo.chunks.includes("ALPH"), true);
  assert.equal(spriteInfo.chunks.includes("ANIM"), false);
  assert.ok(sprite.byteLength > 1_000_000);
  assert.ok(sprite.byteLength < 10_000_000);

  assert.equal(
    [...pageSource.matchAll(/${escapeRegExp(POSTER_FILENAME)} ${POSTER_WIDTH}w/g)].length,
    2,
  );
  assert.ok(pageSource.includes('href="${SPRITE_ASSET}"'));
  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /mobile-motion-canvas\\.js\\?v=${VERSION}/);
  assert.doesNotMatch(pageSource, /id="mobile-background-video"/);
  assert.doesNotMatch(pageSource, /mobile-quality\\.js/);
  assert.match(mobileStyles, /mobile-motion-canvas-v18-start/);
  assert.match(mobileStyles, /\\.mobile-motion-canvas\\.is-ready/);

  assert.match(clientSource, /const FRAME_RATE = 6/);
  assert.match(clientSource, /context = canvas\\.getContext\\("2d"/);
  assert.match(clientSource, /ctx\\.drawImage\\(/);
  assert.match(clientSource, /setTimeout\\(step/);
  assert.doesNotMatch(clientSource, /\\.play\\(/);
  assert.doesNotMatch(clientSource, /HTMLVideoElement/);
});

`;

await update("test/mobile-quality.test.mjs", (source) => {
  const endMarker =
    'test("restored tabs recover from interrupted blank thinking views", async () => {';
  const end = source.indexOf(endMarker);
  const candidates = [
    'test("portrait mobile draws water through a canvas without media autoplay", async () => {',
    'test("portrait mobile moves without a media gesture", async () => {',
    'test("mobile uses the project-owner forest stream as its static portrait background", async () => {',
    'test("mobile uses responsive high-DPI static generated WebPs", async () => {',
  ];
  const starts = candidates
    .map((marker) => source.indexOf(marker))
    .filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Could not locate the mobile quality test block");
  }
  return source.slice(0, start) + mobileQualityTest + source.slice(end);
});

const loadingStart = "// mobile-motion-canvas-v18-test-start";
const loadingEnd = "// mobile-motion-canvas-v18-test-end";
const loadingBlock = `${loadingStart}
test("portrait mobile motion is independent of video and animated-image autoplay", async () => {
  const [pageSource, styleSource, clientSource, materializerSource, sprite] =
    await Promise.all([
      read("src/page.js"),
      read("public/mobile-woodland-loop.css"),
      read("public/mobile-motion-canvas.js"),
      read("scripts/materialize-mobile-forest-stream.mjs"),
      readFile(new URL("../public/scenes/${SPRITE_FILENAME}", import.meta.url)),
    ]);

  assert.equal(sprite.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(sprite.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(sprite.includes(Buffer.from("ALPH", "ascii")));
  assert.equal(sprite.includes(Buffer.from("ANIM", "ascii")), false);
  assert.equal(sprite.includes(Buffer.from("ANMF", "ascii")), false);
  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /${escapeRegExp(SPRITE_FILENAME)}/);
  assert.doesNotMatch(pageSource, /id="mobile-background-video"/);
  assert.doesNotMatch(pageSource, /mobile-quality\\.js/);
  assert.match(styleSource, /mobile-motion-canvas-v18-start/);
  assert.match(clientSource, /ctx\\.drawImage\\(/);
  assert.match(clientSource, /setTimeout\\(step/);
  assert.doesNotMatch(clientSource, /\\.play\\(/);
  assert.match(materializerSource, /mobile-water-sprite-v18-validation-start/);
  assert.match(materializerSource, /${escapeRegExp(SPRITE_FILENAME)}/);
});
${loadingEnd}
`;

await update("test/mobile-background-loading.test.mjs", (source) =>
  replaceMarked(
    source,
    [
      [loadingStart, loadingEnd],
      ["// no-tap-mobile-motion-v17-hq-test-start", "// no-tap-mobile-motion-v17-hq-test-end"],
      ["// no-tap-mobile-motion-v16-test-start", "// no-tap-mobile-motion-v16-test-end"],
      ["// retina-mobile-video-v15-test-start", "// retina-mobile-video-v15-test-end"],
      ["// retina-mobile-video-v14-test-start", "// retina-mobile-video-v14-test-end"],
    ],
    loadingBlock,
  ),
);

await update("test/shared-site-theme.test.mjs", (source) => {
  let next = source.replace(
    /^const VERSION = "[^"]+";/m,
    `const VERSION = "${VERSION}";`,
  );
  next = next.replaceAll(
    "/scenes/mobile-forest-stream-motion-v17-hq-1440.webp",
    POSTER_ASSET,
  );
  next = next.replaceAll(
    "mobile-forest-stream-motion-v17-hq-1440",
    POSTER_FILENAME.replace(/\.webp$/, ""),
  );
  return next;
});

console.log(
  "Installed a Retina poster plus automatic canvas water motion for portrait mobile.",
);

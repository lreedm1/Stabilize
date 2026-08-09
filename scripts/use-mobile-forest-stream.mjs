import { readFile, writeFile } from "node:fs/promises";

const MOBILE_ASSET = "/scenes/mobile-forest-stream-v11-1536.webp";
const POSTER_FILENAME = "mobile-forest-stream-v11-1536.webp";
const MOBILE_WIDTH = 1536;
const MOBILE_HEIGHT = 2732;
const MOBILE_BYTES = 356158;
const GUIDE_VERSION = "20260809-mobile-video-v11-1";
const MOBILE_STYLE_VERSION = "20260809-mobile-video-v11-1";
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

function replacePattern(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Mobile forest background could not find ${label}`);
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function replaceMobileQualityTest(source, replacement) {
  const endMarker =
    'test("restored tabs recover from interrupted blank thinking views", async () => {';
  const end = source.indexOf(endMarker);
  const candidates = [
    'test("mobile uses responsive high-DPI static generated WebPs", async () => {',
    'test("mobile uses the project-owner forest stream as its static portrait background", async () => {',
    'test("mobile starts with a screen-resolution forest poster", async () => {',
  ];
  const starts = candidates
    .map((marker) => source.indexOf(marker))
    .filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      "Mobile forest background could not find the existing mobile background test",
    );
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

const mobilePreload = `    <link
      rel="preload"
      as="image"
      href="${MOBILE_ASSET}"
      imagesrcset="
        ${MOBILE_ASSET} ${MOBILE_WIDTH}w
      "
      imagesizes="100vw"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />`;

const mobileSource = `      <source
        media="(max-width: 980px) and (orientation: portrait)"
        type="image/webp"
        sizes="100vw"
        srcset="\\n          ${MOBILE_ASSET} ${MOBILE_WIDTH}w\\n        "
      />`;

await update("src/page.js", (source) => {
  let next = replacePattern(
    source,
    /    <link\n      rel="preload"\n      as="image"\n      href="\/scenes\/mobile-[^"]+"\n      imagesrcset="[\s\S]*?"\n      imagesizes="100vw"\n      media="\(max-width: 980px\) and \(orientation: portrait\)"\n      type="image\/webp"\n      fetchpriority="high"\n    \/>/,
    mobilePreload,
    "the portrait mobile preload",
  );
  next = replacePattern(
    next,
    /      <source\n        media="\(max-width: 980px\) and \(orientation: portrait\)"\n        type="image\/webp"\n        sizes="100vw"\n        srcset="[\s\S]*?"\n      \/>/,
    mobileSource,
    "the portrait mobile picture source",
  );
  next = next.replace(
    /mobile-woodland-loop\.css\?v=[^"]+/,
    `mobile-woodland-loop.css?v=${MOBILE_STYLE_VERSION}`,
  );
  const references = next.split(`${MOBILE_ASSET} ${MOBILE_WIDTH}w`).length - 1;
  if (references !== 2) {
    throw new Error(`Expected two screen-resolution mobile references, found ${references}`);
  }
  return next;
});

const guideMobileBlock = `@media (max-width: 980px) and (orientation: portrait) {
  body::before {
    background-image: url("${MOBILE_ASSET}");
    background-position: 50% 50%;
    filter: none;
  }
}`;

await update("public/guides.css", (source) =>
  replacePattern(
    source,
    /@media \(max-width: 980px\) and \(orientation: portrait\) \{\n  body::before \{[\s\S]*?\n  \}\n\}/,
    guideMobileBlock,
    "the guide-page portrait background block",
  ),
);

await update("scripts/unify-public-page-theme.mjs", (source) => {
  let next = source.replace(
    /^const VERSION = "[^"]+";/m,
    `const VERSION = "${GUIDE_VERSION}";`,
  );
  next = next.replace(
    /^const MOBILE_1X = "[^"]+";/m,
    `const MOBILE_1X = "${MOBILE_ASSET}";`,
  );
  next = next.replace(
    /^const MOBILE_2X = "[^"]+";/m,
    `const MOBILE_2X = "${MOBILE_ASSET}";`,
  );
  if (!next.includes(`const MOBILE_1X = "${MOBILE_ASSET}";`)) {
    throw new Error("Unified theme generator did not receive the screen-resolution forest poster");
  }
  return next;
});

for (const path of STATIC_PAGES) {
  await update(path, (source) =>
    source.replace(
      /href="\/guides\.css(?:\?v=[^"]*)?"/g,
      `href="/guides.css?v=${GUIDE_VERSION}"`,
    ),
  );
}

const mobileQualityTest = String.raw`test("mobile starts with a screen-resolution forest poster", async () => {
  const tier = {
    filename: "${POSTER_FILENAME}",
    width: ${MOBILE_WIDTH},
    height: ${MOBILE_HEIGHT},
  };
  const [pageSource, mobileStyles, image] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
    readFile(new URL("../public/scenes/" + tier.filename, import.meta.url)),
  ]);
  const imageInfo = webpInfo(image);
  assert.deepEqual(
    { width: imageInfo.width, height: imageInfo.height },
    { width: tier.width, height: tier.height },
  );
  assert.equal(image.byteLength, ${MOBILE_BYTES});
  assert.equal(imageInfo.chunks.includes("ANIM"), false);
  assert.equal(
    [...pageSource.matchAll(new RegExp(tier.filename + " " + tier.width + "w", "g"))].length,
    2,
  );
  assert.match(pageSource, /<source[\s\S]*sizes="100vw"[\s\S]*srcset=/);
  assert.match(pageSource, /<link[\s\S]*rel="preload"[\s\S]*imagesrcset=/);
  assert.match(pageSource, /imagesizes="100vw"/);
  assert.ok(pageSource.includes('href="${MOBILE_ASSET}"'));
  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(pageSource, /autoplay[\s\S]*muted[\s\S]*loop[\s\S]*playsinline/);
  assert.match(
    pageSource,
    /mobile-woodland-loop\.css\?v=20260809-mobile-video-v11-1/,
  );
  assert.match(mobileStyles, /\.mobile-background-video\.is-playing/);
  assert.match(mobileStyles, /object-fit:\s*cover/);
});

`;

await update("test/mobile-quality.test.mjs", (source) =>
  replaceMobileQualityTest(source, mobileQualityTest),
);

await update("test/shared-site-theme.test.mjs", (source) => {
  let next = source.replace(
    /^const VERSION = "[^"]+";/m,
    `const VERSION = "${GUIDE_VERSION}";`,
  );
  for (const oldAsset of [
    "/scenes/mobile-golden-alpine-v3-720.webp",
    "/scenes/mobile-golden-alpine-v3-1440.webp",
    "/scenes/mobile-forest-stream-v1-720.webp",
    "/scenes/mobile-forest-stream-v1-540.webp",
  ]) {
    next = next.replaceAll(oldAsset, MOBILE_ASSET);
  }
  next = next.replaceAll("mobile-golden-alpine-v3", POSTER_FILENAME.replace(/\.webp$/, ""));
  next = next.replaceAll("mobile-forest-stream-v1-720", POSTER_FILENAME.replace(/\.webp$/, ""));
  next = next.replaceAll("mobile-forest-stream-v1-540", POSTER_FILENAME.replace(/\.webp$/, ""));
  return next;
});

await update(".github/workflows/verify-mobile-background.yml", (source) =>
  source.replace(
    /href="\/scenes\/mobile-[^"]+\.webp"/,
    `href="${MOBILE_ASSET}"`,
  ),
);

console.log("Installed the screen-resolution forest poster for portrait mobile.");

import { readFile, writeFile } from "node:fs/promises";

const MOBILE_ASSET = "/scenes/mobile-forest-stream-v1-540.webp";
const MOBILE_VIDEO_ASSET = "/scenes/mobile-forest-stream-v1.mp4";
const MOBILE_VIDEO_VERSION = "20260808-forest-video-1";
const GUIDE_VERSION = "20260808-mobile-forest-stream-540-1";
const MOBILE_STYLE_VERSION = "20260808-mobile-forest-stream-540-1";
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
    'test("mobile uses the supplied forest stream video with a still fallback", async () => {',
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
        ${MOBILE_ASSET} 540w
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
        srcset="\\n          ${MOBILE_ASSET} 540w\\n        "
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
  const references = next.split(`${MOBILE_ASSET} 540w`).length - 1;
  if (references !== 2) {
    throw new Error(`Expected two mobile forest references, found ${references}`);
  }
  return next;
});

await update("public/mobile-quality.js", (source) => {
  let next = replacePattern(
    source,
    /const MOBILE_VIDEO_URL =\n  "[^"]+";/,
    `const MOBILE_VIDEO_URL =\n  "${MOBILE_VIDEO_ASSET}?v=${MOBILE_VIDEO_VERSION}";`,
    "the mobile video URL",
  );
  next = replacePattern(
    next,
    /const MOBILE_POSTER_URL = "[^"]+";/,
    `const MOBILE_POSTER_URL = "${MOBILE_ASSET}";`,
    "the mobile poster URL",
  );
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
    throw new Error("Unified theme generator did not receive the forest background");
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

const mobileQualityTest = String.raw`test("mobile uses the supplied forest stream video with a still fallback", async () => {
  const tier = {
    filename: "mobile-forest-stream-v1-540.webp",
    width: 540,
    height: 960,
  };
  const [pageSource, mobileStyles, mobileScript, image, video] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(
        new URL("../public/mobile-woodland-loop.css", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(
        new URL("../public/scenes/" + tier.filename, import.meta.url),
      ),
      readFile(
        new URL(
          "../public/scenes/mobile-forest-stream-v1.mp4",
          import.meta.url,
        ),
      ),
    ]);
  const imageInfo = webpInfo(image);
  assert.deepEqual(
    { width: imageInfo.width, height: imageInfo.height },
    { width: tier.width, height: tier.height },
  );
  assert.equal(image.byteLength, 91_750);
  assert.equal(imageInfo.chunks.includes("ANIM"), false);
  assert.equal(video.byteLength, 602_638);
  for (const marker of ["ftyp", "moov", "mdat", "avc1", "vide"]) {
    assert.ok(video.includes(Buffer.from(marker)), "MP4 includes " + marker);
  }
  assert.equal(video.includes(Buffer.from("mp4a")), false);
  assert.equal(video.includes(Buffer.from("soun")), false);
  assert.ok(video.indexOf(Buffer.from("moov")) < video.indexOf(Buffer.from("mdat")));
  assert.equal(
    [...pageSource.matchAll(new RegExp(tier.filename + " " + tier.width + "w", "g"))].length,
    2,
  );
  assert.match(pageSource, /<source[\s\S]*sizes="100vw"[\s\S]*srcset=/);
  assert.match(pageSource, /<link[\s\S]*rel="preload"[\s\S]*imagesrcset=/);
  assert.match(pageSource, /imagesizes="100vw"/);
  assert.match(pageSource, /mobile-quality\.js\?v=20260802-8/);
  assert.match(
    mobileScript,
    /\/scenes\/mobile-forest-stream-v1\.mp4\?v=20260808-forest-video-1/,
  );
  assert.match(mobileScript, /video\.autoplay = true/);
  assert.match(mobileScript, /video\.muted = true/);
  assert.match(mobileScript, /video\.defaultMuted = true/);
  assert.match(mobileScript, /video\.loop = true/);
  assert.match(mobileScript, /video\.playsInline = true/);
  assert.match(mobileScript, /webkit-playsinline/);
  assert.match(mobileScript, /video\.addEventListener\("playing"/);
  assert.match(mobileScript, /await mobileVideo\.play\(\)/);
  assert.match(mobileScript, /window\.addEventListener\("pageshow"/);
  assert.match(mobileScript, /visibilitychange/);
  assert.match(mobileScript, /pointerdown/);
  assert.match(mobileScript, /touchstart/);
  assert.match(mobileScript, /backdrop\.style\.opacity = "0"/);
  assert.match(mobileScript, /video-waiting-for-interaction/);
  assert.match(mobileStyles, /object-fit:\s*cover/);
  assert.match(mobileStyles, /animation:\s*none/);
  assert.doesNotMatch(pageSource, /mobile-golden-alpine/);
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
  ]) {
    next = next.replaceAll(oldAsset, MOBILE_ASSET);
  }
  next = next.replaceAll(
    "mobile-golden-alpine-v3",
    "mobile-forest-stream-v1-540",
  );
  next = next.replaceAll(
    "mobile-forest-stream-v1-720",
    "mobile-forest-stream-v1-540",
  );
  return next;
});

console.log(
  "Installed the project-owner forest stream video with a portrait still fallback.",
);

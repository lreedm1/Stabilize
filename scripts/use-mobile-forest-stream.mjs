import { readFile, writeFile } from "node:fs/promises";

const MOBILE_ASSET = "/scenes/mobile-forest-stream-v1-540.webp";
const MOBILE_VIDEO_ASSET = "/scenes/mobile-forest-stream-v1.mp4";
const MOBILE_VIDEO_VERSION = "20260808-uploaded-forest-video-1";
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
    'test("mobile plays the supplied forest stream video over the static poster", async () => {',
    'test("mobile plays the uploaded forest stream video over the static poster", async () => {',
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

const mobileVideoClient = `const MOBILE_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_URL =
  "${MOBILE_VIDEO_ASSET}?v=${MOBILE_VIDEO_VERSION}";

function styleVideo(video) {
  Object.assign(video.style, {
    position: "fixed",
    inset: "0",
    zIndex: "0",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "50% 50%",
    pointerEvents: "none",
    userSelect: "none",
    opacity: "0",
    transition: "opacity 220ms ease",
  });
}

function revealVideo(video, backdrop) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  video.style.opacity = "1";
  backdrop?.classList.add("video-active");
}

function keepPoster(backdrop) {
  backdrop?.classList.remove("video-active");
}

export function configureMobileForestVideo(target = globalThis.window) {
  const document = target?.document;
  const matchMedia = target?.matchMedia?.bind(target);
  if (!document || !matchMedia || !matchMedia(MOBILE_QUERY).matches) {
    return null;
  }

  const backdrop = document.querySelector("#photo-backdrop");
  if (!backdrop) return null;

  let video = document.querySelector("#mobile-background-video");
  if (!(video instanceof target.HTMLVideoElement)) {
    video = document.createElement("video");
    video.id = "mobile-background-video";
    video.className = "mobile-background-video";
    video.autoplay = true;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("aria-hidden", "true");
    video.setAttribute("disablepictureinpicture", "");
    video.tabIndex = -1;
    styleVideo(video);

    video.addEventListener("loadeddata", () => revealVideo(video, backdrop));
    video.addEventListener("playing", () => revealVideo(video, backdrop));
    video.addEventListener("error", () => keepPoster(backdrop));

    backdrop.insertAdjacentElement("afterend", video);
  }

  if (!video.src) {
    video.src = VIDEO_URL;
    video.load();
  }

  const tryPlay = () => {
    video.muted = true;
    video.defaultMuted = true;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => keepPoster(backdrop));
    }
  };

  tryPlay();
  for (const eventName of ["pointerdown", "touchstart", "keydown"]) {
    document.addEventListener(eventName, tryPlay, {
      once: true,
      passive: eventName !== "keydown",
    });
  }
  target.addEventListener("pageshow", tryPlay);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tryPlay();
  });

  return video;
}

configureMobileForestVideo();
`;
await writeFile("public/mobile-quality.js", mobileVideoClient, "utf8");

const mobileQualityTest = String.raw`test("mobile plays the uploaded forest stream video over the static poster", async () => {
  const [pageSource, mobileStyles, clientSource, poster, video] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(
        new URL("../public/mobile-woodland-loop.css", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../public/scenes/mobile-forest-stream-v1-540.webp",
          import.meta.url,
        ),
      ),
      readFile(
        new URL(
          "../public/scenes/mobile-forest-stream-v1.mp4",
          import.meta.url,
        ),
      ),
    ]);

  const imageInfo = webpInfo(poster);
  assert.deepEqual(
    { width: imageInfo.width, height: imageInfo.height },
    { width: 540, height: 960 },
  );
  assert.equal(poster.byteLength, 91_750);
  assert.equal(imageInfo.chunks.includes("ANIM"), false);
  assert.equal(video.byteLength, 116_072);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  assert.ok(video.indexOf(Buffer.from("moov")) < video.indexOf(Buffer.from("mdat")));
  assert.equal(video.includes(Buffer.from("avc1")), true);
  assert.equal(video.includes(Buffer.from("mp4a")), false);
  assert.equal(video.includes(Buffer.from("soun")), false);
  assert.equal(
    [...pageSource.matchAll(/mobile-forest-stream-v1-540\.webp 540w/g)].length,
    2,
  );
  assert.match(
    pageSource,
    /<script type="module" src="\/mobile-quality\.js\?v=20260808-uploaded-forest-video-1"><\/script>/,
  );
  assert.match(
    clientSource,
    /mobile-forest-stream-v1\.mp4\?v=20260808-uploaded-forest-video-1/,
  );
  assert.match(clientSource, /document\.createElement\("video"\)/);
  assert.match(clientSource, /video\.autoplay = true/);
  assert.match(clientSource, /video\.muted = true/);
  assert.match(clientSource, /video\.defaultMuted = true/);
  assert.match(clientSource, /video\.loop = true/);
  assert.match(clientSource, /video\.playsInline = true/);
  assert.match(clientSource, /video\.setAttribute\("webkit-playsinline", ""\)/);
  assert.match(clientSource, /video\.play\(\)/);
  assert.match(clientSource, /"pointerdown", "touchstart", "keydown"/);
  assert.match(clientSource, /target\.addEventListener\("pageshow", tryPlay\)/);
  assert.match(clientSource, /visibilitychange/);
  assert.match(clientSource, /objectFit: "cover"/);
  assert.match(clientSource, /backdrop\?\.classList\.add\("video-active"\)/);
  assert.match(mobileStyles, /\.photo-backdrop\.video-active img/);
  assert.match(mobileStyles, /opacity:\s*0/);
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

await update(".github/workflows/verify-mobile-background.yml", (source) => {
  let next = source.replace(
    /href="\/scenes\/mobile-[^"]+\.webp"/,
    `href="${MOBILE_ASSET}"`,
  );
  next = next.replace(
    /const VIDEO_VERSION = "[^"]+";/,
    `const VIDEO_VERSION = "${MOBILE_VIDEO_VERSION}";`,
  );
  return next;
});

console.log(
  "Installed the uploaded forest stream as an autoplaying portrait mobile video with a static poster fallback.",
);

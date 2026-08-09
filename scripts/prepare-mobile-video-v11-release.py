#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit(
        "usage: prepare-mobile-video-v11-release.py VIDEO_PATH POSTER_PATH"
    )

root = Path.cwd()
video_source = Path(sys.argv[1])
poster_source = Path(sys.argv[2])
if not video_source.is_file() or not poster_source.is_file():
    raise SystemExit("validated video and poster files are required")

VIDEO_FILE = "mobile-forest-stream-video-v11-1536.mp4"
VIDEO_ROUTE = f"/media/{VIDEO_FILE}"
VIDEO_ASSET = f"/scenes/{VIDEO_FILE}"
POSTER_FILE = "mobile-forest-stream-v11-1536.webp"
POSTER_ASSET = f"/scenes/{POSTER_FILE}"
VERSION = "20260809-mobile-video-v11-1"
WIDTH = 1536
HEIGHT = 2732

video = video_source.read_bytes()
poster = poster_source.read_bytes()
video_bytes = len(video)
poster_bytes = len(poster)
video_sha = hashlib.sha256(video).hexdigest()
poster_sha = hashlib.sha256(poster).hexdigest()

if video_bytes < 300_000:
    raise SystemExit(f"replacement video is unexpectedly small: {video_bytes}")
if video[4:8] != b"ftyp":
    raise SystemExit("replacement video is not an MP4")
if poster[:4] != b"RIFF" or poster[8:12] != b"WEBP":
    raise SystemExit("replacement poster is not a WebP")

scenes = root / "public/scenes"
scenes.mkdir(parents=True, exist_ok=True)
shutil.copyfile(video_source, scenes / VIDEO_FILE)
shutil.copyfile(poster_source, scenes / POSTER_FILE)


def read(path: str) -> str:
    return (root / path).read_text()


def write(path: str, content: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_required(
    source: str,
    pattern: str,
    replacement: str,
    label: str,
    *,
    flags: int = 0,
    count: int = 1,
) -> str:
    next_source, replacements = re.subn(
        pattern,
        replacement,
        source,
        count=count,
        flags=flags,
    )
    if replacements != count:
        raise SystemExit(
            f"expected {count} replacement(s) for {label}; found {replacements}"
        )
    return next_source


materializer = f'''import {{ createHash }} from "node:crypto";
import {{ mkdir, readdir, readFile, writeFile }} from "node:fs/promises";

const legacyPosterPayloadDirectory = "materialize/mobile-forest-stream";
const legacyPosterOutputPath = "public/scenes/mobile-forest-stream-v1-540.webp";
const expectedLegacyPosterBytes = 91_750;
const expectedLegacyPosterSha256 =
  "e2396c2f73018151c20f99130ebdde75a85db6248ed5459ea0039f03e84eb23c";

const screenPosterPath = "public/scenes/{POSTER_FILE}";
const expectedScreenPosterBytes = {poster_bytes:_};
const expectedScreenPosterSha256 =
  "{poster_sha}";
const videoPath = "public/scenes/{VIDEO_FILE}";
const expectedVideoBytes = {video_bytes:_};
const expectedVideoSha256 =
  "{video_sha}";

function sha256(buffer) {{
  return createHash("sha256").update(buffer).digest("hex");
}}

function webpInfo(buffer) {{
  if (
    buffer.byteLength < 12 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {{
    throw new Error("Mobile forest payload is not a WebP image");
  }}

  const declaredLength = buffer.readUInt32LE(4) + 8;
  if (declaredLength !== buffer.byteLength) {{
    throw new Error(
      `WebP length mismatch: declared ${{declaredLength}}, received ${{buffer.byteLength}}`,
    );
  }}

  let width;
  let height;
  let animated = false;
  let offset = 12;
  while (offset + 8 <= buffer.length) {{
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    const end = data + size;
    if (end > buffer.length) throw new Error(`Truncated WebP chunk: ${{type}}`);

    if (type === "ANIM") animated = true;
    if (type === "VP8X" && data + 10 <= buffer.length) {{
      width = 1 + buffer.readUIntLE(data + 4, 3);
      height = 1 + buffer.readUIntLE(data + 7, 3);
    }} else if (
      type === "VP8 " &&
      data + 10 <= buffer.length &&
      buffer[data + 3] === 0x9d &&
      buffer[data + 4] === 0x01 &&
      buffer[data + 5] === 0x2a
    ) {{
      width ??= buffer.readUInt16LE(data + 6) & 0x3fff;
      height ??= buffer.readUInt16LE(data + 8) & 0x3fff;
    }} else if (
      type === "VP8L" &&
      data + 5 <= buffer.length &&
      buffer[data] === 0x2f
    ) {{
      const bits = buffer.readUInt32LE(data + 1);
      width ??= 1 + (bits & 0x3fff);
      height ??= 1 + ((bits >>> 14) & 0x3fff);
    }}

    offset = end + (size % 2);
  }}

  return {{ width, height, animated }};
}}

async function readBase64Payload(directory) {{
  const payloadFiles = (await readdir(directory))
    .filter((name) => /^\\d{{3}}\\.b64$/.test(name))
    .sort();
  if (!payloadFiles.length) {{
    throw new Error(`Payload chunks are missing from ${{directory}}`);
  }}
  const encodedParts = await Promise.all(
    payloadFiles.map((name) => readFile(`${{directory}}/${{name}}`, "utf8")),
  );
  const encoded = encodedParts.join("").replace(/\\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={{0,2}}$/.test(encoded)) {{
    throw new Error(`Payload in ${{directory}} is not valid base64 text`);
  }}
  return {{ payloadFiles, bytes: Buffer.from(encoded, "base64") }};
}}

function validateVideo(buffer) {{
  if (buffer.byteLength !== expectedVideoBytes) {{
    throw new Error(
      `Unexpected mobile forest video size: ${{buffer.byteLength}}; expected ${{expectedVideoBytes}}`,
    );
  }}
  const actualSha = sha256(buffer);
  if (actualSha !== expectedVideoSha256) {{
    throw new Error(`Mobile forest video checksum mismatch: ${{actualSha}}`);
  }}
  if (buffer.byteLength < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") {{
    throw new Error("Mobile forest video is not an MP4 file");
  }}
  for (const marker of ["moov", "mdat", "vide", "avc1"]) {{
    if (!buffer.includes(Buffer.from(marker, "ascii"))) {{
      throw new Error(`Mobile forest video is missing the ${{marker}} marker`);
    }}
  }}
  const moovOffset = buffer.indexOf(Buffer.from("moov", "ascii"));
  const mdatOffset = buffer.indexOf(Buffer.from("mdat", "ascii"));
  if (moovOffset < 0 || mdatOffset < 0 || moovOffset > mdatOffset) {{
    throw new Error("Mobile forest video is not optimized for fast start");
  }}
  if (buffer.includes(Buffer.from("mp4a", "ascii")) || buffer.includes(Buffer.from("soun", "ascii"))) {{
    throw new Error("Mobile forest background video must not contain audio");
  }}
  return actualSha;
}}

const legacyPayload = await readBase64Payload(legacyPosterPayloadDirectory);
if (legacyPayload.bytes.byteLength !== expectedLegacyPosterBytes) {{
  throw new Error(
    `Unexpected legacy mobile poster size: ${{legacyPayload.bytes.byteLength}}`,
  );
}}
if (sha256(legacyPayload.bytes) !== expectedLegacyPosterSha256) {{
  throw new Error("Legacy mobile poster checksum mismatch");
}}
const legacyInfo = webpInfo(legacyPayload.bytes);
if (legacyInfo.width !== 540 || legacyInfo.height !== 960 || legacyInfo.animated) {{
  throw new Error(
    `Unexpected legacy mobile poster: ${{legacyInfo.width}}x${{legacyInfo.height}}, animated=${{legacyInfo.animated}}`,
  );
}}
await mkdir("public/scenes", {{ recursive: true }});
await writeFile(legacyPosterOutputPath, legacyPayload.bytes);

const screenPoster = await readFile(screenPosterPath);
if (screenPoster.byteLength !== expectedScreenPosterBytes) {{
  throw new Error(
    `Unexpected screen-resolution poster size: ${{screenPoster.byteLength}}; expected ${{expectedScreenPosterBytes}}`,
  );
}}
const actualScreenPosterSha = sha256(screenPoster);
if (actualScreenPosterSha !== expectedScreenPosterSha256) {{
  throw new Error(
    `Screen-resolution poster checksum mismatch: ${{actualScreenPosterSha}}`,
  );
}}
const screenPosterInfo = webpInfo(screenPoster);
if (
  screenPosterInfo.width !== {WIDTH} ||
  screenPosterInfo.height !== {HEIGHT} ||
  screenPosterInfo.animated
) {{
  throw new Error(
    `Unexpected screen-resolution poster: ${{screenPosterInfo.width}}x${{screenPosterInfo.height}}, animated=${{screenPosterInfo.animated}}`,
  );
}}

const mobileVideo = await readFile(videoPath);
const actualVideoSha = validateVideo(mobileVideo);
console.log(
  `Validated ${{videoPath}}: {WIDTH}x{HEIGHT}, ${{mobileVideo.byteLength}} bytes, sha256=${{actualVideoSha}}, strict frame decoding is enforced in CI`,
);
'''
write("scripts/materialize-mobile-forest-stream.mjs", materializer)

client = f'''const MOBILE_BACKGROUND_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_ASSET = "{VIDEO_ROUTE}";
const POSTER_ASSET = "{POSTER_ASSET}";

const mobilePortrait = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
const backgroundVideo = document.querySelector("#mobile-background-video");
const backdropImage = document.querySelector("#photo-backdrop-image");
const terrain = document.querySelector("#terrain-background");

let gestureListenersInstalled = false;

function markPosterReady() {{
  terrain?.classList.add("is-photo-ready");
  if (document.documentElement.dataset.mobileBackground !== "video-playing") {{
    document.documentElement.dataset.mobileBackground = "poster-ready";
  }}
}}

if (backdropImage instanceof HTMLImageElement) {{
  if (backdropImage.complete && backdropImage.naturalWidth > 0) {{
    markPosterReady();
  }} else {{
    backdropImage.addEventListener("load", markPosterReady, {{ once: true }});
    backdropImage.addEventListener(
      "error",
      () => {{
        document.documentElement.dataset.mobileBackground = "poster-failed";
      }},
      {{ once: true }},
    );
  }}
}}

function removeGestureListeners() {{
  if (!gestureListenersInstalled) return;
  gestureListenersInstalled = false;
  window.removeEventListener("pointerdown", resumeAfterGesture, true);
  window.removeEventListener("touchstart", resumeAfterGesture, true);
  window.removeEventListener("keydown", resumeAfterGesture, true);
}}

function addGestureListeners() {{
  if (gestureListenersInstalled) return;
  gestureListenersInstalled = true;
  window.addEventListener("pointerdown", resumeAfterGesture, {{
    capture: true,
    passive: true,
  }});
  window.addEventListener("touchstart", resumeAfterGesture, {{
    capture: true,
    passive: true,
  }});
  window.addEventListener("keydown", resumeAfterGesture, {{ capture: true }});
}}

function showPoster(state = "poster-ready") {{
  backgroundVideo?.classList.remove("is-playing");
  document.documentElement.dataset.mobileBackground = state;
}}

function markVideoPlaying() {{
  if (
    !(backgroundVideo instanceof HTMLVideoElement) ||
    !mobilePortrait?.matches ||
    backgroundVideo.paused ||
    backgroundVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {{
    return;
  }}
  backgroundVideo.classList.add("is-playing");
  terrain?.classList.add("is-photo-ready");
  document.documentElement.dataset.mobileBackground = "video-playing";
  removeGestureListeners();
}}

function configureVideo() {{
  if (!(backgroundVideo instanceof HTMLVideoElement)) return null;
  backgroundVideo.autoplay = true;
  backgroundVideo.muted = true;
  backgroundVideo.defaultMuted = true;
  backgroundVideo.loop = true;
  backgroundVideo.playsInline = true;
  backgroundVideo.preload = "auto";
  backgroundVideo.poster = POSTER_ASSET;
  if (!backgroundVideo.getAttribute("src")) {{
    backgroundVideo.src = VIDEO_ASSET;
  }}
  return backgroundVideo;
}}

function startVideo() {{
  if (!mobilePortrait?.matches || document.hidden) return;
  const video = configureVideo();
  if (!video) {{
    showPoster("video-missing");
    return;
  }}
  document.documentElement.dataset.mobileBackground = "video-loading";
  let playback;
  try {{
    playback = video.play();
  }} catch {{
    showPoster("video-awaiting-gesture");
    addGestureListeners();
    return;
  }}
  if (playback && typeof playback.then === "function") {{
    playback
      .then(markVideoPlaying)
      .catch(() => {{
        showPoster("video-awaiting-gesture");
        addGestureListeners();
      }});
  }} else {{
    markVideoPlaying();
  }}
}}

function resumeAfterGesture() {{
  startVideo();
}}

if (backgroundVideo instanceof HTMLVideoElement) {{
  for (const eventName of ["loadeddata", "canplay", "playing", "timeupdate"]) {{
    backgroundVideo.addEventListener(eventName, markVideoPlaying);
  }}
  backgroundVideo.addEventListener("error", () => {{
    showPoster("video-failed");
    addGestureListeners();
  }});
}}

mobilePortrait?.addEventListener?.("change", (event) => {{
  if (event.matches) {{
    addGestureListeners();
    startVideo();
  }} else {{
    removeGestureListeners();
    backgroundVideo?.pause();
    showPoster("poster-ready");
  }}
}});

document.addEventListener("visibilitychange", () => {{
  if (document.hidden) {{
    backgroundVideo?.pause();
  }} else {{
    startVideo();
  }}
}});
window.addEventListener("pageshow", startVideo);
window.addEventListener("pagehide", () => backgroundVideo?.pause());

if (mobilePortrait?.matches) {{
  addGestureListeners();
  startVideo();
}}
'''
write("public/mobile-quality.js", client)

mobile_css = '''.mobile-background-video {
  display: none;
}

@media (max-width: 980px) and (orientation: portrait) {
  .photo-backdrop {
    overflow: hidden;
    background: #173f31;
    filter: none;
    transform: none;
    animation: none;
    will-change: auto;
  }

  .photo-backdrop img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 50%;
    opacity: 1;
    filter: none;
    transform: none !important;
    animation: none !important;
    will-change: auto;
  }

  .mobile-background-video {
    position: fixed;
    z-index: 0;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 50%;
    opacity: 0;
    background: #173f31;
    pointer-events: none;
    user-select: none;
    transition: opacity 180ms ease;
    will-change: opacity;
  }

  .mobile-background-video.is-playing {
    opacity: 1;
  }

  .photo-backdrop::before,
  .photo-backdrop::after {
    display: none !important;
    content: none !important;
    animation: none !important;
  }

  .photo-background {
    display: none;
  }
}
'''
write("public/mobile-woodland-loop.css", mobile_css)

page = read("src/page.js")
page = re.sub(
    r'\n    <video\n      id="mobile-background-video"[\s\S]*?</video>',
    "",
    page,
    count=1,
)
video_markup = f'''    <video
      id="mobile-background-video"
      class="mobile-background-video"
      src="{VIDEO_ROUTE}"
      poster="{POSTER_ASSET}"
      autoplay
      muted
      loop
      playsinline
      webkit-playsinline
      preload="auto"
      aria-hidden="true"
      tabindex="-1"
      disablepictureinpicture
      disableremoteplayback
    ></video>
'''
if "    </picture>\n    <canvas" not in page:
    raise SystemExit("could not find the mobile video insertion point in src/page.js")
page = page.replace(
    "    </picture>\n    <canvas",
    "    </picture>\n" + video_markup + "    <canvas",
    1,
)
page = replace_required(
    page,
    r'/mobile-quality\.js\?v=[A-Za-z0-9._-]+',
    f'/mobile-quality.js?v={VERSION}',
    "mobile video client cache version",
)
write("src/page.js", page)

use_script = r'''import { readFile, writeFile } from "node:fs/promises";

const MOBILE_ASSET = "__POSTER_ASSET__";
const POSTER_FILENAME = "__POSTER_FILE__";
const MOBILE_WIDTH = __WIDTH__;
const MOBILE_HEIGHT = __HEIGHT__;
const MOBILE_BYTES = __POSTER_BYTES__;
const GUIDE_VERSION = "__VERSION__";
const MOBILE_STYLE_VERSION = "__VERSION__";
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
    /mobile-woodland-loop\.css\?v=__VERSION_REGEX__/,
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
'''
use_script = (
    use_script.replace("__POSTER_ASSET__", POSTER_ASSET)
    .replace("__POSTER_FILE__", POSTER_FILE)
    .replace("__WIDTH__", str(WIDTH))
    .replace("__HEIGHT__", str(HEIGHT))
    .replace("__POSTER_BYTES__", str(poster_bytes))
    .replace("__VERSION__", VERSION)
    .replace("__VERSION_REGEX__", re.escape(VERSION).replace("\\-", "-"))
)
write("scripts/use-mobile-forest-stream.mjs", use_script)

responder = read("src/mobile-video-response.js")
responder = responder.replace(
    '"/media/mobile-forest-stream-video-v4-1080.mp4"',
    f'"{VIDEO_ROUTE}"',
)
responder = responder.replace(
    '"/scenes/mobile-forest-stream-video-v4-1080.mp4"',
    f'"{VIDEO_ASSET}"',
)
responder = replace_required(
    responder,
    r"export const MOBILE_VIDEO_BYTES = [\d_]+;",
    f"export const MOBILE_VIDEO_BYTES = {video_bytes:_};",
    "Worker video byte count",
)
responder = replace_required(
    responder,
    r"export const MOBILE_VIDEO_ETAG =\n  '\"[0-9a-f]+\"';",
    f"export const MOBILE_VIDEO_ETAG =\n  '\"{video_sha}\"';",
    "Worker video ETag",
)
write("src/mobile-video-response.js", responder)

headers = read("public/_headers")
headers = headers.replace(
    "/scenes/mobile-forest-stream-video-v4-1080.mp4",
    VIDEO_ASSET,
)
write("public/_headers", headers)

loading_test = read("test/mobile-background-loading.test.mjs")
loading_test = loading_test.replace(
    "mobile-forest-stream-video-v4-1080.mp4",
    VIDEO_FILE,
)
loading_test = loading_test.replace(
    "mobile-forest-stream-video-1080-v4",
    "mobile-forest-stream-video-v11-1536",
)
loading_test = loading_test.replace(
    r"/materialize\/mobile-forest-stream-video-v11-1536/",
    r"/expectedVideoSha256/",
)
loading_test = loading_test.replace(
    r"/const VIDEO_ASSET =[\s\S]*\/media\/mobile-forest-stream-video-v11-1536\.mp4/",
    r"/const VIDEO_ASSET =[\s\S]*\/media\/mobile-forest-stream-video-v11-1536\.mp4/",
)
loading_test = loading_test.replace(
    "  assert.ok(video.byteLength > 100_000);",
    f"  assert.equal(video.byteLength, {video_bytes});",
)
write("test/mobile-background-loading.test.mjs", loading_test)

workflow = read(".github/workflows/verify-mobile-video.yml")
workflow = workflow.replace(
    "mobile-forest-stream-video-v4-1080.mp4",
    VIDEO_FILE,
)
workflow = workflow.replace(
    "test \"$(wc -c < \"$video\")\" -eq 113613",
    f"test \"$(wc -c < \"$video\")\" -eq {video_bytes}",
)
file_marker = "          file \"$video\" | grep -Fq 'ISO Media, MP4'\n"
strict_decode = file_marker + f'''          command -v ffmpeg >/dev/null || {{
            sudo apt-get update -qq
            sudo apt-get install -y ffmpeg
          }}
          probe="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,pix_fmt,width,height -of default=nw=1 \"$video\")"
          grep -Fq 'codec_name=h264' <<<\"$probe\"
          grep -Fq 'profile=Main' <<<\"$probe\"
          grep -Fq 'pix_fmt=yuv420p' <<<\"$probe\"
          grep -Fq 'width={WIDTH}' <<<\"$probe\"
          grep -Fq 'height={HEIGHT}' <<<\"$probe\"
          ffmpeg -hide_banner -v error -xerror -err_detect explode \\
            -i \"$video\" -map 0:v:0 -f null -
'''
if "err_detect explode" not in workflow:
    if file_marker not in workflow:
        raise SystemExit("could not find the video validation marker in workflow")
    workflow = workflow.replace(file_marker, strict_decode, 1)
workflow = workflow.replace(
    "/media/mobile-forest-stream-video-v4-1080.mp4",
    VIDEO_ROUTE,
)
write(".github/workflows/verify-mobile-video.yml", workflow)

for obsolete in [
    root / ".github/workflows/diagnose-mobile-video-temporary.yml",
    root / ".github/workflows/import-valid-mobile-video.yml",
]:
    if obsolete.exists():
        obsolete.unlink()

obsolete_payload = root / "materialize/mobile-forest-stream-video-1080-v4"
if obsolete_payload.exists():
    shutil.rmtree(obsolete_payload)

obsolete_binary = root / "public/scenes/mobile-forest-stream-video-v4-1080.mp4"
if obsolete_binary.exists():
    obsolete_binary.unlink()

print(
    f"Prepared {VIDEO_FILE}: {WIDTH}x{HEIGHT}, {video_bytes} bytes, "
    f"sha256={video_sha}; poster={poster_bytes} bytes, sha256={poster_sha}"
)

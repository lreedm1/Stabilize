import { readdir, readFile, writeFile } from "node:fs/promises";

const VERSION = "20260813-mobile-performance-v32-1";
const VIDEO_ASSET = "/scenes/mobile-forest-stream-video-v12-720.mp4";
const POSTER_ASSET = "/scenes/mobile-forest-stream-v24-native-1080.webp";
const CLIENT_ASSET = "/mobile-background-v32.js";
const STYLE_ASSET = "/mobile-background-v32.css";
const FINALIZER = "node scripts/finalize-mobile-performance-v32.mjs";
const TEST_PATH = "test/mobile-performance-v32.test.mjs";
const RETIRED_TESTS = new Set([
  "test/mobile-background-v30.test.mjs",
  "test/mobile-video-handoff-v31.test.mjs",
]);
const VERIFY_TEMPLATE = "scripts/verify-mobile-video-v32.yml";
const VERIFY_WORKFLOW = ".github/workflows/verify-mobile-video.yml";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function replaceMarked(source, start, end, replacement) {
  const startIndex = source.indexOf(start);
  const endMarkerIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endMarkerIndex < 0) {
    throw new Error(`Missing marked block ${start} … ${end}`);
  }

  const lineStart = source.lastIndexOf("\n", startIndex) + 1;
  const endLineBreak = source.indexOf("\n", endMarkerIndex + end.length);
  const lineEnd = endLineBreak < 0 ? source.length : endLineBreak + 1;
  return (
    source.slice(0, lineStart) +
    `${replacement.trimEnd()}\n` +
    source.slice(lineEnd)
  );
}

const headStart = "<!-- mobile-background-v30-head-start -->";
const headEnd = "<!-- mobile-background-v30-head-end -->";
const headBlock = `    ${headStart}
    <!-- v32 keeps first paint static and lets the browser stream a small,
         hardware-decodable MP4 directly from Cloudflare's asset cache. -->
    <link
      rel="preload"
      as="image"
      href="${POSTER_ASSET}?v=${VERSION}"
      imagesrcset="${POSTER_ASSET}?v=${VERSION} 2160w"
      imagesizes="100vw"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />
    <link
      rel="preload"
      as="video"
      href="${VIDEO_ASSET}?v=${VERSION}"
      media="(max-width: 980px) and (orientation: portrait)"
      type="video/mp4"
      fetchpriority="high"
    />
    <link rel="stylesheet" href="${STYLE_ASSET}?v=${VERSION}" />
    ${headEnd}`;

const mediaStart = "<!-- mobile-background-v30-media-start -->";
const mediaEnd = "<!-- mobile-background-v30-media-end -->";
const mediaBlock = `    ${mediaStart}
    <video
      id="mobile-background-video"
      class="mobile-background-video"
      autoplay
      muted
      loop
      playsinline
      webkit-playsinline
      preload="auto"
      poster="${POSTER_ASSET}?v=${VERSION}"
      aria-hidden="true"
      tabindex="-1"
      disablepictureinpicture
      disableremoteplayback
      x-webkit-airplay="deny"
    >
      <source
        src="${VIDEO_ASSET}?v=${VERSION}"
        type="video/mp4"
      />
    </video>
    <script src="${CLIENT_ASSET}?v=${VERSION}"></script>
    ${mediaEnd}`;

await update("src/page.js", (source) => {
  let next = replaceMarked(source, headStart, headEnd, headBlock);
  next = replaceMarked(next, mediaStart, mediaEnd, mediaBlock);

  const required = [
    `${VIDEO_ASSET}?v=${VERSION}`,
    `${POSTER_ASSET}?v=${VERSION}`,
    `${CLIENT_ASSET}?v=${VERSION}`,
    `${STYLE_ASSET}?v=${VERSION}`,
    'id="mobile-background-video"',
    'preload="auto"',
  ];
  for (const value of required) {
    if (!next.includes(value)) {
      throw new Error(`The v32 page is missing ${value}.`);
    }
  }

  if (next.split('id="mobile-background-video"').length - 1 !== 1) {
    throw new Error("Expected exactly one mobile background video.");
  }
  for (const retired of [
    "/mobile-background/runtime?v=",
    "/mobile-background/styles?v=",
    "/mobile-video-handoff-v31.js?v=",
    'id="mobile-background-v30"',
    "mobile-forest-stream-full-atlas-v29-1080.webp",
    "/media/mobile-forest-stream-video-v24-native-1080.mp4",
  ]) {
    if (next.includes(retired)) {
      throw new Error(`The v32 page still references retired runtime ${retired}.`);
    }
  }
  return next;
});

await update("public/_headers", (source) => {
  const start = "# mobile-performance-v32-start";
  const end = "# mobile-performance-v32-end";
  const block = `${start}
${CLIENT_ASSET}
  Content-Type: text/javascript; charset=utf-8
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

${STYLE_ASSET}
  Content-Type: text/css; charset=utf-8
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
${end}`;

  if (source.includes(start) && source.includes(end)) {
    return source.replace(
      new RegExp(`${start}[\\s\\S]*?${end}`, "g"),
      block,
    );
  }
  return `${source.trimEnd()}\n\n${block}\n`;
});

let canonicalPolicy = "";
await update("package.json", (source) => {
  const data = JSON.parse(source);
  const policy = String(data.scripts?.["apply:prompt-policy"] || "");
  if (!policy) throw new Error("package.json is missing apply:prompt-policy.");

  const commands = policy
    .split(" && ")
    .filter(Boolean)
    .filter((command) => command !== FINALIZER);
  commands.push(FINALIZER);
  canonicalPolicy = commands.join(" && ");
  data.scripts["apply:prompt-policy"] = canonicalPolicy;

  const nodeTests = String(data.scripts?.["test:node"] || "");
  const tokens = nodeTests
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !RETIRED_TESTS.has(token));
  if (!tokens.includes(TEST_PATH)) tokens.push(TEST_PATH);
  data.scripts["test:node"] = tokens.join(" ");

  return `${JSON.stringify(data, null, 2)}\n`;
});

const verifyTemplate = await readFile(VERIFY_TEMPLATE, "utf8");
await writeFile(VERIFY_WORKFLOW, verifyTemplate, "utf8");

const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/finalize-(?:native-selected-mobile-v24-regressions|mobile-video-handoff-v31|mobile-performance-v32)\.mjs"/g;
const previousTail = "finalize-mobile-video-handoff-v31\\.mjs$/";
const canonicalTail =
  "finalize-mobile-video-handoff-v31\\.mjs && node scripts\\/finalize-mobile-performance-v32\\.mjs$/";
const testNames = (await readdir("test"))
  .filter((name) => name.endsWith(".mjs"))
  .sort();

for (const name of testNames) {
  await update(`test/${name}`, (source) =>
    source
      .replace(commandLiteralPattern, JSON.stringify(canonicalPolicy))
      .replaceAll(previousTail, canonicalTail),
  );
}

for (const path of [
  "public/mobile-background-v32.js",
  "public/mobile-background-v32.css",
  TEST_PATH,
]) {
  const source = await readFile(path, "utf8");
  if (!source.includes(VERSION)) {
    throw new Error(`${path} is not pinned to ${VERSION}.`);
  }
}

console.log(
  `Finalized ${VERSION}: 1.3 MB direct static video, poster-first loading, and no canvas fallback.`,
);

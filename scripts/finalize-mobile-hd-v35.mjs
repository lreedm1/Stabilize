import { readdir, readFile, writeFile } from "node:fs/promises";

const metadata = JSON.parse(
  await readFile(new URL("./mobile-hd-v35.json", import.meta.url), "utf8"),
);

const VERSION = metadata.version;
const HEVC_ASSET = metadata.hevcAsset;
const H264_ASSET = metadata.h264Asset;
const WIDTH = metadata.width;
const HEIGHT = metadata.height;
const FPS = metadata.fps;
const QUALITY = metadata.quality;
const HANDOFF_CLIENT = "/mobile-video-handoff-v31.js";

const FINALIZER = "node scripts/finalize-mobile-hd-v35.mjs";
const STATIC_FAVICON_FINALIZER = "node scripts/embed-favicon-fallback.mjs";
const TEST_PATH = "test/mobile-hd-v35.test.mjs";
const RETIRED_TEST_PATHS = new Set([
  "test/mobile-smooth-v32.test.mjs",
  "test/mobile-hevc-v34.test.mjs",
]);
const VERIFY_TEMPLATE_PATH = "scripts/verify-mobile-hd-v35.yml";
const VERIFY_WORKFLOW_PATH = ".github/workflows/verify-mobile-video.yml";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function requireReplace(source, pattern, replacement, label) {
  pattern.lastIndex = 0;
  if (!pattern.test(source)) throw new Error(`Could not find ${label}.`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMarked(source, start, end, block) {
  const normalized = `${block.trimEnd()}\n`;
  if (!source.includes(start) && !source.includes(end)) {
    return `${source.trimEnd()}\n\n${normalized}`;
  }
  if (!source.includes(start) || !source.includes(end)) {
    throw new Error(`Incomplete marked block ${start}.`);
  }
  const pattern = new RegExp(
    `${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`,
  );
  return source.replace(pattern, normalized);
}

await update("src/page.js", (source) => {
  let next = source
    .replace(
      /^[ \t]*<script[^>]*\/mobile-background\/runtime\?v=[^>]*><\/script>[ \t]*\n?/gm,
      "",
    )
    .replace(
      /^[ \t]*<script[^>]*mobile-video-handoff-v31\.js[^>]*><\/script>[ \t]*\n?/gm,
      "",
    );

  const videoPattern = /<video\n\s+id="mobile-background-video"[\s\S]*?<\/video>/;
  const match = next.match(videoPattern);
  if (!match) throw new Error("Could not find the mobile background video.");
  const poster =
    match[0].match(/poster="([^"]+)"/)?.[1] ||
    "/scenes/mobile-forest-stream-v24-native-1080.webp";

  const video = `<video
      id="mobile-background-video"
      class="mobile-background-video"
      autoplay
      muted
      loop
      playsinline
      webkit-playsinline
      preload="auto"
      poster="${poster}"
      aria-hidden="true"
      tabindex="-1"
      disablepictureinpicture
      disableremoteplayback
      x-webkit-airplay="deny"
    >
      <source
        data-codec="hevc"
        src="${HEVC_ASSET}?v=${VERSION}"
        type='video/mp4; codecs="hvc1"'
      />
      <source
        data-codec="h264"
        src="${H264_ASSET}?v=${VERSION}"
        type='video/mp4; codecs="avc1.640028"'
      />
    </video>`;
  next = next.replace(videoPattern, video);

  const canvasPattern = /(<canvas\n\s+id="mobile-background-v30"[\s\S]*?<\/canvas>)/;
  if (!canvasPattern.test(next)) {
    throw new Error("Could not find the mobile fallback canvas.");
  }
  canvasPattern.lastIndex = 0;
  next = next.replace(
    canvasPattern,
    `$1\n    <script src="${HANDOFF_CLIENT}?v=${VERSION}"></script>`,
  );

  const videoBlock = next.match(videoPattern)?.[0] || "";
  const hevcReference = `${HEVC_ASSET}?v=${VERSION}`;
  const h264Reference = `${H264_ASSET}?v=${VERSION}`;
  const hevcIndex = videoBlock.indexOf(hevcReference);
  const h264Index = videoBlock.indexOf(h264Reference);
  if (hevcIndex < 0 || h264Index < 0 || hevcIndex >= h264Index) {
    throw new Error("1080p HEVC must be the first parser-visible video source.");
  }
  if (videoBlock.includes("/media/")) {
    throw new Error("The parser-visible video still uses the buffering Worker route.");
  }
  if (!videoBlock.includes('codecs="hvc1"')) {
    throw new Error("The HEVC source is missing its hvc1 codec declaration.");
  }
  if (!videoBlock.includes('codecs="avc1.640028"')) {
    throw new Error("The H.264 High fallback is missing its codec declaration.");
  }
  if (next.split(HANDOFF_CLIENT).length - 1 !== 1) {
    throw new Error("Expected exactly one mobile handoff client.");
  }
  return next;
});

await update("public/mobile-video-handoff-v31.js", (source) => {
  let next = requireReplace(
    source,
    /const VERSION = "[^"]+";/,
    `const VERSION = "${VERSION}";`,
    "the mobile handoff version",
  );

  const constantsPattern =
    /  const VIDEO_ASSET =[\s\S]*?  const LEGACY_QUALITY = "[^"]+";/;
  const constants = `  const HEVC_ASSET =
    \`${HEVC_ASSET}?v=\${VERSION}\`;
  const H264_ASSET =
    \`${H264_ASSET}?v=\${VERSION}\`;
  const QUALITY = "${QUALITY}";`;
  next = requireReplace(
    next,
    constantsPattern,
    constants,
    "the mobile media constants",
  );

  const configurePattern =
    /  function configureVideo\(\) \{[\s\S]*?\n  \}\n\n  function keepFallbackVisible/;
  const configure = `  function configureVideo() {
    video.autoplay = true;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.controls = false;
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;

    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("preload", "auto");
    video.setAttribute("x-webkit-airplay", "deny");
    video.removeAttribute("controls");

    // mobile-hd-v35-parser-source-static
    // The parser already owns both final source URLs. Do not rewrite source.src,
    // reorder children, or call load() immediately before play(); each of those
    // resets WebKit's media selection and can turn eligible muted autoplay into
    // a user-gesture-only recovery path.
    const hevcSource = video.querySelector('source[data-codec="hevc"]');
    const h264Source = video.querySelector('source[data-codec="h264"]');
    const parserSourcesReady =
      hevcSource instanceof HTMLSourceElement &&
      h264Source instanceof HTMLSourceElement &&
      hevcSource.getAttribute("src") === HEVC_ASSET &&
      h264Source.getAttribute("src") === H264_ASSET;
    if (!parserSourcesReady) setState("fallback", "parser-source-mismatch");
  }

  function keepFallbackVisible`;
  next = requireReplace(
    next,
    configurePattern,
    configure,
    "the static parser-owned video configuration",
  );

  next = next
    .replace(/video\.videoWidth < 700/g, `video.videoWidth < ${WIDTH - 80}`)
    .replace(/video\.videoHeight < 1240/g, `video.videoHeight < ${HEIGHT - 120}`);

  const qualityPattern =
    /\/\* mobile-hevc-v34-quality-start \*\/[\s\S]*?\/\* mobile-hevc-v34-quality-end \*\//;
  const qualityBlock = `/* mobile-hd-v35-quality-start */
    root.dataset.mobileBackgroundV30 = "video";
    const selectedCodec = video.currentSrc.includes(
      HEVC_ASSET.split("?")[0],
    )
      ? "hevc"
      : "h264";
    root.dataset.mobileBackgroundV30Codec = selectedCodec;
    root.dataset.mobileBackgroundV30Quality = QUALITY;
    setState(
      "video",
      \`\${selectedCodec}:\${video.videoWidth}x\${video.videoHeight}@${FPS}\`,
    );
    /* mobile-hd-v35-quality-end */`;
  next = requireReplace(
    next,
    qualityPattern,
    qualityBlock,
    "the selected codec quality state",
  );

  const configureFunction =
    next.match(
      /function configureVideo\(\) \{[\s\S]*?\n  \}\n\n  function keepFallbackVisible/,
    )?.[0] || "";
  for (const forbidden of [
    "video.load(",
    "ensureSource(",
    ".append(",
    "insertBefore(",
    ".src =",
  ]) {
    if (configureFunction.includes(forbidden)) {
      throw new Error(`The initial autoplay path still resets media via ${forbidden}.`);
    }
  }

  for (const expected of [
    VERSION,
    HEVC_ASSET,
    H264_ASSET,
    QUALITY,
    "mobile-hd-v35-parser-source-static",
    "mobile-hd-v35-quality-start",
    "video.play()",
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`The HD autoplay handoff client is missing ${expected}.`);
    }
  }
  return next;
});

const headersStart = "# mobile-hd-v35-start";
const headersEnd = "# mobile-hd-v35-end";
const headersBlock = `${headersStart}
${HEVC_ASSET}
  Content-Type: video/mp4
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

${H264_ASSET}
  Content-Type: video/mp4
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
${headersEnd}`;
await update("public/_headers", (source) =>
  replaceMarked(source, headersStart, headersEnd, headersBlock),
);

let canonicalPolicy = "";
await update("package.json", (source) => {
  const data = JSON.parse(source);
  const policy = String(data.scripts?.["apply:prompt-policy"] || "");
  if (!policy) throw new Error("package.json is missing apply:prompt-policy.");
  const commands = policy
    .split(" && ")
    .filter(
      (command) =>
        command !== FINALIZER && command !== STATIC_FAVICON_FINALIZER,
    );
  commands.push(FINALIZER, STATIC_FAVICON_FINALIZER);
  canonicalPolicy = commands.join(" && ");
  data.scripts["apply:prompt-policy"] = canonicalPolicy;

  const nodeTests = String(data.scripts?.["test:node"] || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (token) => token !== TEST_PATH && !RETIRED_TEST_PATHS.has(token),
    );
  nodeTests.push(TEST_PATH);
  data.scripts["test:node"] = nodeTests.join(" ");
  return `${JSON.stringify(data, null, 2)}\n`;
});

const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/embed-favicon-fallback\.mjs"/g;
const correctEscapedTail =
  "finalize-mobile-smooth-v32\\.mjs && node scripts\\/finalize-mobile-hevc-v34\\.mjs && node scripts\\/finalize-mobile-hd-v35\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/";
const staleEscapedTails = [
  "finalize-mobile-smooth-v32\\.mjs && node scripts\\/finalize-mobile-hevc-v34\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/",
  "finalize-mobile-hevc-v34\\.mjs && node scripts\\/finalize-mobile-hd-v35\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/",
  "finalize-mobile-hd-v35\\.mjs && node scripts\\/finalize-mobile-hevc-v34\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/",
];
const testNames = (await readdir("test"))
  .filter((name) => name.endsWith(".mjs"))
  .sort();
for (const name of testNames) {
  await update(`test/${name}`, (source) => {
    let next = source.replace(commandLiteralPattern, JSON.stringify(canonicalPolicy));
    for (const stale of staleEscapedTails) {
      next = next.split(stale).join(correctEscapedTail);
    }
    return next;
  });
}

const verifyTemplate = await readFile(VERIFY_TEMPLATE_PATH, "utf8");
await writeFile(VERIFY_WORKFLOW_PATH, verifyTemplate, "utf8");

for (const expected of [
  VERSION,
  HEVC_ASSET,
  H264_ASSET,
  String(metadata.hevcBytes),
  metadata.hevcSha256,
  String(metadata.h264Bytes),
  metadata.h264Sha256,
  String(WIDTH),
  String(HEIGHT),
  String(FPS),
  QUALITY,
]) {
  if (!JSON.stringify(metadata).includes(expected)) {
    throw new Error(`HD mobile metadata is missing ${expected}.`);
  }
}

console.log(
  `Finalized ${VERSION}: ${WIDTH}x${HEIGHT} ${FPS} fps, hvc1 HEVC first, 1080p H.264 fallback second, direct static delivery, and no initial media reset before autoplay.`,
);

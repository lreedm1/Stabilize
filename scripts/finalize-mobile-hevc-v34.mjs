import { readdir, readFile, writeFile } from "node:fs/promises";

const metadata = JSON.parse(
  await readFile(new URL("./mobile-hevc-v34.json", import.meta.url), "utf8"),
);

const VERSION = metadata.version;
const HEVC_ASSET = metadata.hevcAsset;
const H264_ASSET = metadata.h264Asset;
const HEVC_BYTES = metadata.videoBytes;
const HEVC_SHA256 = metadata.videoSha256;
const WIDTH = metadata.width;
const HEIGHT = metadata.height;
const QUALITY = metadata.quality;
const HANDOFF_CLIENT = "/mobile-video-handoff-v31.js";
const COMPATIBILITY_VIDEO_ROUTE =
  "/media/mobile-forest-stream-video-v12-720.mp4";

const FINALIZER = "node scripts/finalize-mobile-hevc-v34.mjs";
const STATIC_FAVICON_FINALIZER = "node scripts/embed-favicon-fallback.mjs";
const TEST_PATH = "test/mobile-hevc-v34.test.mjs";
const RETIRED_TEST_PATH = "test/mobile-smooth-v32.test.mjs";
const VERIFY_TEMPLATE_PATH = "scripts/verify-mobile-hevc-v34.yml";
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
        type='video/mp4; codecs="avc1.42E020"'
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
  const hevcIndex = videoBlock.indexOf(`${HEVC_ASSET}?v=${VERSION}`);
  const h264Index = videoBlock.indexOf(`${H264_ASSET}?v=${VERSION}`);
  if (hevcIndex < 0 || h264Index < 0 || hevcIndex >= h264Index) {
    throw new Error("HEVC must be the first parser-visible video source.");
  }
  if (videoBlock.includes("/media/")) {
    throw new Error("The parser-visible video still uses the buffering Worker route.");
  }
  if (!videoBlock.includes('codecs="hvc1"')) {
    throw new Error("The HEVC source is missing its hvc1 codec declaration.");
  }
  if (!videoBlock.includes('codecs="avc1.42E020"')) {
    throw new Error("The H.264 fallback is missing its codec declaration.");
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
    /const VIDEO_ASSET =\n\s+`[^`]+`;(?:\n\s*const HEVC_ASSET =\n\s+`[^`]+`;\n\s*const H264_ASSET =\n\s+`[^`]+`;\n\s*const LEGACY_QUALITY = "[^"]+";)?/;
  const constants = `const VIDEO_ASSET =
    \`${COMPATIBILITY_VIDEO_ROUTE}?v=\${VERSION}\`;
  const HEVC_ASSET =
    \`${HEVC_ASSET}?v=\${VERSION}\`;
  const H264_ASSET =
    \`${H264_ASSET}?v=\${VERSION}\`;
  const LEGACY_QUALITY = "native-video-720x1280-60fps";`;
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
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;

    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "true");
    video.setAttribute("preload", "auto");
    video.setAttribute("x-webkit-airplay", "deny");

    let changed = false;
    function ensureSource(codec, asset, type) {
      let source = video.querySelector(\`source[data-codec="\${codec}"]\`);
      if (!(source instanceof HTMLSourceElement)) {
        source = document.createElement("source");
        source.dataset.codec = codec;
        video.append(source);
        changed = true;
      }
      const expected = new URL(asset, location.href).href;
      if (source.src !== expected) {
        source.src = asset;
        changed = true;
      }
      if (source.type !== type) {
        source.type = type;
        changed = true;
      }
      return source;
    }

    const hevc = ensureSource("hevc", HEVC_ASSET, 'video/mp4; codecs="hvc1"');
    const h264 = ensureSource("h264", H264_ASSET, 'video/mp4; codecs="avc1.42E020"');
    if (video.firstElementChild !== hevc) {
      video.insertBefore(hevc, video.firstElementChild);
      changed = true;
    }
    if (hevc.nextElementSibling !== h264) {
      video.insertBefore(h264, hevc.nextElementSibling);
      changed = true;
    }
    if (changed || !video.currentSrc) video.load();
  }

  function keepFallbackVisible`;
  next = requireReplace(
    next,
    configurePattern,
    configure,
    "the multi-codec video configuration",
  );

  const qualityPattern =
    /(?:\/\* mobile-hevc-v34-quality-start \*\/[\s\S]*?\/\* mobile-hevc-v34-quality-end \*\/|root\.dataset\.mobileBackgroundV30 = "video";\n\s+root\.dataset\.mobileBackgroundV30Quality = "[^"]+";\n\s+setState\("video", `\$\{video\.videoWidth\}x\$\{video\.videoHeight\}`\);)/;
  const qualityBlock = `/* mobile-hevc-v34-quality-start */
    root.dataset.mobileBackgroundV30 = "video";
    const selectedCodec = video.currentSrc.includes(
      "mobile-forest-stream-video-v34-hevc-720.mp4",
    )
      ? "hevc"
      : "h264";
    root.dataset.mobileBackgroundV30Codec = selectedCodec;
    root.dataset.mobileBackgroundV30Quality =
      selectedCodec === "hevc" ? "${QUALITY}" : LEGACY_QUALITY;
    setState(
      "video",
      \`\${selectedCodec}:\${video.videoWidth}x\${video.videoHeight}\`,
    );
    /* mobile-hevc-v34-quality-end */`;
  next = requireReplace(
    next,
    qualityPattern,
    qualityBlock,
    "the selected codec quality state",
  );

  for (const expected of [
    VERSION,
    HEVC_ASSET,
    H264_ASSET,
    'source[data-codec="${codec}"]',
    'ensureSource("hevc"',
    'ensureSource("h264"',
    QUALITY,
    "LEGACY_QUALITY",
    "mobile-hevc-v34-quality-start",
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`The HEVC handoff client is missing ${expected}.`);
    }
  }
  const configureFunction =
    next.match(
      /function configureVideo\(\) \{[\s\S]*?\n  \}\n\n  function keepFallbackVisible/,
    )?.[0] || "";
  if (configureFunction.includes("VIDEO_ASSET")) {
    throw new Error("The live configuration still uses the Worker compatibility route.");
  }
  return next;
});

const headersStart = "# mobile-hevc-v34-start";
const headersEnd = "# mobile-hevc-v34-end";
const headersBlock = `${headersStart}
${HEVC_ASSET}
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
    .filter((token) => token !== TEST_PATH && token !== RETIRED_TEST_PATH);
  nodeTests.push(TEST_PATH);
  data.scripts["test:node"] = nodeTests.join(" ");
  return `${JSON.stringify(data, null, 2)}\n`;
});

const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/embed-favicon-fallback\.mjs"/g;
const correctEscapedTail =
  "finalize-mobile-smooth-v32\\.mjs && node scripts\\/finalize-mobile-hevc-v34\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/";
const staleEscapedTails = [
  "finalize-mobile-smooth-v32\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/",
  "finalize-mobile-hevc-v34\\.mjs && node scripts\\/finalize-mobile-smooth-v32\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/",
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
  HEVC_ASSET,
  H264_ASSET,
  String(HEVC_BYTES),
  HEVC_SHA256,
]) {
  if (!JSON.stringify(metadata).includes(expected)) {
    throw new Error(`HEVC metadata is missing ${expected}.`);
  }
}

console.log(
  `Finalized ${VERSION}: ${WIDTH}x${HEIGHT} 60 fps hvc1 HEVC first, direct static H.264 fallback second, and no Worker buffering in the parser-visible sources.`,
);

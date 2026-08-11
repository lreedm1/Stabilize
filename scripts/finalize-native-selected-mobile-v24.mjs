import { readFile, writeFile } from "node:fs/promises";

const metadata = JSON.parse(
  await readFile(
    new URL("./native-selected-mobile-video-v24.json", import.meta.url),
    "utf8",
  ),
);

const VERSION = metadata.version;
const VIDEO_ROUTE = metadata.videoRoute;
const VIDEO_ASSET = metadata.videoAsset;
const POSTER_ASSET = metadata.posterAsset;
const VIDEO_BYTES = metadata.videoBytes;
const VIDEO_SHA256 = metadata.videoSha256;
const POSTER_BYTES = metadata.posterBytes;
const POSTER_SHA256 = metadata.posterSha256;
const VIDEO_WIDTH = metadata.width;
const VIDEO_HEIGHT = metadata.height;
const VIDEO_FPS = metadata.fps;
const QUALITY_LABEL = "native-source-1080x1920";
const SOURCE_LABEL = "selected-forest-stream-native-source";
const LOADING_LABEL = "video-loading-native-source";
const FINALIZER_COMMAND =
  "node scripts/finalize-native-selected-mobile-v24.mjs";
const STATIC_PAGES = [
  "public/about.html",
  "public/floor-first.html",
  "public/how-it-works.html",
  "public/privacy.html",
  "public/safety.html",
  "public/support.html",
  "public/sustainability.html",
];

const OLD_VIDEO_ROUTE =
  "/media/mobile-forest-stream-video-v23-ai-2160.mp4";
const OLD_VIDEO_ASSET =
  "/scenes/mobile-forest-stream-video-v23-ai-2160.mp4";
const OLD_POSTER_ASSET =
  "/scenes/mobile-forest-stream-v23-ai-2160.webp";
const OLD_VERSION = "20260810-ai-enhanced-mobile-4k-v23-1";
const OLD_VIDEO_BYTES = 20_957_716;
const OLD_VIDEO_SHA256 =
  "be5995746c6137f9f63121eead3883ce1469279563738e1ccbd813abf9d7becf";
const OLD_POSTER_SHA256 =
  "a2455ef18233b4085691a004629a793bbbce053ca43938f3dcd7a62ee469ca63";
const LEGACY_POSTER_ASSET =
  "/scenes/mobile-forest-stream-v14-retina-2160.webp";

function grouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "_");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
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

function replaceKnownMediaReferences(source) {
  const replacements = [
    [OLD_VIDEO_ROUTE, VIDEO_ROUTE],
    [OLD_VIDEO_ASSET, VIDEO_ASSET],
    [OLD_POSTER_ASSET, POSTER_ASSET],
    [OLD_VERSION, VERSION],
    ["mobile-forest-stream-video-v23-ai-2160.mp4", "mobile-forest-stream-video-v24-native-1080.mp4"],
    ["mobile-forest-stream-v23-ai-2160.webp", "mobile-forest-stream-v24-native-1080.webp"],
    ["mobile-forest-stream-video-v23-ai-2160\\.mp4", "mobile-forest-stream-video-v24-native-1080\\.mp4"],
    ["mobile-forest-stream-v23-ai-2160\\.webp", "mobile-forest-stream-v24-native-1080\\.webp"],
    ["ai-enhanced-2160x3840", QUALITY_LABEL],
    ["selected-forest-stream-ai-enhanced", SOURCE_LABEL],
    ["video-loading-ai-enhanced", LOADING_LABEL],
    [String(OLD_VIDEO_BYTES), String(VIDEO_BYTES)],
    [grouped(OLD_VIDEO_BYTES), grouped(VIDEO_BYTES)],
    [OLD_VIDEO_SHA256, VIDEO_SHA256],
    [OLD_POSTER_SHA256, POSTER_SHA256],
  ];
  let next = source;
  for (const [before, after] of replacements) {
    next = next.split(before).join(after);
  }
  return next;
}

await update("src/mobile-video-response.js", (source) => {
  const next = source
    .replace(
      /export const MOBILE_VIDEO_ROUTE =\n\s+"[^"]+";/,
      `export const MOBILE_VIDEO_ROUTE =\n  "${VIDEO_ROUTE}";`,
    )
    .replace(
      /export const MOBILE_VIDEO_ASSET_PATH =\n\s+"[^"]+";/,
      `export const MOBILE_VIDEO_ASSET_PATH =\n  "${VIDEO_ASSET}";`,
    )
    .replace(
      /export const MOBILE_VIDEO_BYTES = [\d_]+;/,
      `export const MOBILE_VIDEO_BYTES = ${grouped(VIDEO_BYTES)};`,
    )
    .replace(
      /export const MOBILE_VIDEO_ETAG =\n\s+'"[0-9a-f]+"';/,
      `export const MOBILE_VIDEO_ETAG =\n  '"${VIDEO_SHA256}"';`,
    );

  for (const expected of [
    VIDEO_ROUTE,
    VIDEO_ASSET,
    grouped(VIDEO_BYTES),
    VIDEO_SHA256,
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`The native video responder is missing ${expected}.`);
    }
  }
  return next;
});

await update("public/mobile-quality.js", (source) => {
  let next = source
    .replace(
      /const VIDEO_ASSET =\n\s+"[^"]+";/,
      `const VIDEO_ASSET =\n  "${VIDEO_ROUTE}";`,
    )
    .replace(
      /const POSTER_ASSET =\n\s+"[^"]+";/,
      `const POSTER_ASSET =\n  "${POSTER_ASSET}";`,
    );
  next = replaceKnownMediaReferences(next)
    .replaceAll("selected-forest-stream", SOURCE_LABEL)
    .replaceAll("4k-2160x3840", QUALITY_LABEL)
    .replaceAll("video-loading-4k", LOADING_LABEL);

  for (const expected of [VIDEO_ROUTE, POSTER_ASSET, QUALITY_LABEL]) {
    if (!next.includes(expected)) {
      throw new Error(`The native mobile client is missing ${expected}.`);
    }
  }
  return next;
});

const videoPreloadStart =
  "<!-- selected-mobile-4k-video-v22-preload-start -->";
const videoPreloadEnd =
  "<!-- selected-mobile-4k-video-v22-preload-end -->";
const videoPreloadBlock = `    ${videoPreloadStart}
    <link
      rel="preload"
      as="video"
      href="${VIDEO_ROUTE}"
      media="(max-width: 980px) and (orientation: portrait)"
      type="video/mp4"
    />
    ${videoPreloadEnd}`;

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
      poster="${POSTER_ASSET}"
      aria-hidden="true"
      tabindex="-1"
    >
      <source src="${VIDEO_ROUTE}" type="video/mp4" />
    </video>
    ${videoEnd}`;

const videoScriptStart =
  "<!-- selected-mobile-4k-video-v22-script-start -->";
const videoScriptEnd =
  "<!-- selected-mobile-4k-video-v22-script-end -->";
const videoScriptBlock = `    ${videoScriptStart}
    <script type="module" src="/mobile-quality.js?v=${VERSION}"></script>
    ${videoScriptEnd}`;

await update("src/page.js", (source) => {
  let next = replaceKnownMediaReferences(source)
    .split(LEGACY_POSTER_ASSET)
    .join(POSTER_ASSET)
    .replaceAll(`${POSTER_ASSET} 2160w`, `${POSTER_ASSET} ${VIDEO_WIDTH}w`)
    .replaceAll(`${POSTER_ASSET} 3840w`, `${POSTER_ASSET} ${VIDEO_WIDTH}w`)
    .replace(
      /mobile-woodland-loop\.css\?v=[^"]+/,
      `mobile-woodland-loop.css?v=${VERSION}`,
    );

  if (next.includes(videoPreloadStart) && next.includes(videoPreloadEnd)) {
    next = replaceMarked(
      next,
      videoPreloadStart,
      videoPreloadEnd,
      videoPreloadBlock,
    );
  } else {
    const anchor = "    <!-- mobile-motion-canvas-v18-preloads-start -->";
    if (!next.includes(anchor)) {
      throw new Error("Could not find the mobile media preload insertion point.");
    }
    next = next.replace(anchor, `${videoPreloadBlock}\n${anchor}`);
  }

  if (next.includes(videoStart) && next.includes(videoEnd)) {
    next = replaceMarked(next, videoStart, videoEnd, videoBlock);
  } else {
    const anchor = "    <canvas\n      id=\"photo-background\"";
    if (!next.includes(anchor)) {
      throw new Error("Could not find the native video insertion point.");
    }
    next = next.replace(anchor, `${videoBlock}\n${anchor}`);
  }

  if (next.includes(videoScriptStart) && next.includes(videoScriptEnd)) {
    next = replaceMarked(
      next,
      videoScriptStart,
      videoScriptEnd,
      videoScriptBlock,
    );
  } else {
    const anchor = "  </body>";
    if (!next.includes(anchor)) {
      throw new Error("Could not find the native video script insertion point.");
    }
    next = next.replace(anchor, `${videoScriptBlock}\n${anchor}`);
  }

  const posterReferences =
    next.split(`${POSTER_ASSET} ${VIDEO_WIDTH}w`).length - 1;
  if (posterReferences !== 2) {
    throw new Error(
      `Expected two ${VIDEO_WIDTH}w native poster references, found ${posterReferences}.`,
    );
  }
  if (next.split(`href="${VIDEO_ROUTE}"`).length - 1 !== 1) {
    throw new Error("Expected one native video preload.");
  }
  if (next.split(`src="${VIDEO_ROUTE}"`).length - 1 !== 1) {
    throw new Error("Expected one native video source.");
  }
  if (next.split(`poster="${POSTER_ASSET}"`).length - 1 !== 1) {
    throw new Error("Expected one native video poster.");
  }
  if (next.split("mobile-quality.js").length - 1 !== 1) {
    throw new Error("Expected one native video client script.");
  }
  return next;
});

const styleStart = "/* selected-mobile-4k-video-v22-start */";
const styleEnd = "/* selected-mobile-4k-video-v22-end */";
const styleBlock = `${styleStart}
.mobile-background-video {
  display: none !important;
}

@media (max-width: 980px) and (orientation: portrait) {
  .mobile-background-video {
    position: fixed;
    z-index: 0;
    inset: 0;
    display: block !important;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 50%;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    user-select: none;
    transform: translate3d(0, 0, 0);
    -webkit-transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    contain: strict;
    will-change: opacity;
  }

  html[data-mobile-background="video-playing"]
    .mobile-background-video.is-playing,
  .mobile-background-video.is-playing {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  .mobile-background-video.is-autoplay-blocked,
  .mobile-background-video.is-failed {
    visibility: hidden !important;
    opacity: 0 !important;
  }
}
${styleEnd}`;
await update("public/mobile-woodland-loop.css", (source) =>
  replaceMarked(source, styleStart, styleEnd, styleBlock, true),
);

await update("public/guides.css", (source) =>
  replaceKnownMediaReferences(source)
    .split(LEGACY_POSTER_ASSET)
    .join(POSTER_ASSET),
);

for (const path of STATIC_PAGES) {
  await update(path, (source) =>
    source.replace(
      /href="\/guides\.css(?:\?v=[^"]*)?"/g,
      `href="/guides.css?v=${VERSION}"`,
    ),
  );
}

const headersStart = "# native-selected-mobile-v24-start";
const headersEnd = "# native-selected-mobile-v24-end";
const headersBlock = `${headersStart}
${VIDEO_ASSET}
  Content-Type: video/mp4
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

${POSTER_ASSET}
  Content-Type: image/webp
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
${headersEnd}`;
await update("public/_headers", (source) =>
  replaceMarked(source, headersStart, headersEnd, headersBlock, true),
);

const validationStart =
  "// native-selected-mobile-v24-validation-start";
const validationEnd =
  "// native-selected-mobile-v24-validation-end";
const validationBlock = `${validationStart}
const nativeV24VideoPath = "public${VIDEO_ASSET}";
const nativeV24VideoExpectedBytes = ${VIDEO_BYTES};
const nativeV24VideoExpectedSha256 = "${VIDEO_SHA256}";
const nativeV24PosterPath = "public${POSTER_ASSET}";
const nativeV24PosterExpectedBytes = ${POSTER_BYTES};
const nativeV24PosterExpectedSha256 = "${POSTER_SHA256}";

const nativeV24Video = await readFile(nativeV24VideoPath);
if (nativeV24Video.byteLength !== nativeV24VideoExpectedBytes) {
  throw new Error(
    \`Unexpected native mobile video size: \${nativeV24Video.byteLength}; expected \${nativeV24VideoExpectedBytes}\`,
  );
}
const nativeV24VideoSha256 = createHash("sha256")
  .update(nativeV24Video)
  .digest("hex");
if (nativeV24VideoSha256 !== nativeV24VideoExpectedSha256) {
  throw new Error(
    \`Native mobile video checksum mismatch: \${nativeV24VideoSha256}\`,
  );
}
if (
  nativeV24Video.byteLength < 12 ||
  nativeV24Video.subarray(4, 8).toString("ascii") !== "ftyp"
) {
  throw new Error("Native mobile video is not an MP4 file");
}
for (const marker of ["moov", "mdat", "vide", "avc1"]) {
  if (!nativeV24Video.includes(Buffer.from(marker, "ascii"))) {
    throw new Error(\`Native mobile video is missing the \${marker} marker\`);
  }
}
if (
  nativeV24Video.includes(Buffer.from("mp4a", "ascii")) ||
  nativeV24Video.includes(Buffer.from("soun", "ascii"))
) {
  throw new Error("Native mobile video must not contain audio");
}
const nativeV24MoovOffset = nativeV24Video.indexOf(Buffer.from("moov", "ascii"));
const nativeV24MdatOffset = nativeV24Video.indexOf(Buffer.from("mdat", "ascii"));
if (
  nativeV24MoovOffset < 0 ||
  nativeV24MdatOffset < 0 ||
  nativeV24MoovOffset >= nativeV24MdatOffset
) {
  throw new Error("Native mobile video must use fast-start MP4 ordering");
}

const nativeV24Poster = await readFile(nativeV24PosterPath);
if (nativeV24Poster.byteLength !== nativeV24PosterExpectedBytes) {
  throw new Error(
    \`Unexpected native mobile poster size: \${nativeV24Poster.byteLength}; expected \${nativeV24PosterExpectedBytes}\`,
  );
}
const nativeV24PosterSha256 = createHash("sha256")
  .update(nativeV24Poster)
  .digest("hex");
if (nativeV24PosterSha256 !== nativeV24PosterExpectedSha256) {
  throw new Error(
    \`Native mobile poster checksum mismatch: \${nativeV24PosterSha256}\`,
  );
}
const nativeV24PosterInfo = webpInfo(nativeV24Poster);
if (
  nativeV24PosterInfo.width !== ${VIDEO_WIDTH} ||
  nativeV24PosterInfo.height !== ${VIDEO_HEIGHT} ||
  nativeV24PosterInfo.animated
) {
  throw new Error(
    \`Unexpected native mobile poster: \${nativeV24PosterInfo.width}x\${nativeV24PosterInfo.height}, animated=\${nativeV24PosterInfo.animated}\`,
  );
}
console.log(
  \`Validated \${nativeV24VideoPath}: ${VIDEO_WIDTH}x${VIDEO_HEIGHT}, \${nativeV24Video.byteLength} bytes, sha256=\${nativeV24VideoSha256}\`,
);
${validationEnd}`;
await update("scripts/materialize-mobile-forest-stream.mjs", (source) =>
  replaceMarked(
    source,
    validationStart,
    validationEnd,
    validationBlock,
    true,
  ),
);

await update("package.json", (source) => {
  const packageData = JSON.parse(source);
  const current = packageData.scripts["apply:prompt-policy"];
  if (typeof current !== "string" || !current) {
    throw new Error("package.json is missing apply:prompt-policy.");
  }
  if (!current.includes(FINALIZER_COMMAND)) {
    packageData.scripts["apply:prompt-policy"] =
      `${current} && ${FINALIZER_COMMAND}`;
  }
  return `${JSON.stringify(packageData, null, 2)}\n`;
});

await update("test/mobile-quality.test.mjs", (source) => {
  let next = replaceKnownMediaReferences(source)
    .replaceAll("2160x3840", `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`)
    .replaceAll("2160w", `${VIDEO_WIDTH}w`)
    .replaceAll(
      "{ width: 2160, height: 3840 }",
      `{ width: ${VIDEO_WIDTH}, height: ${VIDEO_HEIGHT} }`,
    )
    .replaceAll("AI-enhanced selected forest scene", "native selected forest scene")
    .replaceAll("AI-enhanced selected forest", "native selected forest")
    .replaceAll("AI-enhanced", "native-source")
    .replaceAll("selected 4K", "selected native-resolution")
    .replaceAll("through the 4K route", "through the native route");
  return next;
});

await update("test/mobile-background-loading.test.mjs", (source) => {
  let next = replaceKnownMediaReferences(source)
    .replaceAll("2160x3840", `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`)
    .replaceAll(
      "video.videoWidth === 2160",
      `video.videoWidth === ${VIDEO_WIDTH}`,
    )
    .replaceAll(
      "video.videoHeight === 3840",
      `video.videoHeight === ${VIDEO_HEIGHT}`,
    )
    .replaceAll("first.width !== 2160", `first.width !== ${VIDEO_WIDTH}`)
    .replaceAll("first.height !== 3840", `first.height !== ${VIDEO_HEIGHT}`)
    .replaceAll("AI-enhanced", "native-source")
    .replaceAll("selected 4K", "selected native-resolution");

  const assertionStart =
    '  assert.equal(\n    config.scripts["apply:prompt-policy"],';
  const assertionEnd = "\n  );\n\n  const loader = await import(";
  if (next.includes(assertionStart)) {
    const start = next.indexOf(assertionStart);
    const end = next.indexOf(assertionEnd, start);
    if (end < 0) {
      throw new Error("Could not finish the apply:prompt-policy assertion.");
    }
    const replacement = `  assert.match(
    config.scripts["apply:prompt-policy"],
    /finalize-native-selected-mobile-v24\\.mjs$/,
  );

  const loader = await import(`;
    next = next.slice(0, start) + replacement + next.slice(end + assertionEnd.length);
  }
  return next;
});

await update(".github/workflows/verify-mobile-video.yml", (source) => {
  let next = replaceKnownMediaReferences(source)
    .replaceAll("AI-enhanced selected mobile video", "native selected mobile video")
    .replaceAll("AI-enhanced selected forest", "native selected forest")
    .replaceAll("AI-enhanced", "native-source")
    .replaceAll("enhanced selected forest", "native selected forest")
    .replaceAll("enhanced selected-scene", "native selected-scene")
    .replaceAll("enhanced release", "native release")
    .replaceAll("enhanced video", "native video")
    .replaceAll("2160x3840", `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`)
    .replaceAll("video.videoWidth === 2160", `video.videoWidth === ${VIDEO_WIDTH}`)
    .replaceAll("video.videoHeight === 3840", `video.videoHeight === ${VIDEO_HEIGHT}`)
    .replaceAll("first.width !== 2160", `first.width !== ${VIDEO_WIDTH}`)
    .replaceAll("first.height !== 3840", `first.height !== ${VIDEO_HEIGHT}`)
    .replaceAll("-gt 30000000", "-gt 1500000")
    .replaceAll('"$bitrate" -le 30000000', '"$bitrate" -le 1500000')
    .replaceAll("ai-enhanced-mobile-4k", "native-selected-mobile-v24")
    .replaceAll("ai-enhanced-mobile", "native-selected-mobile")
    .replaceAll("Exact native-source 2160x3840", `Exact native ${VIDEO_WIDTH}x${VIDEO_HEIGHT}`)
    .replaceAll("selected forest video", "selected forest native video");
  return next;
});

console.log(
  `Selected the ${VIDEO_BYTES}-byte native ${VIDEO_WIDTH}x${VIDEO_HEIGHT} forest-stream release (${VERSION}).`,
);

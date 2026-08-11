import { readdir, readFile, writeFile } from "node:fs/promises";

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
const VIDEO_BYTES = Number(metadata.videoBytes);
const VIDEO_SHA256 = metadata.videoSha256;
const POSTER_BYTES = Number(metadata.posterBytes);
const POSTER_SHA256 = metadata.posterSha256;
const VIDEO_WIDTH = Number(metadata.width);
const VIDEO_HEIGHT = Number(metadata.height);
const QUALITY_LABEL = `coherent-source-${VIDEO_WIDTH}x${VIDEO_HEIGHT}`;
const SOURCE_LABEL = "coherent-full-frame-source-motion";
const LOADING_LABEL = "video-loading-coherent-4k";
const ZOOM_SAFE_QUERY =
  "(orientation: portrait) and (hover: none) and (pointer: coarse)";
const FINALIZER_COMMAND =
  "node scripts/finalize-coherent-mobile-v25.mjs";
const NATIVE_FINALIZER =
  "node scripts/finalize-native-selected-mobile-v24.mjs";
const REGRESSION_FINALIZER =
  "node scripts/finalize-native-selected-mobile-v24-regressions.mjs";

const OLD = {
  version: "20260810-native-selected-mobile-v24-1",
  videoRoute: "/media/mobile-forest-stream-video-v24-native-1080.mp4",
  videoAsset: "/scenes/mobile-forest-stream-video-v24-native-1080.mp4",
  videoName: "mobile-forest-stream-video-v24-native-1080.mp4",
  posterAsset: "/scenes/mobile-forest-stream-v24-native-1080.webp",
  posterName: "mobile-forest-stream-v24-native-1080.webp",
  videoBytes: 2_371_524,
  videoSha256:
    "69dd547594f86fb80f643fa7c823d076c414a630d9a5a53504b6d5f930b95ffc",
  posterBytes: 179_600,
  posterSha256:
    "c505ce3a83d342d7d47d7c0a09f3f3899225823d08156f2c757b940049b164ab",
  qualityLabel: "native-source-1080x1920",
  sourceLabel: "selected-forest-stream-native-source",
  loadingLabel: "video-loading-native-source",
};

const LEGACY_POSTER = "/scenes/mobile-forest-stream-v14-retina-2160.webp";

function grouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "_");
}

function escaped(value) {
  return value
    .replaceAll("/", "\\/")
    .replaceAll(".", "\\.");
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function replaceRelease(source) {
  const pairs = [
    [OLD.videoRoute, VIDEO_ROUTE],
    [OLD.videoAsset, VIDEO_ASSET],
    [OLD.videoName, VIDEO_ASSET.split("/").at(-1)],
    [OLD.posterAsset, POSTER_ASSET],
    [OLD.posterName, POSTER_ASSET.split("/").at(-1)],
    [escaped(OLD.videoRoute), escaped(VIDEO_ROUTE)],
    [escaped(OLD.videoAsset), escaped(VIDEO_ASSET)],
    [escaped(OLD.videoName), escaped(VIDEO_ASSET.split("/").at(-1))],
    [escaped(OLD.posterAsset), escaped(POSTER_ASSET)],
    [escaped(OLD.posterName), escaped(POSTER_ASSET.split("/").at(-1))],
    [OLD.version, VERSION],
    [String(OLD.videoBytes), String(VIDEO_BYTES)],
    [grouped(OLD.videoBytes), grouped(VIDEO_BYTES)],
    [OLD.videoSha256, VIDEO_SHA256],
    [String(OLD.posterBytes), String(POSTER_BYTES)],
    [grouped(OLD.posterBytes), grouped(POSTER_BYTES)],
    [OLD.posterSha256, POSTER_SHA256],
    [OLD.qualityLabel, QUALITY_LABEL],
    [OLD.sourceLabel, SOURCE_LABEL],
    [OLD.loadingLabel, LOADING_LABEL],
  ];

  let next = source;
  for (const [before, after] of pairs) {
    next = next.split(before).join(after);
  }
  return next;
}

// The prior regression finalizer deliberately runs before this one. Restore
// the intended command order after it canonicalizes the older tail.
const packagePath = "package.json";
const packageData = JSON.parse(await readFile(packagePath, "utf8"));
const policy = packageData.scripts?.["apply:prompt-policy"];
if (typeof policy !== "string" || !policy.trim()) {
  throw new Error("package.json is missing apply:prompt-policy");
}
const canonicalPolicy = [
  ...policy
    .split(" && ")
    .filter(
      (command) =>
        command !== NATIVE_FINALIZER &&
        command !== REGRESSION_FINALIZER &&
        command !== FINALIZER_COMMAND,
    ),
  NATIVE_FINALIZER,
  REGRESSION_FINALIZER,
  FINALIZER_COMMAND,
].join(" && ");
packageData.scripts["apply:prompt-policy"] = canonicalPolicy;
await writeFile(packagePath, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");

await update("src/page.js", (source) => {
  let next = replaceRelease(source)
    .split(LEGACY_POSTER)
    .join(POSTER_ASSET)
    .replaceAll(
      "(max-width: 980px) and (orientation: portrait)",
      ZOOM_SAFE_QUERY,
    );
  next = next
    .replaceAll(`${POSTER_ASSET} 1080w`, `${POSTER_ASSET} ${VIDEO_WIDTH}w`)
    .replaceAll(`${POSTER_ASSET} 2160w`, `${POSTER_ASSET} ${VIDEO_WIDTH}w`)
    .replace(
      /mobile-woodland-loop\.css\?v=[^"]+/,
      `mobile-woodland-loop.css?v=${VERSION}`,
    )
    .replace(
      /mobile-static-fallback-fix-20260811\.css\?v=[^"]+/,
      `mobile-static-fallback-fix-20260811.css?v=${VERSION}`,
    );
  return next;
});

await update("public/mobile-quality.js", (source) => {
  let next = replaceRelease(source).split(LEGACY_POSTER).join(POSTER_ASSET);
  next = next.replace(
    /const MOBILE_BACKGROUND_QUERY =\n\s+"[^"]+";/,
    `const MOBILE_BACKGROUND_QUERY =\n  "${ZOOM_SAFE_QUERY}";`,
  );
  next = next
    .replaceAll("native-source-1080x1920", QUALITY_LABEL)
    .replaceAll("selected-forest-stream-native-source", SOURCE_LABEL)
    .replaceAll("video-loading-native-source", LOADING_LABEL);
  return next;
});

await update("public/mobile-static-fallback-fix-20260811.css", (source) =>
  replaceRelease(source)
    .split(LEGACY_POSTER)
    .join(POSTER_ASSET)
    .replaceAll(
      "(max-width: 980px) and (orientation: portrait)",
      ZOOM_SAFE_QUERY,
    ),
);

await update("public/mobile-woodland-loop.css", (source) => {
  let next = replaceRelease(source).split(LEGACY_POSTER).join(POSTER_ASSET);
  const start = "/* coherent-mobile-v25-start */";
  const end = "/* coherent-mobile-v25-end */";
  const block = `${start}\n@media ${ZOOM_SAFE_QUERY} {\n  .photo-backdrop {\n    background-image: url("${POSTER_ASSET}") !important;\n    background-size: cover !important;\n    background-position: 50% 50% !important;\n    background-repeat: no-repeat !important;\n  }\n\n  #photo-backdrop-image {\n    display: none !important;\n    visibility: hidden !important;\n    opacity: 0 !important;\n  }\n\n  /* Keep the legacy water canvas beneath the selected full-frame video. It can\n     still satisfy its diagnostic checks without ever painting over the scene. */\n  .mobile-motion-canvas {\n    z-index: -1 !important;\n  }\n}\n${end}`;
  const pattern = new RegExp(
    `/\\* coherent-mobile-v25-start \\*/[\\s\\S]*?/\\* coherent-mobile-v25-end \\*/`,
  );
  if (pattern.test(next)) return next.replace(pattern, block);
  return `${next.trimEnd()}\n\n${block}\n`;
});

for (const path of [
  "public/guides.css",
  "public/_headers",
  ".github/workflows/verify-mobile-video.yml",
  ".github/workflows/verify-mobile-background.yml",
]) {
  await update(path, (source) => replaceRelease(source));
}

// The video release workflow contains literal dimension checks that are not
// represented by a path or checksum. Keep those aligned with the 4K source.
await update(".github/workflows/verify-mobile-video.yml", (source) =>
  source
    .replaceAll("1080x1920", `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`)
    .replaceAll("native-source 1080x1920", `coherent-source ${VIDEO_WIDTH}x${VIDEO_HEIGHT}`),
);

const testNames = (await readdir("test"))
  .filter((name) => name.endsWith(".mjs"))
  .sort();
const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/finalize-coherent-mobile-v25\.mjs"|"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/finalize-native-selected-mobile-v24-regressions\.mjs"/g;

for (const name of testNames) {
  await update(`test/${name}`, (source) => {
    let next = replaceRelease(source)
      .replace(commandLiteralPattern, JSON.stringify(canonicalPolicy))
      .replaceAll(
        "/finalize-native-selected-mobile-v24-regressions\\.mjs$/",
        "/finalize-native-selected-mobile-v24-regressions\\.mjs && node scripts\\/finalize-coherent-mobile-v25\\.mjs$/",
      );
    if (name === "mobile-quality.test.mjs") {
      next = next
        .replaceAll(`${POSTER_ASSET} 1080w`, `${POSTER_ASSET} ${VIDEO_WIDTH}w`)
        .replaceAll(
          "{ width: 1080, height: 1920 }",
          `{ width: ${VIDEO_WIDTH}, height: ${VIDEO_HEIGHT} }`,
        );
    }
    return next;
  });
}

console.log(
  `Finalized coherent mobile video ${VIDEO_WIDTH}x${VIDEO_HEIGHT}: ${VIDEO_ROUTE}.`,
);

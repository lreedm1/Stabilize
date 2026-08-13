import { readdir, readFile, writeFile } from "node:fs/promises";

const metadata = JSON.parse(
  await readFile(new URL("./mobile-smooth-v32.json", import.meta.url), "utf8"),
);

const VERSION = metadata.version;
const VIDEO_ROUTE = metadata.videoRoute;
const VIDEO_ASSET = metadata.videoAsset;
const VIDEO_BYTES = metadata.videoBytes;
const VIDEO_SHA256 = metadata.videoSha256;
const VIDEO_WIDTH = metadata.width;
const VIDEO_HEIGHT = metadata.height;
const QUALITY = metadata.quality;
const POSTER = metadata.poster;
const HANDOFF_CLIENT = metadata.handoffClient;
const BACKGROUND_STYLE = metadata.backgroundStyle;

const FINALIZER = "node scripts/finalize-mobile-smooth-v32.mjs";
const STATIC_FAVICON_FINALIZER =
  "node scripts/embed-favicon-fallback.mjs";
const TEST_PATH = "test/mobile-smooth-v32.test.mjs";
const RETIRED_TESTS = new Set([
  "test/mobile-background-v30.test.mjs",
  "test/mobile-video-handoff-v31.test.mjs",
]);
const VERIFY_TEMPLATE_PATH = "scripts/verify-mobile-smooth-v32.yml";
const VERIFY_WORKFLOW_PATH = ".github/workflows/verify-mobile-video.yml";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function requireMatch(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Could not find ${label}.`);
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

await update("src/mobile-video-response.js", (source) => {
  let next = source;
  next = requireMatch(
    next,
    /export const MOBILE_VIDEO_ROUTE =\n\s+"[^"]+";/,
    `export const MOBILE_VIDEO_ROUTE =\n  "${VIDEO_ROUTE}";`,
    "the mobile video route",
  );
  next = requireMatch(
    next,
    /export const MOBILE_VIDEO_ASSET_PATH =\n\s+"[^"]+";/,
    `export const MOBILE_VIDEO_ASSET_PATH =\n  "${VIDEO_ASSET}";`,
    "the mobile video asset path",
  );
  next = requireMatch(
    next,
    /export const MOBILE_VIDEO_BYTES = [\d_]+;/,
    `export const MOBILE_VIDEO_BYTES = ${String(VIDEO_BYTES).replace(/\B(?=(\d{3})+(?!\d))/g, "_")};`,
    "the mobile video byte count",
  );
  next = requireMatch(
    next,
    /export const MOBILE_VIDEO_ETAG =\n\s+'"[0-9a-f]+"';/,
    `export const MOBILE_VIDEO_ETAG =\n  '"${VIDEO_SHA256}"';`,
    "the mobile video ETag",
  );

  for (const expected of [VIDEO_ROUTE, VIDEO_ASSET, VIDEO_SHA256]) {
    if (!next.includes(expected)) {
      throw new Error(`The v33 video responder is missing ${expected}.`);
    }
  }
  return next;
});

await update("public/mobile-video-handoff-v31.js", (source) => {
  let next = source;
  next = requireMatch(
    next,
    /const VERSION = "[^"]+";/,
    `const VERSION = "${VERSION}";`,
    "the mobile handoff version",
  );
  next = requireMatch(
    next,
    /const VIDEO_ASSET =\n\s+`\/media\/[^`]+\?v=\$\{VERSION\}`;/,
    `const VIDEO_ASSET =\n    \`${VIDEO_ROUTE}?v=\${VERSION}\`;`,
    "the mobile handoff video route",
  );
  next = requireMatch(
    next,
    /video\.style\.setProperty\("visibility", "(?:hidden|visible)", "important"\);\n\s+video\.style\.setProperty\("opacity", "(?:0|0\.001)", "important"\);/,
    `video.style.setProperty("visibility", "visible", "important");\n    video.style.setProperty("opacity", "0.001", "important");`,
    "the renderable preroll styles",
  );
  next = requireMatch(
    next,
    /\s+(?:video\.currentTime <= 0 \|\|\n\s+)?video\.videoWidth < \d+ \|\|\n\s+video\.videoHeight < \d+/,
    `\n      video.currentTime <= 0 ||\n      video.videoWidth < ${VIDEO_WIDTH - 20} ||\n      video.videoHeight < ${VIDEO_HEIGHT - 40}`,
    "the decoded-frame reveal guard",
  );
  next = next.replace(
    /native-video(?:-(?:hevc|h264))?-\d+x\d+-\d+fps/g,
    QUALITY,
  );

  for (const expected of [
    VERSION,
    VIDEO_ROUTE,
    QUALITY,
    'video.style.setProperty("opacity", "0.001", "important")',
    "video.currentTime <= 0",
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`The v33 handoff client is missing ${expected}.`);
    }
  }
  return next;
});

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
  if (!match) throw new Error("Could not find the mobile background video element.");

  const posterMatch = match[0].match(/poster="([^"]+)"/);
  const poster = posterMatch?.[1] || POSTER;
  const replacement = `<video
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
        src="${VIDEO_ROUTE}?v=${VERSION}"
        type="video/mp4"
      />
    </video>`;
  next = next.replace(videoPattern, replacement);

  const canvasPattern = /(<canvas\n\s+id="mobile-background-v30"[\s\S]*?<\/canvas>)/;
  const canvasMatch = next.match(canvasPattern);
  if (!canvasMatch) throw new Error("Could not find the mobile fallback canvas.");
  next = next.replace(
    canvasPattern,
    `$1\n    <script src="${HANDOFF_CLIENT}?v=${VERSION}"></script>`,
  );

  if (next.includes("/mobile-background/runtime?v=")) {
    throw new Error("The expensive animated fallback controller is still loaded.");
  }
  if (next.split(HANDOFF_CLIENT).length - 1 !== 1) {
    throw new Error("Expected exactly one lightweight mobile handoff client.");
  }
  if (!next.includes(`${VIDEO_ROUTE}?v=${VERSION}`)) {
    throw new Error("The 720p mobile video is not parser-visible.");
  }
  if (!next.includes(`${BACKGROUND_STYLE}?v=`)) {
    throw new Error("The mobile background stylesheet is missing.");
  }
  return next;
});

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

  const nodeTests = String(data.scripts?.["test:node"] || "");
  const tokens = nodeTests
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !RETIRED_TESTS.has(token) && token !== TEST_PATH);
  tokens.push(TEST_PATH);
  data.scripts["test:node"] = tokens.join(" ");
  return `${JSON.stringify(data, null, 2)}\n`;
});

const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/finalize-(?:native-selected-mobile-v24-regressions|mobile-video-handoff-v31|mobile-smooth-v32)\.mjs(?: && node scripts\/embed-favicon-fallback\.mjs)?"/g;
const previousTail = "finalize-mobile-video-handoff-v31\\.mjs$/";
const mobileTail =
  "finalize-mobile-video-handoff-v31\\.mjs && node scripts\\/finalize-mobile-smooth-v32\\.mjs$/";
const canonicalTail =
  "finalize-mobile-video-handoff-v31\\.mjs && node scripts\\/finalize-mobile-smooth-v32\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/";
const testNames = (await readdir("test"))
  .filter((name) => name.endsWith(".mjs"))
  .sort();

for (const name of testNames) {
  await update(`test/${name}`, (source) =>
    source
      .replace(commandLiteralPattern, JSON.stringify(canonicalPolicy))
      .replaceAll(previousTail, canonicalTail)
      .replaceAll(mobileTail, canonicalTail),
  );
}

const verifyTemplate = await readFile(VERIFY_TEMPLATE_PATH, "utf8");
await writeFile(VERIFY_WORKFLOW_PATH, verifyTemplate, "utf8");

console.log(
  `Finalized ${VERSION}: static sharp poster, ${VIDEO_WIDTH}x${VIDEO_HEIGHT} 60 fps baseline H.264, and no animated canvas on first load.`,
);

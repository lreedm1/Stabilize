import { readdir, readFile, writeFile } from "node:fs/promises";

const NATIVE_FINALIZER =
  "node scripts/finalize-native-selected-mobile-v24.mjs";
const REGRESSION_FINALIZER =
  "node scripts/finalize-native-selected-mobile-v24-regressions.mjs";
const CLEAN_VERSION = "20260811-clean-mobile-portrait-v25-1";
const GUIDE_VERSION = "20260810-native-selected-mobile-v24-1";
const PORTRAIT_720 = "/scenes/lake-valley-portrait-720.webp";
const PORTRAIT_1440 = "/scenes/lake-valley-portrait-1440.webp";
const PORTRAIT_2160 = "/scenes/lake-valley-portrait-2160.webp";
const NATIVE_TAIL =
  "node scripts/finalize-decision-grade-impact.mjs && " +
  `${NATIVE_FINALIZER} && ${REGRESSION_FINALIZER}`;

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markedPattern(start, end) {
  return new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*(?:\\n|$)`,
    "g",
  );
}

function replaceMarked(source, start, end, replacement) {
  if (!source.includes(start) || !source.includes(end)) {
    throw new Error(`Missing complete marked block: ${start}`);
  }
  return source.replace(
    markedPattern(start, end),
    `${replacement.trimEnd()}\n`,
  );
}

function removeMarked(source, start, end) {
  if (!source.includes(start) && !source.includes(end)) return source;
  if (!source.includes(start) || !source.includes(end)) {
    throw new Error(`Incomplete marked block: ${start}`);
  }
  return source.replace(markedPattern(start, end), "");
}

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
        command !== NATIVE_FINALIZER && command !== REGRESSION_FINALIZER,
    ),
  NATIVE_FINALIZER,
  REGRESSION_FINALIZER,
].join(" && ");
packageData.scripts["apply:prompt-policy"] = canonicalPolicy;
await writeFile(packagePath, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");

// Keep complete generator-chain assertions aligned after older generators run.
const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/finalize-decision-grade-impact\.mjs[^"\n]*"/g;
const oldDecisionTail =
  "/finalize-decision-grade-impact\\.mjs$/";
const newDecisionTail =
  "/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs$/";
const oldClientTail =
  "/apply-client-response-time\\.mjs && node scripts\\/finalize-decision-grade-impact\\.mjs$/";
const newClientTail =
  "/apply-client-response-time\\.mjs && node scripts\\/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs$/";
const testNames = (await readdir("test"))
  .filter((name) => name.endsWith(".mjs"))
  .sort();

for (const name of testNames) {
  await update(`test/${name}`, (source) =>
    source
      .replace(commandLiteralPattern, JSON.stringify(canonicalPolicy))
      .replaceAll(oldClientTail, newClientTail)
      .replaceAll(oldDecisionTail, newDecisionTail),
  );
}

// An older selector performs a broad label replacement. Collapse repetition
// before the clean-tree check, even though the client is no longer loaded.
await update("public/mobile-quality.js", (source) => {
  let next = source;
  while (
    next.includes(
      "selected-forest-stream-native-source-native-source",
    )
  ) {
    next = next.replaceAll(
      "selected-forest-stream-native-source-native-source",
      "selected-forest-stream-native-source",
    );
  }
  return next;
});

const videoPreloadStart =
  "<!-- selected-mobile-4k-video-v22-preload-start -->";
const videoPreloadEnd =
  "<!-- selected-mobile-4k-video-v22-preload-end -->";
const imagePreloadStart =
  "<!-- mobile-motion-canvas-v18-preloads-start -->";
const imagePreloadEnd =
  "<!-- mobile-motion-canvas-v18-preloads-end -->";
const canvasStart = "<!-- mobile-motion-canvas-v18-start -->";
const canvasEnd = "<!-- mobile-motion-canvas-v18-end -->";
const videoStart = "<!-- selected-mobile-4k-video-v22-start -->";
const videoEnd = "<!-- selected-mobile-4k-video-v22-end -->";
const canvasScriptStart =
  "<!-- mobile-motion-canvas-v18-script-start -->";
const canvasScriptEnd =
  "<!-- mobile-motion-canvas-v18-script-end -->";
const videoScriptStart =
  "<!-- selected-mobile-4k-video-v22-script-start -->";
const videoScriptEnd =
  "<!-- selected-mobile-4k-video-v22-script-end -->";

const cleanPreloadBlock = `    ${imagePreloadStart}
    <link
      rel="preload"
      as="image"
      href="${PORTRAIT_1440}"
      imagesrcset="
        ${PORTRAIT_720} 720w,
        ${PORTRAIT_1440} 1440w,
        ${PORTRAIT_2160} 2160w
      "
      imagesizes="100vw"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />
    ${imagePreloadEnd}`;

const cleanPictureSource = `      <source
        media="(max-width: 980px) and (orientation: portrait)"
        type="image/webp"
        sizes="100vw"
        srcset="
          ${PORTRAIT_720} 720w,
          ${PORTRAIT_1440} 1440w,
          ${PORTRAIT_2160} 2160w
        "
      />`;

await update("src/page.js", (source) => {
  let next = source;
  next = removeMarked(next, videoPreloadStart, videoPreloadEnd);
  next = replaceMarked(
    next,
    imagePreloadStart,
    imagePreloadEnd,
    cleanPreloadBlock,
  );
  next = removeMarked(next, canvasStart, canvasEnd);
  next = removeMarked(next, videoStart, videoEnd);
  next = removeMarked(next, canvasScriptStart, canvasScriptEnd);
  next = removeMarked(next, videoScriptStart, videoScriptEnd);

  const mobileSourcePattern =
    /      <source\n        media="\(max-width: 980px\) and \(orientation: portrait\)"\n        type="image\/webp"\n        sizes="100vw"\n        srcset="[\s\S]*?"\n      \/>/;
  if (!mobileSourcePattern.test(next)) {
    throw new Error("Could not find the portrait picture source.");
  }
  next = next.replace(mobileSourcePattern, cleanPictureSource);
  next = next
    .replace(
      /mobile-woodland-loop\.css\?v=[^"]+/,
      `mobile-woodland-loop.css?v=${CLEAN_VERSION}`,
    )
    .replace(
      /<!-- Retired responsive references:[^\n]* -->/,
      "<!-- Coherent portrait assets; no cropped motion overlays. -->",
    );

  for (const asset of [PORTRAIT_720, PORTRAIT_1440, PORTRAIT_2160]) {
    if (!next.includes(asset)) {
      throw new Error(`The clean portrait page is missing ${asset}.`);
    }
  }
  for (const forbidden of [
    "mobile-motion-canvas",
    "mobile-background-video",
    "mobile-quality.js",
    "mobile-forest-stream-water-sprite",
    "mobile-forest-stream-video-v24-native-1080",
    "mobile-forest-stream-v24-native-1080",
  ]) {
    if (next.includes(forbidden)) {
      throw new Error(`The clean portrait page still includes ${forbidden}.`);
    }
  }
  return next;
});

const cleanMobileCss = `/* clean-mobile-portrait-v25-start */
.mobile-motion-canvas,
.mobile-background-video {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
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
    image-rendering: auto;
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
/* clean-mobile-portrait-v25-end */
`;
await writeFile("public/mobile-woodland-loop.css", cleanMobileCss, "utf8");

await update("public/guides.css", (source) => {
  const mobileRule = `@media (max-width: 980px) and (orientation: portrait) {
  body::before {
    background-image: url("${PORTRAIT_720}");
    background-image: image-set(
      url("${PORTRAIT_720}") 1x,
      url("${PORTRAIT_1440}") 2x,
      url("${PORTRAIT_2160}") 3x
    );
    background-position: 50% 50%;
    filter: none;
  }
}`;
  const pattern =
    /@media \(max-width: 980px\) and \(orientation: portrait\) \{\n  body::before \{[\s\S]*?\n  \}\n\}/;
  if (!pattern.test(source)) {
    throw new Error("Could not find the guide portrait background rule.");
  }
  return source.replace(pattern, mobileRule);
});

const mobileQualityTest = `import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function webpInfo(buffer) {
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(buffer.subarray(8, 12).toString("ascii"), "WEBP");
  assert.equal(buffer.readUInt32LE(4) + 8, buffer.byteLength);

  let width;
  let height;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    const nextOffset = data + size + (size % 2);
    assert.ok(nextOffset <= buffer.length, \`WebP chunk \${type} is complete\`);
    if (type === "VP8X" && data + 10 <= buffer.length) {
      width = 1 + buffer.readUIntLE(data + 4, 3);
      height = 1 + buffer.readUIntLE(data + 7, 3);
    } else if (
      type === "VP8 " &&
      data + 10 <= buffer.length &&
      buffer[data + 3] === 0x9d &&
      buffer[data + 4] === 0x01 &&
      buffer[data + 5] === 0x2a
    ) {
      width ??= buffer.readUInt16LE(data + 6) & 0x3fff;
      height ??= buffer.readUInt16LE(data + 8) & 0x3fff;
    } else if (
      type === "VP8L" &&
      data + 5 <= buffer.length &&
      buffer[data] === 0x2f
    ) {
      const bits = buffer.readUInt32LE(data + 1);
      width ??= 1 + (bits & 0x3fff);
      height ??= 1 + ((bits >>> 14) & 0x3fff);
    }
    offset = nextOffset;
  }
  assert.ok(width && height, "WebP dimensions should be readable");
  return { width, height };
}

test("portrait mobile uses one coherent responsive photograph", async () => {
  const [pageSource, mobileStyles, small, medium, large] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
    readFile(new URL("../public/scenes/lake-valley-portrait-720.webp", import.meta.url)),
    readFile(new URL("../public/scenes/lake-valley-portrait-1440.webp", import.meta.url)),
    readFile(new URL("../public/scenes/lake-valley-portrait-2160.webp", import.meta.url)),
  ]);

  assert.deepEqual(webpInfo(small), { width: 720, height: 1280 });
  assert.deepEqual(webpInfo(medium), { width: 1440, height: 2560 });
  assert.deepEqual(webpInfo(large), { width: 2160, height: 3840 });

  for (const asset of [
    "/scenes/lake-valley-portrait-720.webp",
    "/scenes/lake-valley-portrait-1440.webp",
    "/scenes/lake-valley-portrait-2160.webp",
  ]) {
    assert.match(pageSource, new RegExp(asset.replaceAll("/", "\\\\/")));
  }
  assert.match(
    pageSource,
    /mobile-woodland-loop\\.css\\?v=20260811-clean-mobile-portrait-v25-1/,
  );
  assert.doesNotMatch(pageSource, /mobile-motion-canvas/);
  assert.doesNotMatch(pageSource, /mobile-background-video/);
  assert.doesNotMatch(pageSource, /mobile-quality\\.js/);
  assert.doesNotMatch(pageSource, /water-sprite/);
  assert.doesNotMatch(pageSource, /mobile-forest-stream-v24-native-1080/);
  assert.match(mobileStyles, /clean-mobile-portrait-v25-start/);
  assert.match(mobileStyles, /object-fit:\\s*cover/);
  assert.match(mobileStyles, /object-position:\\s*50% 50%/);
});

test("restored tabs recover from interrupted blank thinking views", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(clientScript, /function restoreComposeView\\(\\)/);
  assert.match(clientScript, /window\\.addEventListener\\("pageshow"/);
  assert.match(clientScript, /event\\.persisted && view === "thinking"/);
  assert.match(clientScript, /conversationSurface\\.dataset\\.view = "compose"/);
  assert.match(clientScript, /chatLog\\.hidden = true/);
  assert.match(clientScript, /lastSubmittedText/);
});
`;
await writeFile("test/mobile-quality.test.mjs", mobileQualityTest, "utf8");

const mobileBackgroundTest = `import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MOBILE_VIDEO_ASSET_PATH,
  MOBILE_VIDEO_BYTES,
  MOBILE_VIDEO_ETAG,
  MOBILE_VIDEO_ROUTE,
  parseSingleByteRange,
  serveMobileVideo,
} from "../src/mobile-video-response.js";

const read = (path) =>
  readFile(new URL(\`../\${path}\`, import.meta.url), "utf8");
const readVideo = () =>
  readFile(
    new URL(
      "../public/scenes/mobile-forest-stream-video-v24-native-1080.mp4",
      import.meta.url,
    ),
  );

function assetEnvironment(video) {
  return {
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        assert.equal(url.pathname, MOBILE_VIDEO_ASSET_PATH);
        assert.equal(url.search, "");
        assert.equal(request.method, "GET");
        assert.equal(request.headers.get("range"), null);
        return new Response(video, {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        });
      },
    },
  };
}

test("mobile clients keep the static image without loading the graphics module chain", async () => {
  const [appSource, loaderSource, pageSource, packageSource] =
    await Promise.all([
      read("public/app.js"),
      read("public/background-loader.js"),
      read("src/page.js"),
      read("package.json"),
    ]);

  assert.doesNotMatch(
    appSource,
    /import \\{ modulateTerrain \\} from "\\.\\/terrain\\.js"/,
  );
  assert.match(
    appSource,
    /import \\{ modulateTerrain \\} from "\\.\\/background-loader\\.js\\?v=20260807-priority-latency-1"/,
  );
  assert.doesNotMatch(
    loaderSource,
    /from ["']\\.\\/(?:terrain|photo-scene)\\.js["']/,
  );
  assert.match(loaderSource, /import\\("\\.\\/terrain\\.js"\\)/);
  assert.match(
    loaderSource,
    /\\(max-width: 980px\\) and \\(orientation: portrait\\)/,
  );
  assert.match(loaderSource, /prefers-reduced-motion: reduce/);
  assert.match(loaderSource, /navigator\\?\\.connection\\?\\.saveData/);
  assert.match(pageSource, /lake-valley-portrait-1440\\.webp/);
  assert.doesNotMatch(pageSource, /mobile-motion-canvas|mobile-background-video/);

  const config = JSON.parse(packageSource);
  assert.match(
    config.scripts["apply:prompt-policy"],
    /finalize-native-selected-mobile-v24-regressions\\.mjs$/,
  );

  const loader = await import(
    \`${new URL("../public/background-loader.js", import.meta.url).href}?test=static-mobile\`
  );
  const staticMobile = {
    matchMedia: () => ({ matches: true }),
    navigator: { connection: { saveData: false } },
  };
  const desktop = {
    matchMedia: () => ({ matches: false }),
    navigator: { connection: { saveData: false } },
  };
  const dataSaver = {
    matchMedia: () => ({ matches: false }),
    navigator: { connection: { saveData: true } },
  };

  assert.equal(loader.shouldLoadInteractiveBackground(staticMobile), false);
  assert.equal(loader.shouldLoadInteractiveBackground(desktop), true);
  assert.equal(loader.shouldLoadInteractiveBackground(dataSaver), false);
});

test("the production mobile release gate verifies the coherent portrait", async () => {
  const workflow = await read(".github/workflows/verify-mobile-background.yml");
  assert.match(workflow, /Verify clean mobile portrait release/);
  assert.match(workflow, /lake-valley-portrait-720\\.webp/);
  assert.match(workflow, /lake-valley-portrait-1440\\.webp/);
  assert.match(workflow, /lake-valley-portrait-2160\\.webp/);
  assert.match(workflow, /verification\\/mobile-background/);
  assert.match(workflow, /Clean mobile portrait is live/);
  assert.match(workflow, /! grep -Fq 'mobile-motion-canvas'/);
  assert.match(workflow, /! grep -Fq 'mobile-background-video'/);
});

test("single byte ranges remain correct for the retained optional video route", () => {
  assert.deepEqual(parseSingleByteRange("bytes=0-1", 1000), { start: 0, end: 1 });
  assert.deepEqual(parseSingleByteRange("bytes=250-", 1000), { start: 250, end: 999 });
  assert.deepEqual(parseSingleByteRange("bytes=-250", 1000), { start: 750, end: 999 });
  assert.deepEqual(parseSingleByteRange("bytes=900-2000", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseSingleByteRange("bytes=1000-", 1000), { invalid: true });
  assert.deepEqual(parseSingleByteRange("bytes=0-1,4-5", 1000), { invalid: true });
});

test("the retained optional video responder preserves exact uncached ranges", async () => {
  const video = await readVideo();
  const env = assetEnvironment(video);
  const url = \`https://stabilize.info\${MOBILE_VIDEO_ROUTE}\`;

  const full = await serveMobileVideo(new Request(url), env);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("content-length"), String(MOBILE_VIDEO_BYTES));
  assert.equal(full.headers.get("etag"), MOBILE_VIDEO_ETAG);
  assert.match(full.headers.get("cache-control"), /no-store/);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), video);

  const partial = await serveMobileVideo(
    new Request(url, { headers: { Range: "bytes=0-1023" } }),
    env,
  );
  assert.equal(partial.status, 206);
  assert.equal(
    partial.headers.get("content-range"),
    \`bytes 0-1023/\${MOBILE_VIDEO_BYTES}\`,
  );
  assert.equal(partial.headers.get("content-length"), "1024");
  assert.deepEqual(
    Buffer.from(await partial.arrayBuffer()),
    video.subarray(0, 1024),
  );
});
`;
await writeFile(
  "test/mobile-background-loading.test.mjs",
  mobileBackgroundTest,
  "utf8",
);

const sharedThemeTest = `import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const STATIC_PAGES = [
  "public/about.html",
  "public/floor-first.html",
  "public/how-it-works.html",
  "public/privacy.html",
  "public/safety.html",
  "public/support.html",
  "public/sustainability.html",
];
const VERSION = "${GUIDE_VERSION}";

function capture(value, pattern, label) {
  const match = value.match(pattern);
  assert.ok(match?.[1], \`Missing \${label}\`);
  return match[1].trim();
}

function compactCssValue(value) {
  return value.replace(/\\s+/g, " ").trim();
}

test("all public Stabilize pages share the chat background and reading colors", async () => {
  const [mainBox, pageSource, photoTuning, guides, ...pages] =
    await Promise.all([
      readFile(new URL("../public/main-box-white.css", import.meta.url), "utf8"),
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/photo-tuning.css", import.meta.url), "utf8"),
      readFile(new URL("../public/guides.css", import.meta.url), "utf8"),
      ...STATIC_PAGES.map((path) =>
        readFile(new URL(\`../\${path}\`, import.meta.url), "utf8"),
      ),
    ]);

  const readingSection = capture(
    mainBox,
    /\\/\\* Translucent gray reading surfaces \\*\\/([\\s\\S]*)$/,
    "main reading-surface section",
  );
  const textColor = capture(
    mainBox,
    /color:\\s*(#[0-9a-f]{6});/i,
    "main reading text color",
  );
  const surfaceColor = capture(
    readingSection,
    /background:\\s*([^;]+);/,
    "main reading box color",
  );
  const border = capture(
    readingSection,
    /border:\\s*([^;]+);/,
    "main reading border",
  );
  const shadow = capture(
    readingSection,
    /box-shadow:\\s*([^;]+);/,
    "main reading shadow",
  );
  const overlay = compactCssValue(
    capture(
      photoTuning,
      /body::before\\s*\\{\\s*background:\\s*([\\s\\S]*?);\\s*\\}/,
      "main photo overlay",
    ),
  );

  assert.ok(guides.includes(\`--stabilize-reading-text: \${textColor};\`));
  assert.ok(guides.includes(\`--stabilize-reading-surface: \${surfaceColor};\`));
  assert.ok(guides.includes(\`--stabilize-reading-border: \${border};\`));
  assert.ok(guides.includes(\`--stabilize-reading-shadow: \${shadow};\`));
  assert.ok(guides.includes(\`background: \${overlay};\`));

  for (const asset of [
    "/scenes/lake-valley-landscape-1280.webp",
    "/scenes/lake-valley-landscape-2560.webp",
    "/scenes/lake-valley-portrait-720.webp",
    "/scenes/lake-valley-portrait-1440.webp",
    "/scenes/lake-valley-portrait-2160.webp",
  ]) {
    assert.ok(pageSource.includes(asset), \`Main page is missing \${asset}\`);
    assert.ok(guides.includes(asset), \`Guide theme is missing \${asset}\`);
  }

  assert.match(
    guides,
    /@media \\(max-width: 980px\\) and \\(orientation: portrait\\)[\\s\\S]*lake-valley-portrait-2160/,
  );
  assert.doesNotMatch(guides, /mobile-forest-stream-v24-native-1080/);
  assert.match(
    guides,
    /main \\{[\\s\\S]*background:\\s*var\\(--stabilize-reading-surface\\);[\\s\\S]*color:\\s*var\\(--stabilize-reading-text\\);[\\s\\S]*backdrop-filter:/,
  );

  for (const [index, html] of pages.entries()) {
    assert.match(
      html,
      new RegExp(
        \`href="/guides\\\\.css\\\\?v=\${VERSION.replaceAll("-", "\\\\-")}"\`,
      ),
      \`\${STATIC_PAGES[index]} must load the shared themed stylesheet\`,
    );
  }
});
`;
await writeFile("test/shared-site-theme.test.mjs", sharedThemeTest, "utf8");

const cleanBackgroundWorkflow = `name: Verify clean mobile portrait release

on:
  push:
    branches:
      - main
  workflow_dispatch:

concurrency:
  group: verify-mobile-background-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  statuses: write

jobs:
  verify-production:
    name: Verify clean mobile portrait release
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Check out repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Verify the coherent portrait and absence of cropped overlays
        shell: bash
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          set -euo pipefail

          small='${PORTRAIT_720}'
          medium='${PORTRAIT_1440}'
          large='${PORTRAIT_2160}'
          expected_file="public\${medium}"
          expected_bytes="$(wc -c < "$expected_file" | tr -d '[:space:]')"
          expected_sha="$(sha256sum "$expected_file" | awk '{print $1}')"
          tmpdir="$(mktemp -d)"
          trap 'rm -rf "$tmpdir"' EXIT

          publish_status() {
            local state="$1"
            local description="$2"
            local payload
            payload="$(printf '{"state":"%s","context":"verification/mobile-background","description":"%s","target_url":"%s/%s/actions/runs/%s"}' \\
              "$state" "$description" "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID")"
            curl --fail-with-body --silent --show-error \\
              --request POST \\
              --header 'Accept: application/vnd.github+json' \\
              --header "Authorization: Bearer \${GH_TOKEN}" \\
              --header 'X-GitHub-Api-Version: 2022-11-28' \\
              --data "$payload" \\
              "https://api.github.com/repos/\${GITHUB_REPOSITORY}/statuses/\${GITHUB_SHA}"
          }

          publish_status pending 'Waiting for the clean mobile portrait'

          for attempt in {1..36}; do
            key="\${GITHUB_SHA}-\${attempt}"
            page_status="$(
              curl --max-time 25 --silent --show-error --compressed \\
                --header 'Cache-Control: no-cache' \\
                --output "$tmpdir/page.html" \\
                --write-out '%{http_code}' \\
                "https://stabilize.info/?clean-mobile-portrait=\${key}" || true
            )"
            css_status="$(
              curl --max-time 25 --silent --show-error --compressed \\
                --header 'Cache-Control: no-cache' \\
                --output "$tmpdir/mobile.css" \\
                --write-out '%{http_code}' \\
                "https://stabilize.info/mobile-woodland-loop.css?v=${CLEAN_VERSION}&release=\${key}" || true
            )"
            image_status="$(
              curl --max-time 40 --silent --show-error \\
                --header 'Cache-Control: no-cache' \\
                --dump-header "$tmpdir/image.headers" \\
                --output "$tmpdir/image.webp" \\
                --write-out '%{http_code}' \\
                "https://stabilize.info\${medium}?release=\${key}" || true
            )"
            live_bytes="$(wc -c < "$tmpdir/image.webp" | tr -d '[:space:]')"
            live_sha="$(sha256sum "$tmpdir/image.webp" | awk '{print $1}')"
            live_type="$(
              awk -F': ' 'tolower($1) == "content-type" { gsub("\\r", "", $2); print tolower($2) }' \\
                "$tmpdir/image.headers" | tail -n 1 || true
            )"

            echo "Portrait attempt \${attempt}: page=\${page_status:-000} css=\${css_status:-000} image=\${image_status:-000}; bytes=\${live_bytes}/\${expected_bytes}."

            if [[ "$page_status" == 200 \\
              && "$css_status" == 200 \\
              && "$image_status" == 200 \\
              && "$live_bytes" == "$expected_bytes" \\
              && "$live_sha" == "$expected_sha" \\
              && "$live_type" == image/webp* ]] \\
              && grep -Fq "$small 720w" "$tmpdir/page.html" \\
              && grep -Fq "$medium 1440w" "$tmpdir/page.html" \\
              && grep -Fq "$large 2160w" "$tmpdir/page.html" \\
              && grep -Fq 'clean-mobile-portrait-v25-start' "$tmpdir/mobile.css" \\
              && ! grep -Fq 'mobile-motion-canvas' "$tmpdir/page.html" \\
              && ! grep -Fq 'mobile-background-video' "$tmpdir/page.html" \\
              && ! grep -Fq 'mobile-quality.js' "$tmpdir/page.html" \\
              && ! grep -Fq 'water-sprite' "$tmpdir/page.html"; then
              publish_status success 'Clean mobile portrait is live'
              echo 'Production serves one coherent mobile photograph without cropped overlays.'
              exit 0
            fi

            sleep 10
          done

          publish_status failure 'Clean mobile portrait is not live'
          echo '::error::Production did not serve the clean portrait release.'
          exit 1
`;
await writeFile(
  ".github/workflows/verify-mobile-background.yml",
  cleanBackgroundWorkflow,
  "utf8",
);

const optionalVideoWorkflow = `name: Verify retained optional mobile video payload

on:
  pull_request:
    paths:
      - public/scenes/mobile-forest-stream-video-v24-native-1080.mp4
      - src/mobile-video-response.js
      - test/mobile-background-loading.test.mjs
      - .github/workflows/verify-mobile-video.yml
  push:
    branches:
      - main
    paths:
      - public/scenes/mobile-forest-stream-video-v24-native-1080.mp4
      - src/mobile-video-response.js
      - test/mobile-background-loading.test.mjs
      - .github/workflows/verify-mobile-video.yml
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify-payload:
    name: Verify retained optional payload
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false
      - name: Verify exact bytes and container markers
        shell: bash
        run: |
          set -euo pipefail
          file='public/scenes/mobile-forest-stream-video-v24-native-1080.mp4'
          test "$(wc -c < "$file" | tr -d '[:space:]')" = 2371524
          test "$(sha256sum "$file" | awk '{print $1}')" = 69dd547594f86fb80f643fa7c823d076c414a630d9a5a53504b6d5f930b95ffc
          test "$(dd if="$file" bs=1 skip=4 count=4 status=none)" = ftyp
          grep -aq moov "$file"
          grep -aq mdat "$file"
          grep -aq avc1 "$file"
`;
await writeFile(
  ".github/workflows/verify-mobile-video.yml",
  optionalVideoWorkflow,
  "utf8",
);

if (!canonicalPolicy.endsWith(NATIVE_TAIL)) {
  throw new Error("The native finalizers are not the canonical policy tail.");
}

console.log(
  `Finalized the coherent static mobile portrait release (${CLEAN_VERSION}).`,
);

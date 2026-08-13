import { readdir, readFile, writeFile } from "node:fs/promises";

const metadata = JSON.parse(
  await readFile(new URL("./mobile-hevc-v35.json", import.meta.url), "utf8"),
);
const VERSION = metadata.version;
const HEVC = metadata.hevcAsset;
const H264 = metadata.h264Asset;
const QUALITY = metadata.quality;
const FALLBACK_QUALITY = metadata.fallbackQuality;
const FINALIZER = "node scripts/finalize-mobile-hevc-v35.mjs";
const FAVICON = "node scripts/embed-favicon-fallback.mjs";
const TEST = "test/mobile-hevc-v35.test.mjs";
const OLD_TEST = "test/mobile-hevc-v34.test.mjs";
const LONG_PROMPT = "Start with what needs attention";
const SHORT_PROMPT = "What needs attention?";

async function rewrite(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

await rewrite("src/page.js", (source) =>
  source
    .replaceAll(
      "/scenes/mobile-forest-stream-video-v34-hevc-720.mp4",
      HEVC,
    )
    .replaceAll(
      "/scenes/mobile-forest-stream-video-v12-720.mp4",
      H264,
    )
    .replaceAll("20260813-mobile-hevc-v34-1", VERSION),
);

await rewrite("public/mobile-video-handoff-v31.js", (source) =>
  source
    .replace(/const VERSION = "[^"]+";/, `const VERSION = "${VERSION}";`)
    .replaceAll(
      "/scenes/mobile-forest-stream-video-v34-hevc-720.mp4",
      HEVC,
    )
    .replaceAll(
      "/scenes/mobile-forest-stream-video-v12-720.mp4",
      H264,
    )
    .replaceAll(
      "mobile-forest-stream-video-v34-hevc-720.mp4",
      HEVC.split("/").at(-1),
    )
    .replaceAll(
      '"native-video-720x1280-60fps"',
      `"${FALLBACK_QUALITY}"`,
    )
    .replaceAll(
      '"native-video-hevc-720x1280-60fps"',
      `"${QUALITY}"`,
    )
    .replaceAll("video.videoWidth < 700", "video.videoWidth < 1000")
    .replaceAll("video.videoHeight < 1240", "video.videoHeight < 1800")
    .replaceAll("mobile-hevc-v34-quality-start", "mobile-hevc-v35-quality-start")
    .replaceAll("mobile-hevc-v34-quality-end", "mobile-hevc-v35-quality-end")
    .replaceAll("20260813-mobile-hevc-v34-1", VERSION),
);

for (const path of [
  "src/copy.js",
  "src/uw-madison-chat.js",
  "scripts/compact-header-and-menu-info.mjs",
  "scripts/apply-human-aligned-homepage-v1.mjs",
  "public/about.html",
  "test/header-menu-copy.test.mjs",
]) {
  await rewrite(path, (source) =>
    source.replaceAll(LONG_PROMPT, SHORT_PROMPT),
  );
}

await rewrite("public/_headers", (source) => {
  const start = "# mobile-hevc-v35-start";
  const end = "# mobile-hevc-v35-end";
  const block = `${start}
${HEVC}
  Content-Type: video/mp4
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
${end}
`;
  const pattern =
    /# mobile-hevc-v35-start[\s\S]*?# mobile-hevc-v35-end\n?/;
  return pattern.test(source)
    ? source.replace(pattern, block)
    : `${source.trimEnd()}\n\n${block}`;
});

let canonical = "";
await rewrite("package.json", (source) => {
  const data = JSON.parse(source);
  const commands = String(data.scripts["apply:prompt-policy"])
    .split(" && ")
    .filter((command) => command !== FINALIZER && command !== FAVICON);
  commands.push(FINALIZER, FAVICON);
  canonical = commands.join(" && ");
  data.scripts["apply:prompt-policy"] = canonical;

  const tests = String(data.scripts["test:node"])
    .split(/\s+/)
    .filter(Boolean)
    .filter((entry) => entry !== TEST && entry !== OLD_TEST);
  tests.push(TEST);
  data.scripts["test:node"] = tests.join(" ");
  return `${JSON.stringify(data, null, 2)}\n`;
});

const oldTail =
  "finalize-mobile-hevc-v34\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/";
const newTail =
  "finalize-mobile-hevc-v34\\.mjs && node scripts\\/finalize-mobile-hevc-v35\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/";
for (const name of (await readdir("test")).filter((name) =>
  name.endsWith(".mjs"),
)) {
  await rewrite(`test/${name}`, (source) =>
    source
      .replace(
        /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/embed-favicon-fallback\.mjs"/g,
        JSON.stringify(canonical),
      )
      .split(oldTail)
      .join(newTail),
  );
}

await writeFile(
  ".github/workflows/verify-mobile-video.yml",
  await readFile("scripts/verify-mobile-hevc-v35.yml", "utf8"),
  "utf8",
);

for (const [path, required] of [
  ["src/page.js", `${HEVC}?v=${VERSION}`],
  ["src/page.js", `${H264}?v=${VERSION}`],
  ["public/mobile-video-handoff-v31.js", QUALITY],
  ["public/mobile-video-handoff-v31.js", FALLBACK_QUALITY],
  ["src/copy.js", SHORT_PROMPT],
]) {
  if (!(await readFile(path, "utf8")).includes(required)) {
    throw new Error(`${path} is missing ${required}`);
  }
}

console.log(
  `Finalized ${VERSION}: 1080x1920 HEVC, native 2160x3840 H.264 fallback, and shorter composer copy.`,
);

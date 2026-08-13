import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260813-mobile-video-handoff-v31-1";
const VIDEO_ASSET = "/media/mobile-forest-stream-video-v24-native-1080.mp4";
const CLIENT_ASSET = "/mobile-video-handoff-v31.js";
const FINALIZER = "node scripts/finalize-mobile-video-handoff-v31.mjs";
const TEST_PATH = "test/mobile-video-handoff-v31.test.mjs";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

await update("src/page.js", (source) => {
  let next = source;

  next = next.replace(
    /^\s*<script[^>]*mobile-video-handoff-v31\.js[^>]*><\/script>\s*\n?/gm,
    "",
  );

  const videoPattern = /<video\n\s+id="mobile-background-video"[\s\S]*?<\/video>/;
  const match = next.match(videoPattern);
  if (!match) throw new Error("Could not find the v30 mobile video element.");

  const current = match[0];
  const posterMatch = current.match(/poster="([^"]+)"/);
  if (!posterMatch) throw new Error("The mobile video is missing its poster.");

  const replacement = `<video
      id="mobile-background-video"
      class="mobile-background-video"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
      poster="${posterMatch[1]}"
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
    </video>`;
  next = next.replace(videoPattern, replacement);

  const controller = "/mobile-background-v30.js?v=";
  const controllerIndex = next.indexOf(controller);
  if (controllerIndex < 0) {
    throw new Error("Could not find the v30 controller before the handoff patch.");
  }
  const controllerTagEnd = next.indexOf("</script>", controllerIndex);
  if (controllerTagEnd < 0) throw new Error("The v30 controller tag is incomplete.");
  const insertion = controllerTagEnd + "</script>".length;
  next =
    next.slice(0, insertion) +
    `\n    <script src="${CLIENT_ASSET}?v=${VERSION}"></script>` +
    next.slice(insertion);

  if (next.split(CLIENT_ASSET).length - 1 !== 1) {
    throw new Error("Expected one v31 handoff controller.");
  }
  if (next.split('id="mobile-background-video"').length - 1 !== 1) {
    throw new Error("Expected one mobile video element.");
  }
  if (!next.includes("autoplay\n      muted") || !next.includes('preload="auto"')) {
    throw new Error("The mobile video is not parser-configured for autoplay.");
  }
  if (!next.includes(`${VIDEO_ASSET}?v=${VERSION}`)) {
    throw new Error("The mobile video source is not parser-visible.");
  }

  return next;
});

await update("package.json", (source) => {
  const data = JSON.parse(source);
  const policy = String(data.scripts?.["apply:prompt-policy"] || "");
  if (!policy) throw new Error("package.json is missing apply:prompt-policy.");
  const commands = policy
    .split(" && ")
    .filter((command) => command !== FINALIZER);
  commands.push(FINALIZER);
  data.scripts["apply:prompt-policy"] = commands.join(" && ");

  const nodeTests = String(data.scripts?.["test:node"] || "");
  const tokens = nodeTests.split(/\s+/).filter(Boolean);
  if (!tokens.includes(TEST_PATH)) tokens.push(TEST_PATH);
  data.scripts["test:node"] = tokens.join(" ");
  return `${JSON.stringify(data, null, 2)}\n`;
});

await update("public/_headers", (source) => {
  const start = "# mobile-video-handoff-v31-start";
  const end = "# mobile-video-handoff-v31-end";
  const block = `${start}
/mobile-video-handoff-v31.js
  Content-Type: text/javascript; charset=utf-8
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

console.log(
  `Finalized ${VERSION}: parser-loaded native video plus synchronous iOS gesture recovery.`,
);

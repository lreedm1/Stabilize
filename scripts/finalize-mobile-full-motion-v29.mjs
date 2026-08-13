import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260812-mobile-no-tap-motion-v29-1";
const ATLAS_ASSET =
  "/scenes/mobile-forest-stream-full-atlas-v29-1080.webp";
const CSS_ASSET = "/mobile-full-motion-v29.css";
const CLIENT_ASSET = "/mobile-full-motion-v29.js";

const HEAD_START = "<!-- mobile-full-motion-v29-head-start -->";
const HEAD_END = "<!-- mobile-full-motion-v29-head-end -->";
const CANVAS_START = "<!-- mobile-full-motion-v29-canvas-start -->";
const CANVAS_END = "<!-- mobile-full-motion-v29-canvas-end -->";
const SCRIPT_START = "<!-- mobile-full-motion-v29-script-start -->";
const SCRIPT_END = "<!-- mobile-full-motion-v29-script-end -->";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMarked(source, start, end, replacement) {
  const normalized = `${replacement.trimEnd()}\n`;
  const hasStart = source.includes(start);
  const hasEnd = source.includes(end);
  if (hasStart !== hasEnd) {
    throw new Error(`Incomplete marked block: ${start}`);
  }
  if (!hasStart) return null;
  const pattern = new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*(?:\\n|$)`,
    "g",
  );
  return source.replace(pattern, normalized);
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

const headBlock = `    ${HEAD_START}
    <link
      rel="preload"
      as="image"
      href="${ATLAS_ASSET}?v=${VERSION}"
      type="image/webp"
      fetchpriority="high"
    />
    <link rel="stylesheet" href="${CSS_ASSET}?v=${VERSION}" />
    ${HEAD_END}`;

const canvasBlock = `    ${CANVAS_START}
    <canvas
      id="mobile-full-motion-v29"
      class="mobile-full-motion-v29"
      aria-hidden="true"
    ></canvas>
    ${CANVAS_END}`;

const scriptBlock = `    ${SCRIPT_START}
    <script src="${CLIENT_ASSET}?v=${VERSION}" defer></script>
    ${SCRIPT_END}`;

await update("src/page.js", (source) => {
  let next = source;

  const replacedHead = replaceMarked(next, HEAD_START, HEAD_END, headBlock);
  if (replacedHead === null) {
    const anchor = "  </head>";
    if (!next.includes(anchor)) {
      throw new Error("Could not find the page head insertion point.");
    }
    next = next.replace(anchor, `${headBlock}\n${anchor}`);
  } else {
    next = replacedHead;
  }

  const replacedCanvas = replaceMarked(
    next,
    CANVAS_START,
    CANVAS_END,
    canvasBlock,
  );
  if (replacedCanvas === null) {
    const anchor = "    <canvas\n      id=\"photo-background\"";
    if (!next.includes(anchor)) {
      throw new Error("Could not find the mobile canvas insertion point.");
    }
    next = next.replace(anchor, `${canvasBlock}\n${anchor}`);
  } else {
    next = replacedCanvas;
  }

  const replacedScript = replaceMarked(
    next,
    SCRIPT_START,
    SCRIPT_END,
    scriptBlock,
  );
  if (replacedScript === null) {
    const anchor = "  </body>";
    if (!next.includes(anchor)) {
      throw new Error("Could not find the page script insertion point.");
    }
    next = next.replace(anchor, `${scriptBlock}\n${anchor}`);
  } else {
    next = replacedScript;
  }

  for (const expected of [
    ATLAS_ASSET,
    CSS_ASSET,
    CLIENT_ASSET,
    'id="mobile-full-motion-v29"',
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`Mobile no-tap release is missing ${expected}.`);
    }
  }
  return next;
});

await update("package.json", (source) => {
  const data = JSON.parse(source);
  const testCommand = data.scripts?.["test:node"];
  if (typeof testCommand !== "string") {
    throw new Error("package.json is missing test:node.");
  }
  if (!testCommand.includes("test/mobile-full-motion-v29.test.mjs")) {
    data.scripts["test:node"] = testCommand.replace(
      "test/mobile-autoplay-v27.test.mjs",
      "test/mobile-autoplay-v27.test.mjs test/mobile-full-motion-v29.test.mjs",
    );
  }
  return `${JSON.stringify(data, null, 2)}\n`;
});

console.log(
  `Finalized gesture-free mobile motion ${VERSION} from ${ATLAS_ASSET}.`,
);

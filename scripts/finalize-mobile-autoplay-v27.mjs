import { readFile, writeFile } from "node:fs/promises";

const PAGE_PATH = "src/page.js";
const VERSION = "20260812-mobile-autoplay-v27-1";
const STYLE_HREF = `/mobile-autoplay-v27.css?v=${VERSION}`;
const SCRIPT_SRC = `/mobile-autoplay-v27.js?v=${VERSION}`;
const VIDEO_END = "<!-- selected-mobile-4k-video-v22-end -->";

const before = await readFile(PAGE_PATH, "utf8");
let after = before;

// Remove stale copies before reinserting the release in its canonical places.
after = after.replace(
  /^\s*<link rel="stylesheet" href="\/mobile-autoplay-v27\.css\?v=[^"]+" \/>\n/gm,
  "",
);
after = after.replace(
  /^\s*<script src="\/mobile-autoplay-v27\.js\?v=[^"]+"><\/script>\n/gm,
  "",
);

// v26 requested playback only after the application modules had loaded and
// marked the element as playing before play() had actually succeeded. Replace
// that client with one that runs immediately below the parsed video element.
after = after.replace(
  /^\s*<script type="module" src="\/mobile-orientation-v26\.js\?v=[^"]+"><\/script>\n/gm,
  "",
);

const styleAnchor =
  '    <link rel="stylesheet" href="/mobile-orientation-v26.css?v=20260811-mobile-orientation-v26-1" />';
if (!after.includes(styleAnchor)) {
  throw new Error("Could not find the mobile orientation stylesheet anchor.");
}
after = after.replace(
  styleAnchor,
  `${styleAnchor}\n    <link rel="stylesheet" href="${STYLE_HREF}" />`,
);

const scriptBlock = `    <script src="${SCRIPT_SRC}"></script>`;
if (!after.includes(VIDEO_END)) {
  throw new Error("Could not find the selected mobile video end marker.");
}
after = after.replace(VIDEO_END, `${VIDEO_END}\n${scriptBlock}`);

for (const expected of [STYLE_HREF, SCRIPT_SRC]) {
  const occurrences = after.split(expected).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one ${expected}; found ${occurrences}.`);
  }
}
if (after.includes("/mobile-orientation-v26.js?v=")) {
  throw new Error("The superseded v26 playback client is still referenced.");
}
if (after.indexOf(SCRIPT_SRC) < after.indexOf(VIDEO_END)) {
  throw new Error("The autoplay client must execute after the video is parsed.");
}

if (after !== before) await writeFile(PAGE_PATH, after, "utf8");
console.log("Finalized parser-early mobile autoplay with animated fallback v27.");

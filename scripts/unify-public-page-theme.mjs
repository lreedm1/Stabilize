import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260809-mobile-motion-v16-no-tap-1";
const STATIC_PAGES = [
  "public/about.html",
  "public/floor-first.html",
  "public/how-it-works.html",
  "public/privacy.html",
  "public/safety.html",
  "public/support.html",
  "public/sustainability.html",
];

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Unified public theme could not find ${label}`);
  }
}

function capture(value, pattern, label) {
  const match = value.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Unified public theme could not read ${label}`);
  }
  return match[1].trim();
}

function compactCssValue(value) {
  return value.replace(/\s+/g, " ").trim();
}

const [mainBoxStyles, pageSource, photoTuning] = await Promise.all([
  readFile("public/main-box-white.css", "utf8"),
  readFile("src/page.js", "utf8"),
  readFile("public/photo-tuning.css", "utf8"),
]);

const readingSection = capture(
  mainBoxStyles,
  /\/\* Translucent gray reading surfaces \*\/([\s\S]*)$/,
  "the main reading-surface section",
);
const textColor = capture(
  mainBoxStyles,
  /color:\s*(#[0-9a-f]{6});/i,
  "the main reading text color",
);
const textShadow = capture(
  mainBoxStyles,
  /text-shadow:\s*([^;]+);/,
  "the main reading text shadow",
);
const readingBorder = capture(
  readingSection,
  /border:\s*([^;]+);/,
  "the main reading border",
);
const readingSurface = capture(
  readingSection,
  /background:\s*([^;]+);/,
  "the main reading box color",
);
const readingShadow = capture(
  readingSection,
  /box-shadow:\s*([^;]+);/,
  "the main reading box shadow",
);
const readingFilter = capture(
  readingSection,
  /backdrop-filter:\s*([^;]+);/,
  "the main reading backdrop filter",
);
const codeSurface = capture(
  mainBoxStyles,
  /\.assistant-output pre,[\s\S]*?background:\s*([^;]+);/,
  "the main code box color",
);
const photoOverlay = compactCssValue(
  capture(
    photoTuning,
    /body::before\s*\{\s*background:\s*([\s\S]*?);\s*\}/,
    "the main photographic overlay",
  ),
);

const DESKTOP_1X = "/scenes/lake-valley-landscape-1280.webp";
const DESKTOP_2X = "/scenes/lake-valley-landscape-2560.webp";
const MOBILE_1X = "/scenes/mobile-forest-stream-motion-v16-1440.webp";
const MOBILE_2X = "/scenes/mobile-forest-stream-motion-v16-1440.webp";

for (const [asset, label] of [
  [DESKTOP_1X, "the main desktop background"],
  [DESKTOP_2X, "the high-resolution desktop background"],
  [MOBILE_1X, "the main mobile background"],
  [MOBILE_2X, "the high-resolution mobile background"],
]) {
  requireText(pageSource, asset, label);
}

const guideStyles = `@font-face {
  font-family: "Lexend";
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url("/fonts/lexend-latin-wght-normal.woff2") format("woff2");
}

:root {
  color-scheme: dark;
  --stabilize-reading-text: ${textColor};
  --stabilize-reading-surface: ${readingSurface};
  --stabilize-reading-border: ${readingBorder};
  --stabilize-reading-shadow: ${readingShadow};
  --stabilize-reading-filter: ${readingFilter};
  --stabilize-reading-text-shadow: ${textShadow};
  --stabilize-code-surface: ${codeSurface};
  --stabilize-accent: #1f6f54;
  --stabilize-accent-dark: #164b39;
}

* {
  box-sizing: border-box;
}

html {
  min-height: 100%;
  background: #173f31;
}

body {
  position: relative;
  isolation: isolate;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0;
  overflow-x: hidden;
  background: #173f31;
  color: var(--stabilize-reading-text);
  font-family: "Lexend", system-ui, sans-serif;
  line-height: 1.65;
}

body::before,
body::after {
  position: fixed;
  inset: 0;
  content: "";
  pointer-events: none;
}

body::before {
  z-index: 0;
  background-image: url("${DESKTOP_1X}");
  background-image: image-set(
    url("${DESKTOP_1X}") 1x,
    url("${DESKTOP_2X}") 2x
  );
  background-position: 50% 50%;
  background-repeat: no-repeat;
  background-size: cover;
  filter: saturate(1.24) contrast(1.035) brightness(0.98);
}

body::after {
  z-index: 1;
  background: ${photoOverlay};
}

header,
main,
footer {
  position: relative;
  z-index: 2;
  width: min(780px, calc(100% - 36px));
  margin-inline: auto;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: max(22px, env(safe-area-inset-top)) 0 22px;
}

.brand {
  color: var(--stabilize-reading-text);
  font-size: 1.2rem;
  font-weight: 760;
  text-decoration: none;
  text-shadow: var(--stabilize-reading-text-shadow);
}

nav {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

nav a,
footer a {
  color: var(--stabilize-reading-text);
  font-size: 0.85rem;
  font-weight: 650;
  text-shadow: var(--stabilize-reading-text-shadow);
  text-underline-offset: 0.18em;
}

a:focus-visible,
button:focus-visible {
  outline: 3px solid rgba(255, 254, 248, 0.72);
  outline-offset: 3px;
}

main {
  border: var(--stabilize-reading-border);
  border-radius: 20px;
  background: var(--stabilize-reading-surface);
  box-shadow: var(--stabilize-reading-shadow);
  color: var(--stabilize-reading-text);
  padding: clamp(24px, 6vw, 54px);
  -webkit-backdrop-filter: var(--stabilize-reading-filter);
  backdrop-filter: var(--stabilize-reading-filter);
}

main h1,
main h2,
main h3,
main p,
main li,
main strong,
main a,
main blockquote,
main label {
  color: var(--stabilize-reading-text);
  text-shadow: var(--stabilize-reading-text-shadow);
}

h1 {
  margin: 0 0 18px;
  font-size: clamp(2rem, 6vw, 3.35rem);
  line-height: 1.08;
  letter-spacing: -0.04em;
}

h2 {
  margin: 38px 0 10px;
  font-size: 1.35rem;
  line-height: 1.25;
}

h3 {
  margin: 0 0 8px;
  font-size: 1.05rem;
  line-height: 1.3;
}

p,
li {
  color: var(--stabilize-reading-text);
}

li + li {
  margin-top: 0.45rem;
}

.lede {
  font-size: 1.08rem;
}

pre,
code {
  border-radius: 8px;
  background: var(--stabilize-code-surface);
  color: var(--stabilize-reading-text);
  text-shadow: none;
}

code {
  padding: 0.1em 0.32em;
}

pre {
  overflow-x: auto;
  padding: 14px;
}

pre code {
  background: transparent;
  padding: 0;
}

.notice,
.plan-card {
  border: var(--stabilize-reading-border);
  background: var(--stabilize-reading-surface);
  box-shadow: 0 7px 22px rgba(4, 13, 10, 0.18);
  color: var(--stabilize-reading-text);
  -webkit-backdrop-filter: var(--stabilize-reading-filter);
  backdrop-filter: var(--stabilize-reading-filter);
}

.notice {
  border-left: 4px solid rgba(255, 254, 248, 0.84);
  border-radius: 0 10px 10px 0;
  padding: 14px 16px;
}

.plan-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 18px;
}

.plan-card {
  border-radius: 14px;
  padding: 17px;
}

.plan-card p {
  margin: 0.7rem 0 0;
  font-size: 0.9rem;
  line-height: 1.55;
}

.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.cta {
  display: inline-block;
  margin: 0;
  border: 1px solid rgba(255, 254, 248, 0.78);
  border-radius: 12px;
  background: var(--stabilize-accent);
  color: var(--stabilize-reading-text);
  cursor: pointer;
  padding: 12px 17px;
  font: inherit;
  font-weight: 720;
  line-height: 1.25;
  text-decoration: none;
  text-shadow: 0 1px 5px rgba(3, 20, 14, 0.72);
}

.cta:hover,
.cta:focus-visible {
  background: var(--stabilize-accent-dark);
}

.cta.secondary {
  background: var(--stabilize-reading-surface);
  color: var(--stabilize-reading-text);
  -webkit-backdrop-filter: var(--stabilize-reading-filter);
  backdrop-filter: var(--stabilize-reading-filter);
}

.cta.secondary:hover,
.cta.secondary:focus-visible {
  background: rgba(42, 47, 46, 0.84);
}

.support-form {
  margin-top: 18px;
}

.fine-print {
  max-width: 64ch;
  margin-top: 10px;
  color: var(--stabilize-reading-text);
  font-size: 0.78rem;
}

footer {
  padding: 25px 0 max(45px, env(safe-area-inset-bottom));
  color: var(--stabilize-reading-text);
  font-size: 0.8rem;
  text-shadow: var(--stabilize-reading-text-shadow);
}

@media (max-width: 980px) and (orientation: portrait) {
  body::before {
    background-image: url("${MOBILE_1X}");
    background-image: image-set(
      url("${MOBILE_1X}") 1x,
      url("${MOBILE_2X}") 2x
    );
    background-position: 50% 50%;
    filter: none;
  }
}

@media (max-width: 760px) {
  .plan-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  header {
    align-items: flex-start;
    flex-direction: column;
  }

  main {
    padding: 24px 20px;
  }

  .cta-row,
  .support-form .cta {
    width: 100%;
  }

  .cta-row .cta {
    width: 100%;
    text-align: center;
  }
}

@media (prefers-reduced-transparency: reduce) {
  main,
  .notice,
  .plan-card,
  .cta.secondary {
    background: rgba(42, 47, 46, 0.94);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
`;

await writeFile("public/guides.css", guideStyles);

for (const path of STATIC_PAGES) {
  const before = await readFile(path, "utf8");
  const after = before.replace(
    /href="\/guides\.css(?:\?v=[^"]*)?"/g,
    `href="/guides.css?v=${VERSION}"`,
  );
  requireText(
    after,
    `/guides.css?v=${VERSION}`,
    `${path} theme stylesheet`,
  );
  if (after !== before) await writeFile(path, after);
}

console.log(
  "Unified every Stabilize public page with the chat background and gray-white reading theme.",
);

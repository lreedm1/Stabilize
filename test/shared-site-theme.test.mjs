import test from "node:test";
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
const VERSION = "20260806-unified-site-theme-1";

function capture(value, pattern, label) {
  const match = value.match(pattern);
  assert.ok(match?.[1], `Missing ${label}`);
  return match[1].trim();
}

function compactCssValue(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("all public Stabilize pages share the chat background and reading colors", async () => {
  const [mainBox, pageSource, photoTuning, guides, ...pages] =
    await Promise.all([
      readFile(new URL("../public/main-box-white.css", import.meta.url), "utf8"),
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/photo-tuning.css", import.meta.url), "utf8"),
      readFile(new URL("../public/guides.css", import.meta.url), "utf8"),
      ...STATIC_PAGES.map((path) =>
        readFile(new URL(`../${path}`, import.meta.url), "utf8"),
      ),
    ]);

  const readingSection = capture(
    mainBox,
    /\/\* Translucent gray reading surfaces \*\/([\s\S]*)$/,
    "main reading-surface section",
  );
  const textColor = capture(
    mainBox,
    /color:\s*(#[0-9a-f]{6});/i,
    "main reading text color",
  );
  const surfaceColor = capture(
    readingSection,
    /background:\s*([^;]+);/,
    "main reading box color",
  );
  const border = capture(
    readingSection,
    /border:\s*([^;]+);/,
    "main reading border",
  );
  const shadow = capture(
    readingSection,
    /box-shadow:\s*([^;]+);/,
    "main reading shadow",
  );
  const overlay = compactCssValue(
    capture(
      photoTuning,
      /body::before\s*\{\s*background:\s*([\s\S]*?);\s*\}/,
      "main photo overlay",
    ),
  );

  assert.ok(
    guides.includes(`--stabilize-reading-text: ${textColor};`),
    "guide text color must match the main reading box",
  );
  assert.ok(
    guides.includes(`--stabilize-reading-surface: ${surfaceColor};`),
    "guide box color must match the main reading box",
  );
  assert.ok(
    guides.includes(`--stabilize-reading-border: ${border};`),
    "guide border must match the main reading box",
  );
  assert.ok(
    guides.includes(`--stabilize-reading-shadow: ${shadow};`),
    "guide shadow must match the main reading box",
  );
  assert.ok(
    guides.includes(`background: ${overlay};`),
    "guide photo overlay must match the chat page",
  );

  for (const asset of [
    "/scenes/lake-valley-landscape-1280.webp",
    "/scenes/lake-valley-landscape-2560.webp",
    "/scenes/mobile-golden-alpine-v3-720.webp",
    "/scenes/mobile-golden-alpine-v3-1440.webp",
  ]) {
    assert.ok(pageSource.includes(asset), `Main page is missing ${asset}`);
    assert.ok(guides.includes(asset), `Guide theme is missing ${asset}`);
  }

  assert.match(
    guides,
    /body::before\s*\{[\s\S]*position:[\s\S]*background-image:[\s\S]*lake-valley-landscape/,
  );
  assert.match(
    guides,
    /@media \(max-width: 980px\) and \(orientation: portrait\)[\s\S]*mobile-golden-alpine-v3/,
  );
  assert.match(
    guides,
    /main \{[\s\S]*background:\s*var\(--stabilize-reading-surface\);[\s\S]*color:\s*var\(--stabilize-reading-text\);[\s\S]*backdrop-filter:/,
  );
  assert.match(
    guides,
    /\.notice,[\s\S]*\.plan-card \{[\s\S]*background:\s*var\(--stabilize-reading-surface\);/,
  );
  assert.doesNotMatch(guides, /background:\s*#f4f2ec/);
  assert.doesNotMatch(guides, /background:\s*#fffaf0/);

  for (const [index, html] of pages.entries()) {
    assert.match(
      html,
      new RegExp(
        `href="/guides\\.css\\?v=${VERSION.replaceAll("-", "\\-")}"`,
      ),
      `${STATIC_PAGES[index]} must load the shared themed stylesheet`,
    );
  }
});

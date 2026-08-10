import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260810-ai-enhanced-mobile-4k-v23-1";
const OLD_POSTER_STEM = "mobile-forest-stream-v14-retina-2160";
const POSTER_STEM = "mobile-forest-stream-v23-ai-2160";
const STATIC_PAGES = [
  "public/about.html",
  "public/floor-first.html",
  "public/how-it-works.html",
  "public/privacy.html",
  "public/safety.html",
  "public/support.html",
  "public/sustainability.html",
];

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

for (const path of STATIC_PAGES) {
  await update(path, (source) =>
    source.replace(
      /href="\/guides\.css(?:\?v=[^"]*)?"/g,
      `href="/guides.css?v=${VERSION}"`,
    ),
  );
}

await update("test/shared-site-theme.test.mjs", (source) => {
  const next = source
    .replaceAll(OLD_POSTER_STEM, POSTER_STEM)
    .replace(
      /const VERSION = "[^"]+";/,
      `const VERSION = "${VERSION}";`,
    );

  if (!next.includes(`/scenes/${POSTER_STEM}.webp`)) {
    throw new Error("The shared-theme test does not require the enhanced poster.");
  }
  if (!next.includes(`const VERSION = "${VERSION}";`)) {
    throw new Error("The shared-theme test did not receive the enhanced cache key.");
  }
  return next;
});

console.log(
  `Aligned guide pages and their shared-theme regression with ${POSTER_STEM}.webp.`,
);

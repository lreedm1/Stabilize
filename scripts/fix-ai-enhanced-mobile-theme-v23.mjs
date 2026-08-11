import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260810-ai-enhanced-mobile-4k-v23-1";
const OLD_POSTER_STEM = "mobile-forest-stream-v14-retina-2160";
const POSTER_STEM = "mobile-forest-stream-v23-ai-2160";
const NATIVE_VERSION = "20260810-native-selected-mobile-v24-1";
const NATIVE_POSTER_STEM = "mobile-forest-stream-v24-native-1080";
const selectedMetadata = JSON.parse(
  await readFile(
    new URL("./native-selected-mobile-video-v24.json", import.meta.url),
    "utf8",
  ),
);
const SELECTED_VERSION = String(selectedMetadata.version || NATIVE_VERSION);
const SELECTED_POSTER_STEM = String(selectedMetadata.posterAsset || "")
  .split("/")
  .at(-1)
  ?.replace(/\.webp$/i, "");
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
  await update(path, (source) => {
    const selectedVersion =
      SELECTED_POSTER_STEM && source.includes(SELECTED_POSTER_STEM)
        ? SELECTED_VERSION
        : source.includes(NATIVE_POSTER_STEM)
          ? NATIVE_VERSION
          : VERSION;
    return source.replace(
      /href="\/guides\.css(?:\?v=[^"]*)?"/g,
      `href="/guides.css?v=${selectedVersion}"`,
    );
  });
}

await update("test/shared-site-theme.test.mjs", (source) => {
  // A newer selected-media finalizer may already have materialized the current
  // poster. Preserve that canonical state instead of forcing the regression
  // test backward to the historical v23/v24 asset.
  if (
    SELECTED_POSTER_STEM &&
    source.includes(`/scenes/${SELECTED_POSTER_STEM}.webp`)
  ) {
    const selected = source.replace(
      /const VERSION = "[^"]+";/,
      `const VERSION = "${SELECTED_VERSION}";`,
    );
    if (!selected.includes(`const VERSION = "${SELECTED_VERSION}";`)) {
      throw new Error("The shared-theme test lost the selected cache key.");
    }
    return selected;
  }

  // The v24 native-source finalizer runs after this historical v23 helper, but
  // repeat validation may already have materialized v24. Preserve that newer
  // canonical state instead of treating it as a missing v23 requirement.
  if (source.includes(`/scenes/${NATIVE_POSTER_STEM}.webp`)) {
    const native = source.replace(
      /const VERSION = "[^"]+";/,
      `const VERSION = "${NATIVE_VERSION}";`,
    );
    if (!native.includes(`const VERSION = "${NATIVE_VERSION}";`)) {
      throw new Error("The shared-theme test lost the native cache key.");
    }
    return native;
  }

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
  `Aligned guide pages and their shared-theme regression with the selected mobile poster.`,
);

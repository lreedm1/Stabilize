import { readFile, writeFile } from "node:fs/promises";

const STATIC_ROUTE_PATTERNS = [
  "/*",
  "!/*.css",
  "!/*.js",
  "!/*.mjs",
  "!/*.map",
  "!/*.ico",
  "!/*.png",
  "!/*.jpg",
  "!/*.jpeg",
  "!/*.gif",
  "!/*.webp",
  "!/*.avif",
  "!/*.svg",
  "!/*.woff",
  "!/*.woff2",
  "!/site.webmanifest",
  "!/fonts/*",
  "!/scenes/*",
];

const WORKER_FIRST_BLOCK = `    "run_worker_first": [
${STATIC_ROUTE_PATTERNS.map((pattern) => `      "${pattern}"`).join(",\n")}
    ]`;

const RESPONSIVE_PRELOAD = `    <link
      rel="preload"
      as="image"
      href="/scenes/mobile-golden-alpine-v3-720.webp"
      imagesrcset="
        /scenes/mobile-golden-alpine-v3-720.webp 720w,
        /scenes/mobile-golden-alpine-v3-1080.webp 1080w,
        /scenes/mobile-golden-alpine-v3-1440.webp 1440w,
        /scenes/mobile-golden-alpine-v3-2160.webp 2160w
      "
      imagesizes="100vw"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />`;

const LEGACY_PRELOAD = `    <link
      rel="preload"
      as="image"
      href="/scenes/mobile-golden-alpine-v3-1440.webp"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />`;

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Static-delivery optimization could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("wrangler.jsonc", (source) => {
  if (source.includes(WORKER_FIRST_BLOCK)) return source;
  const updated = source.replace(
    /    "run_worker_first":\s*(?:true|\[[\s\S]*?\])/, 
    WORKER_FIRST_BLOCK,
  );
  requireText(updated, WORKER_FIRST_BLOCK, "the selective Worker-first routes");
  return updated;
});

await update("src/page.js", (source) => {
  if (source.includes('imagesrcset="') && source.includes('imagesizes="100vw"')) {
    return source;
  }
  requireText(source, LEGACY_PRELOAD, "the fixed mobile image preload");
  return source.replace(LEGACY_PRELOAD, RESPONSIVE_PRELOAD);
});

await update("public/_headers", (source) => {
  if (source.includes("Strict-Transport-Security:")) return source;
  requireText(source, "/*\n", "the global static-asset header block");
  return source.replace(
    "/*\n",
    "/*\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n",
  );
});

await update("test/domain.test.mjs", (source) => {
  const legacy = "  assert.equal(config.assets.run_worker_first, true);";
  const replacement = `  assert.deepEqual(config.assets.run_worker_first, [
${STATIC_ROUTE_PATTERNS.map((pattern) => `    "${pattern}"`).join(",\n")}
  ]);`;
  if (source.includes(replacement)) return source;
  requireText(source, legacy, "the Worker-first domain assertion");
  return source.replace(legacy, replacement);
});

await update("test/mobile-quality.test.mjs", (source) => {
  const legacyCount =
    '    assert.equal([...pageSource.matchAll(new RegExp(`${filename} ${width}w`, "g"))].length, 1);';
  const responsiveCount =
    '    assert.equal([...pageSource.matchAll(new RegExp(`${filename} ${width}w`, "g"))].length, 2);';
  const legacyPreloadAssertion =
    '  assert.match(pageSource, /href="\\/scenes\\/mobile-golden-alpine-v3-1440\\.webp"/);';
  const responsiveAssertions = `  assert.match(pageSource, /<link[\\s\\S]*rel="preload"[\\s\\S]*imagesrcset=/);
  assert.match(pageSource, /imagesizes="100vw"/);
  assert.match(pageSource, /href="\\/scenes\\/mobile-golden-alpine-v3-720\\.webp"/);`;

  let updated = source;
  if (!updated.includes(responsiveCount)) {
    requireText(updated, legacyCount, "the mobile image candidate count");
    updated = updated.replace(legacyCount, responsiveCount);
  }
  if (!updated.includes(responsiveAssertions)) {
    requireText(updated, legacyPreloadAssertion, "the fixed preload assertion");
    updated = updated.replace(legacyPreloadAssertion, responsiveAssertions);
  }
  return updated;
});

console.log(
  "Enabled direct static-asset delivery, responsive image preloading, and static HSTS headers.",
);

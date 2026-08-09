import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260809-original-mobile-image-v21-1";
const ORIGINAL_POSTER =
  "/scenes/mobile-forest-stream-v14-retina-2160.webp";
const REPLACEMENT_PREFIX =
  "/scenes/mobile-forest-stream-v20-true-hd-1440";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripMarked(source, start, end) {
  if (!source.includes(start) && !source.includes(end)) return source;
  if (!source.includes(start) || !source.includes(end)) {
    throw new Error(`Incomplete marked block: ${start}`);
  }
  const pattern = new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*(?:\\n|$)`,
    "g",
  );
  return source.replace(pattern, "");
}

await update("src/page.js", (source) => {
  let next = source;
  next = stripMarked(
    next,
    "<!-- mobile-hd-background-v20-preloads-start -->",
    "<!-- mobile-hd-background-v20-preloads-end -->",
  );
  next = stripMarked(
    next,
    "<!-- mobile-hd-background-v20-start -->",
    "<!-- mobile-hd-background-v20-end -->",
  );
  next = stripMarked(
    next,
    "<!-- mobile-hd-background-v20-script-start -->",
    "<!-- mobile-hd-background-v20-script-end -->",
  );
  next = next.replace(
    /mobile-woodland-loop\.css\?v=[^"]+/,
    `mobile-woodland-loop.css?v=${VERSION}`,
  );

  const posterReferences =
    next.split(`${ORIGINAL_POSTER} 2160w`).length - 1;
  if (posterReferences !== 2) {
    throw new Error(
      `Expected two selected-scene poster references, found ${posterReferences}`,
    );
  }
  if (next.includes(REPLACEMENT_PREFIX)) {
    throw new Error("The replacement scene is still referenced by the page.");
  }
  if (next.includes("mobile-hd-background")) {
    throw new Error("The replacement video layer is still present.");
  }
  if (next.split('id="mobile-motion-canvas"').length - 1 !== 1) {
    throw new Error("Expected exactly one original-scene motion canvas.");
  }
  return next;
});

await update("public/mobile-woodland-loop.css", (source) =>
  stripMarked(
    source,
    "/* mobile-hd-background-v20-start */",
    "/* mobile-hd-background-v20-end */",
  ),
);

await update("public/_headers", (source) =>
  stripMarked(
    source,
    "# mobile-hd-background-v20-start",
    "# mobile-hd-background-v20-end",
  ),
);

await update("test/mobile-quality.test.mjs", (source) => {
  let next = stripMarked(
    source,
    "// mobile-hd-background-v20-quality-test-start",
    "// mobile-hd-background-v20-quality-test-end",
  );

  const testStart = "// original-mobile-image-v21-quality-test-start";
  const testEnd = "// original-mobile-image-v21-quality-test-end";
  const testBlock = `${testStart}
test("portrait mobile keeps the selected forest-stream image", async () => {
  const [pageSource, styleSource, clientSource] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-motion-canvas.js", import.meta.url), "utf8"),
  ]);

  assert.equal(
    [...pageSource.matchAll(/mobile-forest-stream-v14-retina-2160\\.webp 2160w/g)]
      .length,
    2,
  );
  assert.match(pageSource, /id="mobile-motion-canvas"/);
  assert.match(pageSource, /mobile-motion-canvas\\.js\\?v=/);
  assert.match(pageSource, /mobile-woodland-loop\\.css\\?v=${VERSION}/);
  assert.doesNotMatch(pageSource, /mobile-hd-background/);
  assert.doesNotMatch(pageSource, /mobile-forest-stream-v20-true-hd-1440/);
  assert.doesNotMatch(pageSource, /mobile-hd-background-v20\\.js/);
  assert.doesNotMatch(styleSource, /mobile-hd-background/);
  assert.match(styleSource, /mobile-motion-canvas-v18-start/);
  assert.match(clientSource, /mobile-forest-stream-water-sprite-v19-hd-1080\\.webp/);
});
${testEnd}`;

  if (next.includes(testStart)) {
    next = stripMarked(next, testStart, testEnd);
  }
  return `${next.trimEnd()}\n\n${testBlock}\n`;
});

console.log(
  `Restored the selected forest-stream mobile scene and removed the replacement video (${VERSION}).`,
);

import { readFile, writeFile } from "node:fs/promises";

const OLD_ASSET =
  "/scenes/mobile-forest-stream-water-sprite-v18-540.webp";
const NEW_ASSET =
  "/scenes/mobile-forest-stream-water-sprite-v19-hd-1080.webp";
const OLD_FILENAME = "mobile-forest-stream-water-sprite-v18-540.webp";
const NEW_FILENAME = "mobile-forest-stream-water-sprite-v19-hd-1080.webp";
const OLD_VERSION_1 = "20260809-mobile-motion-canvas-v18-1";
const OLD_VERSION_2 = "20260809-mobile-motion-canvas-v18-2";
const NEW_VERSION_1 = "20260809-mobile-motion-canvas-v19-hd-1";
const NEW_VERSION_2 = "20260809-mobile-motion-canvas-v19-hd-2";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Could not find ${label}.`);
  }
  return source.replace(before, after);
}

await update("scripts/apply-mobile-motion-canvas-v18.mjs", (source) => {
  let next = source;
  // Replace the exact filename declaration before replacing the asset URL. The
  // filename is a substring of the URL, so doing the broad URL replacement
  // first can make an idempotence check incorrectly conclude that the filename
  // declaration was already upgraded.
  next = replaceRequired(
    next,
    `const SPRITE_FILENAME = "${OLD_FILENAME}";`,
    `const SPRITE_FILENAME = "${NEW_FILENAME}";`,
    "the old water sprite filename declaration",
  );
  next = replaceRequired(
    next,
    `  "${OLD_ASSET}";`,
    `  "${NEW_ASSET}";`,
    "the old water sprite asset declaration",
  );
  next = replaceRequired(
    next,
    "const SPRITE_WIDTH = 3240;",
    "const SPRITE_WIDTH = 2400;",
    "the old sprite atlas width",
  );
  next = replaceRequired(
    next,
    "const SPRITE_HEIGHT = 4800;",
    "const SPRITE_HEIGHT = 6000;",
    "the old sprite atlas height",
  );
  next = replaceRequired(
    next,
    `const VERSION = "${OLD_VERSION_1}";`,
    `const VERSION = "${NEW_VERSION_1}";`,
    "the old canvas release version",
  );
  next = replaceRequired(
    next,
    "assert.ok(sprite.byteLength < 10_000_000);",
    "assert.ok(sprite.byteLength < 12_000_000);",
    "the former sprite size ceiling",
  );
  next = replaceRequired(
    next,
    "mobile-water-sprite-v18-validation-start",
    "mobile-water-sprite-v19-hd-validation-start",
    "the former materializer validation marker",
  );
  next = replaceRequired(
    next,
    "  assert.match(clientSource, /const FRAME_RATE = 6/);",
    `  assert.match(clientSource, /const COMPOSITION_WIDTH = 1080/);
  assert.match(clientSource, /const COMPOSITION_HEIGHT = 1920/);
  assert.match(clientSource, /const FRAME_LEFT = 680/);
  assert.match(clientSource, /const FRAME_TOP = 720/);
  assert.match(clientSource, /const FRAME_WIDTH = 400/);
  assert.match(clientSource, /const FRAME_HEIGHT = 1200/);
  assert.match(clientSource, /const FRAME_RATE = 6/);`,
    "the mobile canvas client assertions",
  );
  next = next.replace(
    "Installed a Retina poster plus automatic canvas water motion for portrait mobile.",
    "Installed a Retina poster plus high-resolution cropped canvas water motion for portrait mobile.",
  );
  return next;
});

await update("scripts/fix-mobile-motion-canvas-v18.mjs", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `const OLD_VERSION = "${OLD_VERSION_1}";`,
    `const OLD_VERSION = "${NEW_VERSION_1}";`,
    "the former visibility-fix input version",
  );
  next = replaceRequired(
    next,
    `const VERSION = "${OLD_VERSION_2}";`,
    `const VERSION = "${NEW_VERSION_2}";`,
    "the former visibility-fix output version",
  );
  return next;
});

await update("public/mobile-motion-canvas.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `const SPRITE_ASSET =
  "${OLD_ASSET}";
const FRAME_WIDTH = 540;
const FRAME_HEIGHT = 960;`,
    `const SPRITE_ASSET =
  "${NEW_ASSET}";
const COMPOSITION_WIDTH = 1080;
const COMPOSITION_HEIGHT = 1920;
const FRAME_LEFT = 680;
const FRAME_TOP = 720;
const FRAME_WIDTH = 400;
const FRAME_HEIGHT = 1200;`,
    "the low-resolution canvas frame constants",
  );

  next = replaceRequired(
    next,
    `  const scale = Math.max(cssWidth / FRAME_WIDTH, cssHeight / FRAME_HEIGHT);
  const destinationWidth = FRAME_WIDTH * scale;
  const destinationHeight = FRAME_HEIGHT * scale;
  const destinationX = (cssWidth - destinationWidth) / 2;
  const destinationY = (cssHeight - destinationHeight) / 2;`,
    `  // Match the centered object-fit: cover geometry used by the Retina poster,
  // then place the cropped moving-water frame back into that composition.
  const scale = Math.max(
    cssWidth / COMPOSITION_WIDTH,
    cssHeight / COMPOSITION_HEIGHT,
  );
  const compositionWidth = COMPOSITION_WIDTH * scale;
  const compositionHeight = COMPOSITION_HEIGHT * scale;
  const compositionX = (cssWidth - compositionWidth) / 2;
  const compositionY = (cssHeight - compositionHeight) / 2;
  const destinationWidth = FRAME_WIDTH * scale;
  const destinationHeight = FRAME_HEIGHT * scale;
  const destinationX = compositionX + FRAME_LEFT * scale;
  const destinationY = compositionY + FRAME_TOP * scale;`,
    "the low-resolution full-frame destination geometry",
  );
  return next;
});

// The existing production workflow already derives and checksum-verifies the
// exact sprite selected by the page, then confirms changing visible pixels in
// mobile WebKit. Keep generated visual output out of .github/workflows so the
// branch can be published by the intentionally workflow-scoped Actions token.

console.log(
  "Upgraded portrait-mobile water motion from a scaled 540p full-frame atlas to a 1080p-source cropped HD atlas.",
);

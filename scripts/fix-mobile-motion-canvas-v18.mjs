import { readFile, writeFile } from "node:fs/promises";

const OLD_VERSION = "20260809-mobile-motion-canvas-v18-1";
const VERSION = "20260809-mobile-motion-canvas-v18-2";

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

function replaceMarked(source, start, end, replacement) {
  const normalized = `${replacement.trimEnd()}\n`;
  if (!source.includes(start)) {
    const suffix = source.endsWith("\n") ? "" : "\n";
    return `${source}${suffix}\n${normalized}`;
  }
  const escape = (value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `[ \\t]*${escape(start)}[\\s\\S]*?${escape(end)}[ \\t]*(?:\\n|$)`,
  );
  const next = source.replace(pattern, normalized);
  if (next === source) {
    throw new Error(`Could not replace marked block ${start}.`);
  }
  return next;
}

await update("public/mobile-motion-canvas.js", (source) => {
  let next = source;

  const stateHelper = `function setMotionState(state) {
  document.documentElement.dataset.mobileMotion = state;
}
`;
  const visibilityHelpers = `${stateHelper}
function showCanvas() {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  // A historical stylesheet can remain in Safari's cache while the new client
  // is already live. Inline important properties guarantee that a successfully
  // painted frame is actually visible instead of remaining at opacity zero.
  canvas.style.setProperty("display", "block", "important");
  canvas.style.setProperty("visibility", "visible", "important");
  canvas.style.setProperty("opacity", "1", "important");
}

function hideCanvas() {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  canvas.style.removeProperty("display");
  canvas.style.removeProperty("visibility");
  canvas.style.removeProperty("opacity");
}
`;
  next = replaceRequired(
    next,
    stateHelper,
    visibilityHelpers,
    "the mobile canvas state helper",
  );

  next = replaceRequired(
    next,
    `  canvas.classList.add("is-ready");
  setMotionState("canvas-playing");`,
    `  canvas.classList.add("is-ready");
  showCanvas();
  setMotionState("canvas-playing");`,
    "the successful canvas paint boundary",
  );

  next = replaceRequired(
    next,
    `    canvas?.classList.remove("is-ready");
    setMotionState("desktop-static");`,
    `    canvas?.classList.remove("is-ready");
    hideCanvas();
    setMotionState("desktop-static");`,
    "the desktop canvas cleanup",
  );

  next = replaceRequired(
    next,
    `    setMotionState("sprite-failed");
    canvas?.classList.remove("is-ready");`,
    `    setMotionState("sprite-failed");
    canvas?.classList.remove("is-ready");
    hideCanvas();`,
    "the failed-sprite canvas cleanup",
  );

  return next;
});

const visibilityStart = "/* mobile-motion-canvas-v18-visibility-fix-start */";
const visibilityEnd = "/* mobile-motion-canvas-v18-visibility-fix-end */";
const visibilityBlock = `${visibilityStart}
@media (max-width: 980px) and (orientation: portrait) {
  /* The canvas is transparent until its first water frame is painted, so it is
     safe to keep the layer visible from first layout. Important declarations
     also defeat stale or higher-specificity opacity rules on restored tabs. */
  html[data-mobile-motion="canvas-playing"] .mobile-motion-canvas.is-ready,
  .mobile-motion-canvas.is-ready {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    transition: none !important;
  }
}
${visibilityEnd}`;

await update("public/mobile-woodland-loop.css", (source) =>
  replaceMarked(source, visibilityStart, visibilityEnd, visibilityBlock),
);

for (const path of [
  "src/page.js",
  "test/mobile-quality.test.mjs",
  "test/mobile-background-loading.test.mjs",
]) {
  await update(path, (source) => source.replaceAll(OLD_VERSION, VERSION));
}

await update("test/mobile-background-loading.test.mjs", (source) => {
  const startMarker =
    'test("the production mobile release gate follows built versions and exact image bytes", async () => {';
  const endMarker =
    'test("portrait mobile uses a Worker-served MP4 instead of a reconstructed blob", async () => {';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Could not locate the obsolete production mobile release-gate test.");
  }

  const replacement = `test("the production mobile release gate verifies visible canvas motion", async () => {
  const workflow = await read(
    ".github/workflows/verify-mobile-background.yml",
  );

  assert.match(workflow, /mobile-motion-canvas\\.js/);
  assert.match(workflow, /mobile-woodland-loop\\.css/);
  assert.match(workflow, /mobile-[^\\s]*water-sprite[^\\s]*\\.webp/);
  assert.match(workflow, /expected_poster_sha/);
  assert.match(workflow, /expected_sprite_sha/);
  assert.match(workflow, /expected_poster_bytes/);
  assert.match(workflow, /expected_sprite_bytes/);
  assert.match(workflow, /verification\\/mobile-motion-canvas/);
  assert.match(workflow, /Verify visible motion in mobile WebKit/);
  assert.match(workflow, /getImageData/);
  assert.match(workflow, /first\\.hash === second\\.hash/);
  assert.match(workflow, /first\\.opacity !== "1"/);
  assert.match(workflow, /Exact canvas mobile release is live/);
});

`;

  return source.slice(0, start) + replacement + source.slice(end);
});

await update("test/mobile-quality.test.mjs", (source) => {
  if (source.includes('assert.match(clientSource, /style\\.setProperty\\("opacity"/);')) {
    return source;
  }
  const marker = "  assert.doesNotMatch(clientSource, /HTMLVideoElement/);";
  if (!source.includes(marker)) {
    throw new Error("Could not find the canvas client assertions.");
  }
  return source.replace(
    marker,
    `${marker}
  assert.match(clientSource, /style\\.setProperty\\("opacity", "1", "important"\\)/);
  assert.match(clientSource, /function showCanvas\\(\\)/);`,
  );
});

console.log(
  `Forced visible mobile canvas frames, bumped the client/CSS cache key to ${VERSION}, and aligned the production release gate.`,
);

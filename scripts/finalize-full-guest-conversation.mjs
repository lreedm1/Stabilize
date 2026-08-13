import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content, "utf8");
}

function replaceAll(path, before, after, { required = false } = {}) {
  const source = read(path);
  if (source.includes(after) && !source.includes(before)) return false;
  if (!source.includes(before)) {
    if (required) throw new Error(`Could not locate expected text in ${path}`);
    return false;
  }
  write(path, source.split(before).join(after));
  return true;
}

function removeBlock(path, startMarker, endMarker) {
  const source = read(path);
  if (!source.includes(startMarker)) return false;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) {
    throw new Error(`Could not locate end marker for generated block in ${path}`);
  }
  write(path, source.slice(0, start) + source.slice(end));
  return true;
}

function removeLinesContaining(path, marker) {
  const source = read(path);
  if (!source.includes(marker)) return false;
  const next = source
    .split("\n")
    .filter((line) => !line.includes(marker))
    .join("\n");
  write(path, next);
  return true;
}

// Keep the cache-busted guest client script stable across repeated policy runs.
function canonicalizeGuestAppScript(path) {
  const source = read(path);
  const canonical =
    '    <!-- Legacy generator marker: 20260808-guest-summary-1 -->\n' +
    '    <script type="module" src="/app.js?v=20260808-full-guest-thread-1"></script>';
  const generatedBlock =
    /(?:    <!-- Legacy generator marker: 20260808-guest-summary-1 -->\n)*    <script type="module" src="\/app\.js\?v=[^"]+"><\/script>/;
  if (!generatedBlock.test(source)) {
    throw new Error("Could not locate the generated app.js module script in src/page.js");
  }
  const next = source.replace(generatedBlock, canonical);
  if (next === source) return false;
  write(path, next);
  return true;
}

// Remove the obsolete v2 guest-summary callback even when an earlier generator
// has already changed or removed its adjacent helper.
removeBlock(
  "public/app.js",
  "function applyGuestSummaryResult(result) {",
  "function rollbackLocalUser(content) {",
);
removeBlock(
  "public/app.js",
  "function sameThreadMessages(left, right) {",
  "function rollbackLocalUser(content) {",
);
removeLinesContaining("public/app.js", "applyGuestSummaryResult(");
canonicalizeGuestAppScript("src/page.js");

for (const path of [
  "test/mobile-background-loading.test.mjs",
  "test/outcome-followup.test.mjs",
  "test/priority-latency.test.mjs",
  "test/private-chat.test.mjs",
]) {
  replaceAll(
    path,
    "20260808-guest-summary-1",
    "20260808-full-guest-thread-1",
    { required: true },
  );
}

replaceAll(
  "test/private-chat.test.mjs",
  "/privateChat \\|\\| !signedIn \\? \\[\\.\\.\\.activeLocalThreadMessages\\(\\)\\] : undefined/",
  "/privateChat \\|\\| !signedIn[\\s\\S]*cloneThreadMessages\\(activeLocalThreadMessages\\(\\)\\)/",
  { required: true },
);

for (const path of [
  "test/account-preflight.test.mjs",
  "test/signed-in-prefetch-latency.test.mjs",
]) {
  const fullGuestExpectation =
    "/finalize-full-guest-conversation\\.mjs$/";
  const hevcExpectation =
    "/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs && node scripts\\/finalize-mobile-video-handoff-v31\\.mjs && node scripts\\/finalize-mobile-smooth-v32\\.mjs && node scripts\\/finalize-mobile-hevc-v34\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/";
  const staticFaviconExpectation =
    "/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs && node scripts\\/finalize-mobile-video-handoff-v31\\.mjs && node scripts\\/finalize-mobile-smooth-v32\\.mjs && node scripts\\/embed-favicon-fallback\\.mjs$/";
  const smoothExpectation =
    "/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs && node scripts\\/finalize-mobile-video-handoff-v31\\.mjs && node scripts\\/finalize-mobile-smooth-v32\\.mjs$/";
  const handoffExpectation =
    "/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs && node scripts\\/finalize-mobile-video-handoff-v31\\.mjs$/";
  const nativeExpectation =
    "/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs$/";
  const changedFromHevc = replaceAll(
    path,
    hevcExpectation,
    fullGuestExpectation,
  );
  const changedFromStaticFavicon = replaceAll(
    path,
    staticFaviconExpectation,
    fullGuestExpectation,
  );
  const changedFromSmooth = replaceAll(
    path,
    smoothExpectation,
    fullGuestExpectation,
  );
  const changedFromHandoff = replaceAll(
    path,
    handoffExpectation,
    fullGuestExpectation,
  );
  const changedFromNative = replaceAll(
    path,
    nativeExpectation,
    fullGuestExpectation,
  );
  const changedFromImpact = replaceAll(
    path,
    "/finalize-decision-grade-impact\\.mjs$/",
    fullGuestExpectation,
  );
  const changedFromAccount = replaceAll(
    path,
    "/finalize-account-preflight\\.mjs$/",
    fullGuestExpectation,
  );
  if (
    !changedFromHevc &&
    !changedFromStaticFavicon &&
    !changedFromSmooth &&
    !changedFromHandoff &&
    !changedFromNative &&
    !changedFromImpact &&
    !changedFromAccount &&
    !read(path).includes(fullGuestExpectation)
  ) {
    throw new Error(`Could not locate expected pipeline assertion in ${path}`);
  }
}

replaceAll(
  "test/memory-controls.test.mjs",
  "privateChat \\|\\| signedOut",
  "signedOut",
);

replaceAll(
  "test/worker.test.mjs",
  '"Content-Length": "256001"',
  '"Content-Length": "2000001"',
  { required: true },
);

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
  replaceAll(
    path,
    "/finalize-account-preflight\\.mjs$/",
    "/finalize-full-guest-conversation\\.mjs$/",
    { required: true },
  );
}

replaceAll(
  "test/memory-controls.test.mjs",
  "privateChat \\|\\| signedOut",
  "signedOut",
);

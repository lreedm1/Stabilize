import { readdir, readFile, writeFile } from "node:fs/promises";

const VERSION = "20260812-mobile-no-tap-v28-1";
const FINALIZER_COMMAND =
  "node scripts/finalize-mobile-no-tap-v28.mjs";
const TEST_PATH = "test/mobile-no-tap-v28.test.mjs";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function removeAssetTag(source, assetPattern) {
  const pattern = new RegExp(
    `^[ \\t]*<(?:link|script)[^>\\n]*${assetPattern}[^>\\n]*>(?:</script>)?[ \\t]*\\n?`,
    "gm",
  );
  return source.replace(pattern, "");
}

const packagePath = "package.json";
const packageData = JSON.parse(await readFile(packagePath, "utf8"));
const policy = packageData.scripts?.["apply:prompt-policy"];
if (typeof policy !== "string" || !policy.trim()) {
  throw new Error("package.json is missing apply:prompt-policy");
}

const commands = policy
  .split(" && ")
  .filter((command) => command !== FINALIZER_COMMAND);
commands.push(FINALIZER_COMMAND);
const canonicalPolicy = commands.join(" && ");
packageData.scripts["apply:prompt-policy"] = canonicalPolicy;

const nodeTests = String(packageData.scripts?.["test:node"] || "");
if (!nodeTests.includes(TEST_PATH)) {
  const anchor = "test/mobile-quality.test.mjs";
  if (!nodeTests.includes(anchor)) {
    throw new Error("Could not find the mobile test insertion point.");
  }
  packageData.scripts["test:node"] = nodeTests.replace(
    anchor,
    `${anchor} ${TEST_PATH}`,
  );
}
await writeFile(packagePath, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");

await update("src/page.js", (source) => {
  let next = source;

  for (const asset of [
    "mobile-orientation-v26\\.css",
    "mobile-autoplay-v27\\.css",
    "mobile-no-tap-v28\\.css",
    "mobile-orientation-v26\\.js",
    "mobile-autoplay-v27\\.js",
    "mobile-no-tap-v28\\.js",
  ]) {
    next = removeAssetTag(next, asset);
  }

  const headAnchor = "  </head>";
  if (!next.includes(headAnchor)) {
    throw new Error("Could not find the page head insertion point.");
  }
  next = next.replace(
    headAnchor,
    `    <link rel="stylesheet" href="/mobile-no-tap-v28.css?v=${VERSION}" />\n${headAnchor}`,
  );

  const videoEnd = "    <!-- selected-mobile-4k-video-v22-end -->";
  if (!next.includes(videoEnd)) {
    throw new Error("Could not find the parsed-video script insertion point.");
  }
  next = next.replace(
    videoEnd,
    `${videoEnd}\n    <script src="/mobile-no-tap-v28.js?v=${VERSION}"></script>`,
  );

  const cssCount = next.split("/mobile-no-tap-v28.css").length - 1;
  const jsCount = next.split("/mobile-no-tap-v28.js").length - 1;
  if (cssCount !== 1 || jsCount !== 1) {
    throw new Error(`Unexpected v28 asset counts: css=${cssCount}, js=${jsCount}`);
  }
  if (
    next.includes("/mobile-orientation-v26.js") ||
    next.includes("/mobile-autoplay-v27.js") ||
    next.includes("/mobile-orientation-v26.css") ||
    next.includes("/mobile-autoplay-v27.css")
  ) {
    throw new Error("A superseded mobile startup asset remains in the page.");
  }

  return next;
});

const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*"/g;
const oldTail =
  "/finalize-native-selected-mobile-v24-regressions\\.mjs$/";
const newTail =
  "/finalize-native-selected-mobile-v24-regressions\\.mjs && node scripts\\/finalize-mobile-no-tap-v28\\.mjs$/";
const duplicateV28 =
  "node scripts/finalize-mobile-no-tap-v28.mjs && node scripts/finalize-mobile-no-tap-v28.mjs";

const testNames = (await readdir("test"))
  .filter((name) => name.endsWith(".mjs"))
  .sort();
for (const name of testNames) {
  const path = `test/${name}`;
  await update(path, (source) => {
    let next = source.replace(commandLiteralPattern, JSON.stringify(canonicalPolicy));
    next = next.replaceAll(oldTail, newTail);
    while (next.includes(duplicateV28)) {
      next = next.replaceAll(
        duplicateV28,
        "node scripts/finalize-mobile-no-tap-v28.mjs",
      );
    }
    return next;
  });
}

console.log(
  `Finalized no-tap mobile layering with ${VERSION}; animated canvas remains visible until a decoded video frame is playing.`,
);

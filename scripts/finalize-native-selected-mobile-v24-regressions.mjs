import { readdir, readFile, writeFile } from "node:fs/promises";

const NATIVE_FINALIZER =
  "node scripts/finalize-native-selected-mobile-v24.mjs";
const REGRESSION_FINALIZER =
  "node scripts/finalize-native-selected-mobile-v24-regressions.mjs";
const VERSION = "20260810-native-selected-mobile-v24-1";
const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v24-native-1080.webp";
const POSTER_NAME = "mobile-forest-stream-v24-native-1080";
const NATIVE_TAIL =
  "node scripts/finalize-decision-grade-impact.mjs && " +
  `${NATIVE_FINALIZER} && ${REGRESSION_FINALIZER}`;

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

const packagePath = "package.json";
const packageData = JSON.parse(await readFile(packagePath, "utf8"));
const policy = packageData.scripts?.["apply:prompt-policy"];
if (typeof policy !== "string" || !policy.trim()) {
  throw new Error("package.json is missing apply:prompt-policy");
}

const canonicalPolicy = [
  ...policy
    .split(" && ")
    .filter(
      (command) =>
        command !== NATIVE_FINALIZER && command !== REGRESSION_FINALIZER,
    ),
  NATIVE_FINALIZER,
  REGRESSION_FINALIZER,
].join(" && ");
packageData.scripts["apply:prompt-policy"] = canonicalPolicy;
await writeFile(packagePath, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");

// Several focused regression tests intentionally pin the complete generator
// chain. Keep those literals and tail assertions aligned after older
// generators rebuild them.
const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/finalize-decision-grade-impact\.mjs[^"\n]*"/g;
const oldDecisionTail =
  "/finalize-decision-grade-impact\\.mjs$/";
const newDecisionTail =
  "/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs$/";
const oldClientTail =
  "/apply-client-response-time\\.mjs && node scripts\\/finalize-decision-grade-impact\\.mjs$/";
const newClientTail =
  "/apply-client-response-time\\.mjs && node scripts\\/finalize-decision-grade-impact\\.mjs && node scripts\\/finalize-native-selected-mobile-v24\\.mjs && node scripts\\/finalize-native-selected-mobile-v24-regressions\\.mjs$/";
const testNames = (await readdir("test"))
  .filter((name) => name.endsWith(".mjs"))
  .sort();

for (const name of testNames) {
  await update(`test/${name}`, (source) =>
    source
      .replace(commandLiteralPattern, JSON.stringify(canonicalPolicy))
      .replaceAll(oldClientTail, newClientTail)
      .replaceAll(oldDecisionTail, newDecisionTail),
  );
}

await update("test/mobile-background-loading.test.mjs", (source) =>
  source.replace(
    "/finalize-native-selected-mobile-v24\\.mjs$/",
    "/finalize-native-selected-mobile-v24-regressions\\.mjs$/",
  ),
);

await update("test/shared-site-theme.test.mjs", (source) =>
  source
    .replace(
      /^const VERSION = "[^"]+";/m,
      `const VERSION = "${VERSION}";`,
    )
    .replaceAll(
      "/scenes/mobile-forest-stream-v23-ai-2160.webp",
      POSTER_ASSET,
    )
    .replaceAll(
      "/scenes/mobile-forest-stream-v14-retina-2160.webp",
      POSTER_ASSET,
    )
    .replaceAll("mobile-forest-stream-v23-ai-2160", POSTER_NAME)
    .replaceAll("mobile-forest-stream-v14-retina-2160", POSTER_NAME),
);

// The older v23 selector performs one intentionally broad source-label
// replacement. Collapse any repetition it creates before the clean-tree gate.
await update("public/mobile-quality.js", (source) => {
  let next = source;
  while (
    next.includes(
      "selected-forest-stream-native-source-native-source",
    )
  ) {
    next = next.replaceAll(
      "selected-forest-stream-native-source-native-source",
      "selected-forest-stream-native-source",
    );
  }
  return next;
});

// The historical canvas workflow used to prove that no video existed. The
// native release intentionally keeps the canvas as a fallback beneath one
// visible video element, so the fallback gate must verify coexistence instead.
await update(".github/workflows/verify-mobile-background.yml", (source) =>
  source
    .replaceAll(
      "&& ! grep -Fq 'id=\"mobile-background-video\"' \"$tmpdir/live.html\" \\",
      "&& grep -Fq 'id=\"mobile-background-video\"' \"$tmpdir/live.html\" \\",
    )
    .replaceAll(
      "&& ! grep -Fq 'mobile-quality.js' \"$tmpdir/live.html\" \\",
      "&& grep -Fq 'mobile-quality.js' \"$tmpdir/live.html\" \\",
    )
    .replaceAll(
      "if (first.videoCount !== 0 || second.videoCount !== 0) {",
      "if (first.videoCount !== 1 || second.videoCount !== 1) {",
    )
    .replaceAll(
      'throw new Error("A tap-gated background video is still present.");',
      'throw new Error("The native background video is missing or duplicated.");',
    )
    .replaceAll(
      "Production serves the exact Retina-poster plus canvas-motion release.",
      "Production serves the native video with its exact canvas fallback.",
    ),
);

if (!canonicalPolicy.endsWith(NATIVE_TAIL)) {
  throw new Error("The native finalizers are not the canonical policy tail.");
}

console.log(
  "Finalized repeatable native mobile media policy and regression alignment.",
);

import { readdir, readFile, writeFile } from "node:fs/promises";

const NATIVE_FINALIZER =
  "node scripts/finalize-native-selected-mobile-v24.mjs";
const REGRESSION_FINALIZER =
  "node scripts/finalize-native-selected-mobile-v24-regressions.mjs";
const VERSION = "20260810-native-selected-mobile-v24-1";
const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v24-native-1080.webp";
const OLD_POSTER_ASSETS = [
  "/scenes/mobile-forest-stream-v23-ai-2160.webp",
  "/scenes/mobile-forest-stream-v14-retina-2160.webp",
];

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

const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/finalize-decision-grade-impact\.mjs[^"\n]*"/g;
const testNames = (await readdir("test"))
  .filter((name) => name.endsWith(".mjs"))
  .sort();

for (const name of testNames) {
  await update(`test/${name}`, (source) => {
    let next = source.replace(
      commandLiteralPattern,
      JSON.stringify(canonicalPolicy),
    );
    next = next.replaceAll(
      /finalize-native-selected-mobile-v24\\\.mjs\$\//g,
      /finalize-native-selected-mobile-v24-regressions\\.mjs$\//,
    );
    return next;
  });
}

await update("test/mobile-background-loading.test.mjs", (source) =>
  source
    .replace(
      /finalize-native-selected-mobile-v24\\\.mjs\$\//g,
      "finalize-native-selected-mobile-v24-regressions\\\\.mjs$/",
    )
    .replace(
      /finalize-native-selected-mobile-v24\\\.mjs\$/g,
      "finalize-native-selected-mobile-v24-regressions\\\\.mjs$",
    ),
);

await update("test/shared-site-theme.test.mjs", (source) => {
  let next = source.replace(
    /^const VERSION = "[^"]+";/m,
    `const VERSION = "${VERSION}";`,
  );
  for (const oldAsset of OLD_POSTER_ASSETS) {
    next = next.split(oldAsset).join(POSTER_ASSET);
    next = next
      .split(oldAsset.slice(1).replaceAll(".", "\\."))
      .join(POSTER_ASSET.slice(1).replaceAll(".", "\\."));
  }
  next = next
    .replaceAll("mobile-forest-stream-v23-ai-2160", "mobile-forest-stream-v24-native-1080")
    .replaceAll("mobile-forest-stream-v14-retina-2160", "mobile-forest-stream-v24-native-1080");
  return next;
});

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

console.log(
  "Finalized repeatable native mobile media policy and regression alignment.",
);

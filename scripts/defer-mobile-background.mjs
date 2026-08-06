import { readFile, writeFile } from "node:fs/promises";

const ASSET_VERSION = "20260806-static-mobile-background-1";
const LEGACY_IMPORT =
  'import { modulateTerrain } from "./terrain.js";';
const LOADER_IMPORT =
  `import { modulateTerrain } from "./background-loader.js?v=${ASSET_VERSION}";`;

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Mobile background deferral could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("public/app.js", (source) => {
  if (source.includes(LOADER_IMPORT)) return source;
  requireText(source, LEGACY_IMPORT, "the direct terrain import");
  return source.replace(LEGACY_IMPORT, LOADER_IMPORT);
});

await update("src/page.js", (source) => {
  const text = source.replace(
    /\/app\.js\?v=[A-Za-z0-9._-]+/g,
    `/app.js?v=${ASSET_VERSION}`,
  );
  requireText(
    text,
    `/app.js?v=${ASSET_VERSION}`,
    "the versioned application script",
  );
  return text;
});

await update("test/ui.test.mjs", (source) => {
  const legacyAssertion = String.raw`  assert.match(clientScript, /import \{ modulateTerrain \} from "\.\/terrain\.js"/);`;
  const loaderAssertion = String.raw`  assert.match(
    clientScript,
    /import \{ modulateTerrain \} from "\.\/background-loader\.js\?v=20260806-static-mobile-background-1"/,
  );`;

  if (source.includes(loaderAssertion)) return source;
  requireText(source, legacyAssertion, "the terrain import regression assertion");
  return source.replace(legacyAssertion, loaderAssertion);
});

console.log(
  "Deferred interactive backgrounds and kept mobile clients on the static image path.",
);

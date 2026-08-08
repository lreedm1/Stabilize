import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("mobile clients keep the static image without loading the graphics module chain", async () => {
  const [appSource, loaderSource, pageSource, packageSource] =
    await Promise.all([
      read("public/app.js"),
      read("public/background-loader.js"),
      read("src/page.js"),
      read("package.json"),
    ]);

  assert.doesNotMatch(
    appSource,
    /import \{ modulateTerrain \} from "\.\/terrain\.js"/,
  );
  assert.match(
    appSource,
    /import \{ modulateTerrain \} from "\.\/background-loader\.js\?v=20260807-priority-latency-1"/,
  );
  assert.doesNotMatch(
    loaderSource,
    /from ["']\.\/(?:terrain|photo-scene)\.js["']/,
  );
  assert.match(loaderSource, /import\("\.\/terrain\.js"\)/);
  assert.match(
    loaderSource,
    /\(max-width: 980px\) and \(orientation: portrait\)/,
  );
  assert.match(loaderSource, /\(hover: none\) and \(pointer: coarse\)/);
  assert.match(loaderSource, /prefers-reduced-motion: reduce/);
  assert.match(loaderSource, /navigator\?\.connection\?\.saveData/);
  assert.match(loaderSource, /requestIdleCallback/);
  assert.match(loaderSource, /let modulationScheduled = false/);
  assert.match(loaderSource, /function scheduleTerrainModulation\(\)/);
  assert.match(loaderSource, /requestAnimationFrame\(runAfterPaint\)/);
  assert.match(loaderSource, /setTimeout\(applyLatestTerrainValue, 0\)/);
  assert.match(
    loaderSource,
    /export function modulateTerrain\(value\) \{[\s\S]*scheduleTerrainModulation\(\);[\s\S]*return null;/,
  );
  assert.match(pageSource, /\/app\.js\?v=20260808-signed-in-prefetch-1/);

  const config = JSON.parse(packageSource);
  assert.equal(
    config.scripts["apply:prompt-policy"],
    "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs && node scripts/apply-signed-in-context-prefetch.mjs && node scripts/apply-signed-in-context-prefetch.mjs",
  );

  const loader = await import(
    `${new URL("../public/background-loader.js", import.meta.url).href}?test=static-mobile`
  );
  const staticMobile = {
    matchMedia: () => ({ matches: true }),
    navigator: { connection: { saveData: false } },
  };
  const desktop = {
    matchMedia: () => ({ matches: false }),
    navigator: { connection: { saveData: false } },
  };
  const dataSaver = {
    matchMedia: () => ({ matches: false }),
    navigator: { connection: { saveData: true } },
  };

  assert.equal(loader.shouldLoadInteractiveBackground(staticMobile), false);
  assert.equal(loader.shouldLoadInteractiveBackground(desktop), true);
  assert.equal(loader.shouldLoadInteractiveBackground(dataSaver), false);
});
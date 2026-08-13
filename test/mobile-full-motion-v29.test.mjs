import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const VERSION = "20260812-mobile-no-tap-motion-v29-1";
const ASSET = "mobile-forest-stream-full-atlas-v29-1080.webp";

test("mobile full-scene motion starts without a media gesture", async () => {
  const [page, client, styles, metadataSource, atlas, regressionFinalizer] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-full-motion-v29.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-full-motion-v29.css", import.meta.url), "utf8"),
      readFile(new URL("../scripts/mobile-full-motion-v29.json", import.meta.url), "utf8"),
      readFile(new URL(`../public/scenes/${ASSET}`, import.meta.url)),
      readFile(
        new URL(
          "../scripts/finalize-native-selected-mobile-v24-regressions.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  const metadata = JSON.parse(metadataSource);
  assert.equal(metadata.version, VERSION);
  assert.equal(metadata.width, 4320);
  assert.equal(metadata.height, 3840);
  assert.equal(metadata.frameWidth, 1080);
  assert.equal(metadata.frameHeight, 1920);
  assert.equal(metadata.frameCount, 8);
  assert.equal(metadata.fps, 8);
  assert.equal(atlas.byteLength, metadata.bytes);
  assert.equal(atlas.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(atlas.subarray(8, 12).toString("ascii"), "WEBP");
  assert.equal(createHash("sha256").update(atlas).digest("hex"), metadata.sha256);

  assert.match(page, /id="mobile-full-motion-v29"/);
  assert.match(
    page,
    new RegExp(`/scenes/${ASSET}\\?v=${VERSION}`),
  );
  assert.match(
    page,
    new RegExp(`/mobile-full-motion-v29\\.css\\?v=${VERSION}`),
  );
  assert.match(
    page,
    new RegExp(`/mobile-full-motion-v29\\.js\\?v=${VERSION}`),
  );

  assert.match(client, new RegExp(ASSET.replaceAll(".", "\\.")));
  assert.match(client, /requestAnimationFrame\(step\)/);
  assert.match(client, /setTimeout\(\(\) =>/);
  assert.match(client, /context\.drawImage\(/);
  assert.match(client, /legacyVideo\.pause\(\)/);
  assert.doesNotMatch(client, /touchstart|pointerdown|keydown/);
  assert.doesNotMatch(client, /\.play\(\)/);

  assert.match(
    styles,
    /#mobile-background-video[\s\S]*display: none !important;/,
  );
  assert.match(
    styles,
    /data-mobile-no-tap-motion="playing"[\s\S]*#mobile-full-motion-v29/,
  );
  assert.match(
    regressionFinalizer,
    /await import\("\.\/finalize-mobile-full-motion-v29\.mjs"\)/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const VERSION = "20260812-mobile-no-tap-v28-1";

test("mobile motion is visible before a tap and video replaces it only after a decoded frame", async () => {
  const [page, client, styles, packageSource, finalizer] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-no-tap-v28.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-no-tap-v28.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/finalize-mobile-no-tap-v28.mjs", import.meta.url),
      "utf8",
    ),
  ]);

  const videoEnd = page.indexOf("<!-- selected-mobile-4k-video-v22-end -->");
  const earlyClient = page.indexOf(`/mobile-no-tap-v28.js?v=${VERSION}`);
  const appClient = page.indexOf("/app.js?v=");
  const v28Styles = page.indexOf(`/mobile-no-tap-v28.css?v=${VERSION}`);
  const headEnd = page.indexOf("</head>");

  assert.ok(videoEnd >= 0);
  assert.ok(earlyClient > videoEnd, "no-tap client runs after video parsing");
  assert.ok(earlyClient < appClient, "no-tap client runs before application modules");
  assert.ok(v28Styles >= 0 && v28Styles < headEnd);
  assert.doesNotMatch(page, /mobile-orientation-v26\.(?:css|js)\?v=/);
  assert.doesNotMatch(page, /mobile-autoplay-v27\.(?:css|js)\?v=/);

  assert.match(client, /video\.defaultMuted = true/);
  assert.match(client, /video\.setAttribute\("webkit-playsinline", "true"\)/);
  assert.match(client, /requestVideoFrameCallback/);
  assert.match(client, /canvas\.style\.setProperty\("opacity", "1", "important"\)/);
  assert.match(client, /video\.style\.setProperty\("opacity", "0", "important"\)/);
  assert.match(client, /video\.style\.setProperty\("opacity", "1", "important"\)/);
  assert.match(client, /attemptPlayback\(\);\s*\}\)\(\);/);

  assert.match(
    styles,
    /html:not\(\[data-mobile-no-tap-v28="playing"\]\) #mobile-motion-canvas/,
  );
  assert.match(
    styles,
    /#mobile-background-video[\s\S]*visibility: hidden !important;[\s\S]*opacity: 0 !important;/,
  );
  assert.match(
    styles,
    /data-mobile-no-tap-v28="playing"[\s\S]*#mobile-background-video[\s\S]*visibility: visible !important;/,
  );

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /finalize-native-selected-mobile-v24-regressions\.mjs && node scripts\/finalize-mobile-no-tap-v28\.mjs$/,
  );
  assert.match(packageJson.scripts["test:node"], /mobile-no-tap-v28\.test\.mjs/);
  assert.match(finalizer, /mobile-autoplay-v27\\\.js/);
  assert.match(finalizer, /selected-mobile-4k-video-v22-end/);
});

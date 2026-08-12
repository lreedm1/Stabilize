import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const VERSION = "20260812-mobile-autoplay-v28-1";

test("mobile autoplay keeps the video render-visible before the first tap", async () => {
  const [page, client, styles, finalizer] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-autoplay-v27.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-autoplay-v27.css", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/finalize-mobile-autoplay-v27.mjs", import.meta.url),
      "utf8",
    ),
  ]);

  const videoEnd = page.indexOf("<!-- selected-mobile-4k-video-v22-end -->");
  const earlyClient = page.indexOf(`/mobile-autoplay-v27.js?v=${VERSION}`);
  const appClient = page.indexOf("/app.js?v=");

  assert.ok(videoEnd >= 0);
  assert.ok(earlyClient > videoEnd, "autoplay client runs after video parsing");
  assert.ok(earlyClient < appClient, "autoplay client runs before application modules");
  assert.match(page, new RegExp(`/mobile-autoplay-v27\\.css\\?v=${VERSION}`));
  assert.doesNotMatch(page, /mobile-orientation-v26\.js\?v=/);

  assert.match(client, /video\.defaultMuted = true/);
  assert.match(client, /video\.setAttribute\("webkit-playsinline", "true"\)/);
  assert.match(client, /\["playing", "timeupdate"\]/);
  assert.match(client, /video\.addEventListener\(event, markPlaying\)/);
  assert.match(client, /markFallback\("blocked", error\)/);
  assert.doesNotMatch(
    client,
    /classList\.add\("is-playing"\)[\s\S]{0,120}await video\.play\(\)/,
  );

  assert.match(styles, /data-mobile-autoplay-v28/);
  assert.match(
    styles,
    /#mobile-background-video[\s\S]*visibility: visible !important;[\s\S]*opacity: 1 !important;/,
  );
  assert.doesNotMatch(
    styles,
    /not\(\[data-mobile-autoplay-v28="playing"\]\)[\s\S]{0,500}#mobile-background-video[\s\S]{0,300}visibility: hidden/,
  );
  assert.match(
    styles,
    /not\(\[data-mobile-autoplay-v28="playing"\]\)[\s\S]*#mobile-motion-canvas/,
  );

  assert.match(finalizer, /mobile-orientation-v26\.js/);
  assert.match(finalizer, /selected-mobile-4k-video-v22-end/);
});

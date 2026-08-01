import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("a content-sized output stays above the compact bottom composer", async () => {
  const [clientScript, styles, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(clientScript, /quickActions|data-prompt|showComposer/);
  assert.doesNotMatch(
    styles,
    /data-view="(?:thinking|response)"[^{}]*\.chat-form[^{]*\{[^}]*display:\s*none/,
  );
  assert.match(
    styles,
    /\.conversation-surface\s*{[\s\S]*display:\s*grid;[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/,
  );
  assert.match(
    styles,
    /\.composer-dock\s*{[\s\S]*grid-row:\s*2;[\s\S]*align-self:\s*end;[\s\S]*width:\s*min\(760px,\s*100%\);[\s\S]*margin-inline:\s*auto;/,
  );
  assert.match(styles, /textarea\s*{[\s\S]*border:\s*1px solid/);
  assert.match(styles, /textarea\s*{[\s\S]*height:\s*64px;[\s\S]*resize:\s*none;/);
  assert.doesNotMatch(
    styles,
    /data-view="compose"[^}]*chat-log[^{]*\{[^}]*display:\s*none/,
  );
  assert.match(pageSource, /id="chat-log"[\s\S]*aria-atomic="true"[\s\S]*hidden/);
  assert.doesNotMatch(pageSource, /intro-output/);
  assert.doesNotMatch(clientScript, /introDismissed|followupPlaceholder/);
  assert.doesNotMatch(clientScript, /reset-button|resetChat/);
});

test("thinking is replaced with the latest Markdown reply", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(clientScript, /import \{ renderMarkdown \} from "\.\/markdown\.js"/);
  assert.match(clientScript, /function showOutput[\s\S]*chatLog\.replaceChildren\(\)/);
  assert.match(clientScript, /showOutput\(copy\.thinking, "thinking-output", "thinking"\)/);
  assert.match(clientScript, /article\.appendChild\(renderMarkdown\(content\)\)/);
  assert.match(clientScript, /JSON\.stringify\(\{ message: clean, awaitingSafetyAnswer \}\)/);
  assert.match(clientScript, /function requestErrorMessage/);
  assert.match(clientScript, /input\.value = clean/);
  assert.match(clientScript, /result\.reference/);
  assert.match(clientScript, /copy\.errorReferenceLabel/);
  assert.match(clientScript, /"error-output"/);
  assert.doesNotMatch(clientScript, /addMessage|user-message|messages\.push/);
  assert.doesNotMatch(clientScript, /innerHTML\s*=/);
});

test("the site does not expose a remembered-context deletion control", async () => {
  const [clientScript, styles, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(clientScript, /forgetMemory|\/api\/session/);
  assert.doesNotMatch(styles, /forget-memory/);
  assert.doesNotMatch(pageSource, /forget-memory|forgetMemory/);
});

test("the terrain background is token-modulated and motion-aware", async () => {
  const [clientScript, terrainScript, photoScript, styles, pageSource] =
    await Promise.all([
      readFile(new URL("../public/app.js", import.meta.url), "utf8"),
      readFile(new URL("../public/terrain.js", import.meta.url), "utf8"),
      readFile(new URL("../public/photo-scene.js", import.meta.url), "utf8"),
      readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    ]);

  assert.match(clientScript, /import \{ modulateTerrain \} from "\.\/terrain\.js"/);
  assert.match(clientScript, /modulateTerrain\(clean\)/);
  assert.match(clientScript, /modulateTerrain\(reply\)/);
  assert.match(terrainScript, /continentalness/);
  assert.match(terrainScript, /erosion/);
  assert.match(terrainScript, /ridgedNoise/);
  assert.match(terrainScript, /drawLake/);
  assert.match(terrainScript, /drawValleyBanks/);
  assert.match(terrainScript, /drawClouds/);
  assert.match(terrainScript, /drawMountainDetail/);
  assert.match(terrainScript, /drawFarForest/);
  assert.match(terrainScript, /drawShorelineDetails/);
  assert.match(terrainScript, /prefers-reduced-motion: reduce/);
  assert.match(terrainScript, /document\.hidden/);
  assert.doesNotMatch(terrainScript, /Math\.random/);
  assert.match(terrainScript, /createPhotoScene/);
  assert.match(terrainScript, /#photo-backdrop-image/);
  assert.match(terrainScript, /backdropReady \|\| animatedPhotoReady/);
  assert.match(terrainScript, /terrain\?\.setActive\(!photoReady\)/);
  assert.match(photoScript, /u_image_size/);
  assert.match(photoScript, /float water/);
  assert.match(photoScript, /depthPixels/);
  assert.match(photoScript, /fogNoise/);
  assert.match(photoScript, /rippleStrength/);
  assert.match(photoScript, /TARGET_FRAME_MS/);
  assert.match(photoScript, /document\.hidden/);
  assert.doesNotMatch(photoScript, /Math\.random/);
  assert.match(
    styles,
    /\.terrain-background\s*{[\s\S]*position:\s*fixed;[\s\S]*pointer-events:\s*none;/,
  );
  assert.match(styles, /\.terrain-fallback\s*{[\s\S]*filter:\s*saturate\(1\.24\)/);
  assert.match(
    styles,
    /\.photo-backdrop\s*{[\s\S]*position:\s*fixed;[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;/,
  );
  assert.match(
    styles,
    /\.photo-backdrop img\s*{[\s\S]*object-fit:\s*cover;[\s\S]*object-position:\s*center;/,
  );
  assert.match(styles, /\.photo-background\s*{[\s\S]*filter:\s*saturate\(1\.06\)/);
  assert.match(styles, /\.photo-background\.is-ready\s*{[\s\S]*opacity:\s*1/);
  assert.match(pageSource, /id="terrain-background"[\s\S]*aria-hidden="true"/);
  assert.match(pageSource, /id="photo-backdrop"[\s\S]*aria-hidden="true"/);
  assert.match(pageSource, /id="photo-backdrop-image"/);
  assert.match(pageSource, /lake-valley-portrait-720\.webp 720w/);
  assert.match(pageSource, /lake-valley-portrait-2160\.webp 2160w/);
  assert.match(pageSource, /lake-valley-landscape-1280\.webp 1280w/);
  assert.match(pageSource, /lake-valley-landscape-3840\.webp 3840w/);
  assert.match(pageSource, /id="photo-background"[\s\S]*aria-hidden="true"/);
  const reducedMotionStyles = styles.slice(
    styles.indexOf("@media (prefers-reduced-motion: reduce)"),
  );
  assert.doesNotMatch(reducedMotionStyles, /\.photo-backdrop/);
  assert.match(
    styles,
    /\.chat-card\s*{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/,
  );
  assert.match(styles, /--reading-surface:\s*rgba\(255,\s*252,\s*242,\s*0\.92\)/);
  assert.match(
    styles,
    /\.assistant-output\s*{[\s\S]*width:\s*fit-content;[\s\S]*max-width:\s*min\(65ch,\s*100%\);[\s\S]*background:\s*var\(--reading-surface\);[\s\S]*line-height:\s*1\.68;/,
  );
  assert.match(styles, /--composer-surface:\s*rgba\(255,\s*255,\s*252,\s*0\.5\)/);
  assert.match(
    styles,
    /textarea\s*{[\s\S]*background:\s*var\(--composer-surface\);[\s\S]*color:\s*var\(--text\);[\s\S]*opacity:\s*1;/,
  );
});

test("the page has no audio or separate immediate-danger shortcut", async () => {
  const [clientScript, styles, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(clientScript, /nature-sounds|AudioContext|soundToggle|soundVolume/);
  assert.doesNotMatch(clientScript, /dangerButton|showEmergency|emergencyPanel/);
  assert.doesNotMatch(pageSource, /sound-toggle|sound-volume|sound-controls/);
  assert.doesNotMatch(pageSource, /danger-button|emergency-panel|emergency-actions/);
  assert.doesNotMatch(styles, /\.sound-|#sound-|\.volume-control/);
  assert.doesNotMatch(styles, /\.danger-button|\.emergency-panel|\.emergency-actions/);
  await assert.rejects(
    readFile(new URL("../public/nature-sounds.js", import.meta.url), "utf8"),
    { code: "ENOENT" },
  );
});

test("Lexend is self-hosted and the response uses a single reading surface", async () => {
  const [styles, font, license] = await Promise.all([
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../public/fonts/lexend-latin-wght-normal.woff2",
        import.meta.url,
      ),
    ),
    readFile(new URL("../public/fonts/OFL.txt", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /@font-face[\s\S]*font-family:\s*"Lexend"/);
  assert.match(styles, /font-family:\s*"Lexend", ui-sans-serif/);
  assert.match(styles, /\.assistant-output\s*{[\s\S]*max-width:\s*min\(65ch,\s*100%\);/);
  assert.doesNotMatch(styles, /\.assistant-message|\.user-message/);
  assert.equal(font.subarray(0, 4).toString("ascii"), "wOF2");
  assert.ok(font.byteLength > 30_000);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(license, /Lexend Project Authors/);
});

test("layout fills the dynamic viewport without a fixed-width shell", async () => {
  const styles = await readFile(
    new URL("../public/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /\.page-shell\s*{[\s\S]*?width:\s*100%;/);
  assert.match(styles, /\.page-shell\s*{[\s\S]*?height:\s*100dvh;/);
  assert.match(styles, /\.page-shell\s*{[\s\S]*?min-height:\s*100dvh;/);
  assert.match(styles, /\.page-shell\s*{[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.chat-card\s*{[\s\S]*?flex:\s*1 1 auto;/);
  assert.match(styles, /\.chat-card\s*{[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.chat-card\s*{[\s\S]*?padding:\s*0;/);
  assert.match(styles, /\.chat-log\s*{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  const pageShellRule = styles.match(/\.page-shell\s*{([\s\S]*?)}\s*/)?.[1] || "";
  assert.doesNotMatch(pageShellRule, /width:\s*min\(/);
});

test("privacy detail stays behind a compact Info disclosure", async () => {
  const [styles, pageSource, copySource] = await Promise.all([
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/copy.js", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /<details class="info-disclosure">/);
  assert.match(pageSource, /<summary>\$\{escapeHtml\(page\.chat\.infoLabel\)}<\/summary>/);
  assert.match(pageSource, /page\.chat\.supportNote/);
  assert.match(pageSource, /page\.chat\.infoDetails/);
  assert.match(copySource, /supportNote:[\s\S]*not emergency care/i);
  assert.match(copySource, /infoDetails:[\s\S]*remembered for 30 days/i);
  assert.match(styles, /\.info-popover\s*{[\s\S]*position:\s*absolute;/);
});

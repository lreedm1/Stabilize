import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COPY } from "../src/copy.js";
import { renderPage } from "../src/page.js";

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
  assert.match(
    clientScript,
    /JSON\.stringify\(\{[\s\S]*message: clean,[\s\S]*awaitingSafetyAnswer,[\s\S]*continuity: requestContinuity,/,
  );
  assert.match(clientScript, /function requestErrorMessage/);
  assert.match(clientScript, /input\.value = clean/);
  assert.match(clientScript, /result\.reference/);
  assert.match(clientScript, /copy\.errorReferenceLabel/);
  assert.match(clientScript, /"error-output"/);
  assert.doesNotMatch(clientScript, /addMessage|user-message|messages\.push/);
  assert.doesNotMatch(clientScript, /innerHTML\s*=/);
});

test("chat requests and successful responses stay bound to rendered continuity", async () => {
  const [clientScript, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /<template id="continuity-state">\$\{continuityData\}<\/template>/);
  assert.match(pageSource, /CONTINUITY_TOKEN_PATTERN/);
  assert.match(pageSource, /\{ mode: "guest", token: null \}/);
  assert.match(pageSource, /\{ mode: "account", token: String\(requestedContinuity\.token\) \}/);
  assert.match(clientScript, /const continuityState = renderedContinuity\(\)/);
  assert.match(clientScript, /continuity: requestContinuity/);
  assert.match(
    clientScript,
    /response\.status === 409 && result\.reload === true[\s\S]*reloadForContinuityChange\(\{ clearStored: true \}\)/,
  );

  const sendStart = clientScript.indexOf("async function sendMessage");
  const sendEnd = clientScript.indexOf('form.addEventListener("submit"', sendStart);
  const sendSource = clientScript.slice(sendStart, sendEnd);
  const continuityCheck = sendSource.indexOf(
    "sameContinuity(responseContinuity, requestContinuity)",
  );
  const replyRender = sendSource.indexOf('showOutput(reply, "", "response"');
  assert.ok(continuityCheck >= 0);
  assert.ok(replyRender > continuityCheck);
});

test("browser state is account-partitioned and stale authenticated pages reload", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(clientScript, /LAST_ANSWER_STORAGE_PREFIX/);
  assert.match(clientScript, /function continuityStorageKey/);
  assert.match(clientScript, /state\.mode === "account" \? `account:\$\{state\.token\}` : "guest"/);
  assert.match(clientScript, /continuity: continuityState/);
  assert.match(clientScript, /sameContinuity\(recordContinuity, continuityState\)/);
  assert.match(clientScript, /key !== currentKey/);
  assert.match(clientScript, /new BroadcastChannel\(CONTINUITY_CHANNEL_NAME\)/);
  assert.match(clientScript, /function continuityMessage\(value\)/);
  assert.match(clientScript, /typed \? value\.continuity : value/);
  assert.match(clientScript, /type: typed \? value\.type : "state"/);
  assert.match(
    clientScript,
    /postMessage\(\{[\s\S]*type: "state",[\s\S]*continuity: continuityState,[\s\S]*\}\)/,
  );
  assert.match(
    clientScript,
    /continuityState\.mode === "account" &&[\s\S]*!sameContinuity\(otherContinuity, continuityState\)/,
  );
  assert.match(clientScript, /reloadForContinuityChange\(\{ clearStored: true \}\)/);
  assert.match(
    clientScript,
    /window\.addEventListener\("pagehide",[\s\S]*event\.persisted && continuityState\.mode === "account"[\s\S]*hideForContinuityReload\(\)/,
  );
  assert.match(
    clientScript,
    /window\.addEventListener\("pageshow",[\s\S]*event\.persisted && continuityState\.mode === "account"[\s\S]*reloadForContinuityChange\(\{ clearStored: true \}\)/,
  );
});

test("signed-in users can explicitly delete remembered conversation data", async () => {
  const [clientScript, styles, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.match(clientScript, /form\[action="\/account\/memory\/delete"\]/);
  assert.match(clientScript, /deleteMemoryForm\.addEventListener\("submit"/);
  assert.match(clientScript, /window\.confirm\(copy\.deleteMemoryConfirm\)/);
  assert.match(styles, /auth-session/);
  assert.match(pageSource, /action="\/account\/memory\/delete" method="post"/);
  assert.match(pageSource, /page\.auth\.forgetMemory/);

  const token = "a".repeat(43);
  const signedInPage = renderPage({
    signedIn: true,
    continuity: { mode: "account", token },
    memoryDeletionConfirmed: true,
  });
  assert.match(
    signedInPage,
    new RegExp(
      `action="/account/memory/delete" method="post"[\\s\\S]*name="continuity" value="${token}"`,
    ),
  );
  assert.match(
    signedInPage,
    /<template id="memory-deletion-state">\{&quot;confirmed&quot;:true\}<\/template>/,
  );
  assert.match(clientScript, /memoryDeletionTemplate/);
  assert.doesNotMatch(
    clientScript,
    /location\.search[\s\S]*memory["']?\)\s*===\s*["']deleted/,
  );

  assert.match(clientScript, /type: "memory-deleted"/);
  assert.match(
    clientScript,
    /message\.type === "memory-deleted"[\s\S]*continuityState\.mode === "account"[\s\S]*sameContinuity\(message\.continuity, continuityState\)[\s\S]*reloadForContinuityChange\(\{ clearStored: true \}\)/,
  );
  assert.match(
    clientScript,
    /memoryDeletionConfirmed[\s\S]*clearAllPersistedAnswers\(\);[\s\S]*startContinuityChannel\(\);[\s\S]*memoryDeletionConfirmed[\s\S]*postMessage\(\{[\s\S]*type: "memory-deleted",[\s\S]*continuity: continuityState/,
  );
  assert.match(COPY.page.auth.memoryDeleted, /Local remembered text was erased/i);
  assert.match(COPY.page.auth.memoryDeleted, /cleanup will continue/i);
  assert.match(COPY.page.auth.memorySessionChanged, /Nothing was deleted/i);
});

test("privacy discloses feedback rate limiting without claiming the alias is public", async () => {
  const privacyPage = await readFile(
    new URL("../public/privacy.html", import.meta.url),
    "utf8",
  );

  assert.match(
    privacyPage,
    /privacy-preserving[\s\S]*account alias is temporarily used in a separate Durable Object to[\s\S]*enforce the feedback rate limit/i,
  );
  assert.match(privacyPage, /rate-limit state is not included[\s\S]*public feedback file/i);
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
  assert.match(
    copySource,
    /infoDetails:[\s\S]*does not use IP addresses for memory or application logs/i,
  );
  assert.match(styles, /\.info-popover\s*{[\s\S]*position:\s*absolute;/);
});

test("Google account controls stay compact and guest chat remains visible", async () => {
  const [styles, pageSource] = await Promise.all([
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /class="google-sign-in" href="\/auth\/google"/);
  assert.match(pageSource, /action="\/auth\/logout" method="post"/);
  assert.match(pageSource, /page\.auth\.signedIn/);
  assert.match(pageSource, /id="chat-form" class="chat-form"/);
  assert.match(styles, /\.auth-actions\s*{[\s\S]*justify-content:\s*flex-end;/);
  assert.match(styles, /\.google-sign-in,[\s\S]*\.auth-link\s*{/);
  assert.doesNotMatch(pageSource, /disabled[^>]*id="message-input"/);
});

test("the application never reads or stores a connecting-address alias", async () => {
  const [workerSource, memorySource] = await Promise.all([
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/session-memory.js", import.meta.url), "utf8"),
  ]);
  const runtimeSource = workerSource + "\n" + memorySource;

  assert.doesNotMatch(runtimeSource, /CF-Connecting-IP/);
  assert.doesNotMatch(runtimeSource, /ipAlias|last_ip_alias|network alias/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COPY } from "../src/copy.js";
import { renderPage } from "../src/page.js";
import { createContinuityValidationGate } from "../public/continuity-guard.js";

test("only a validation started after the latest hide can reveal continuity UI", () => {
  const gate = createContinuityValidationGate();
  const firstCheck = gate.snapshot();

  gate.invalidate();
  const secondCheck = gate.snapshot();

  assert.equal(gate.isCurrent(firstCheck), false);
  assert.equal(gate.isCurrent(secondCheck), true);
});

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
    /JSON\.stringify\(\{[\s\S]*message: clean,[\s\S]*awaitingSafetyAnswer: currentAwaitingSafetyAnswer\(\),[\s\S]*continuity: requestContinuity,/,
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
  assert.match(pageSource, /requestedContinuity\?\.mode === "guest"/);
  assert.match(pageSource, /\{ mode: "guest", token: String\(requestedContinuity\.token\) \}/);
  assert.match(pageSource, /\{ mode: "account", token: String\(requestedContinuity\.token\) \}/);
  assert.match(clientScript, /const continuityState = renderedContinuity\(\)/);
  assert.match(clientScript, /continuity: requestContinuity/);
  assert.match(
    clientScript,
    /response\.status === 409 && result\.reload === true[\s\S]*clearPersistedAnswer\(requestContinuity\)[\s\S]*reloadForContinuityChange\(\)/,
  );
  assert.match(
    clientScript,
    /async function resetGuestSession\(continuity, grant\)[\s\S]*continuity\?\.mode !== "guest"[\s\S]*!continuity\.token[\s\S]*typeof grant !== "string"[\s\S]*!grant[\s\S]*grant\.length > 4_096/,
  );
  assert.match(
    clientScript,
    /fetch\("\/guest\/session\/reset", \{[\s\S]*method: "POST"[\s\S]*Content-Type": "application\/x-www-form-urlencoded"[\s\S]*new URLSearchParams\(\{ continuity: continuity\.token, grant \}\)[\s\S]*credentials: "same-origin"[\s\S]*cache: "no-store"/,
  );
  assert.match(
    clientScript,
    /response\.status === 409 && result\.reload === true[\s\S]*result\.resetGuest === true[\s\S]*resetGuestSession\([\s\S]*requestContinuity,[\s\S]*result\.guestResetGrant,[\s\S]*\)[\s\S]*reloadForContinuityChange\(\)/,
  );
  assert.equal(
    (clientScript.match(/resetGuestSession\(/g) || []).length,
    2,
    "guest reset must be defined once and called only from the terminal 409 path",
  );

  const guestToken = "g".repeat(43);
  const guestPage = renderPage({
    signedIn: false,
    continuity: { mode: "guest", token: guestToken },
  });
  assert.match(
    guestPage,
    new RegExp(
      `id="continuity-state">\\{&quot;mode&quot;:&quot;guest&quot;,&quot;token&quot;:&quot;${guestToken}&quot;\\}<\\/template>`,
    ),
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

test("a newer same-token tab update permanently suppresses a deferred successful response", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(
    clientScript,
    /window\.addEventListener\("storage"[\s\S]*continuityStorageKey\(\),[\s\S]*deletionPendingStorageKey\(\),[\s\S]*\.includes\(event\.key\)[\s\S]*activeRequestController\?\.abort\(\)[\s\S]*hideContinuitySurface\(\)/,
  );

  const pendingStart = clientScript.indexOf("function deletionIsPending");
  const pendingEnd = clientScript.indexOf("function showClientNotice", pendingStart);
  const pendingSource = clientScript.slice(pendingStart, pendingEnd);
  const deletionIsPending = Function(
    "localStorage",
    "deletionPendingStorageKey",
    `${pendingSource}; return deletionIsPending;`,
  )(
    {
      getItem() {
        return String(Date.now() - 31 * 24 * 60 * 60 * 1000);
      },
    },
    () => "stabilize:memory-delete-pending:v1:guest:test",
  );
  assert.equal(
    deletionIsPending({ mode: "guest", token: "g".repeat(43) }),
    true,
    "a marker older than 24 hours must still suppress cached and in-flight replies",
  );
  assert.doesNotMatch(
    pendingSource,
    /Date\.now|const age|savedAt|MAX_AGE|24 \* 60/,
  );

  const sendStart = clientScript.indexOf("async function sendMessage");
  const sendEnd = clientScript.indexOf('form.addEventListener("submit"', sendStart);
  const sendSource = clientScript.slice(sendStart, sendEnd);
  const continuityCheck = sendSource.indexOf(
    "sameContinuity(responseContinuity, requestContinuity)",
  );
  const deletionCheck = sendSource.indexOf(
    "deletionIsPending(requestContinuity)",
  );
  const abortedCheck = sendSource.indexOf(
    "requestController.signal.aborted",
    continuityCheck,
  );
  const replyRender = sendSource.indexOf('showOutput(reply, "", "response"');
  const replyPersist = sendSource.indexOf(
    "persistLatestAnswer(reply, route, needsSafetyAnswer)",
  );

  assert.ok(continuityCheck >= 0);
  assert.ok(abortedCheck > continuityCheck);
  assert.ok(deletionCheck > continuityCheck);
  assert.ok(deletionCheck > abortedCheck);
  assert.ok(replyRender > deletionCheck);
  assert.ok(replyPersist > replyRender);
  assert.match(
    sendSource,
    /if \(requestController\.signal\.aborted\) \{[\s\S]*hideForContinuityReload\(\);[\s\S]*return;[\s\S]*if \(deletionIsPending/,
  );
  assert.match(
    sendSource,
    /if \(deletionIsPending\(requestContinuity\)\) \{[\s\S]*hideForContinuityReload\(\);[\s\S]*return;[\s\S]*const reply/,
  );
});

test("token-bound guest and account pages hide and revalidate before showing stale content", async () => {
  const [clientScript, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.match(clientScript, /LAST_ANSWER_STORAGE_PREFIX/);
  assert.match(clientScript, /function continuityStorageKey/);
  assert.match(clientScript, /`\$\{state\.mode\}:\$\{state\.token \|\| "legacy"\}`/);
  assert.match(clientScript, /async function revalidateContinuity/);
  assert.match(clientScript, /continuityValidationGate\.invalidate\(\)/);
  assert.match(
    clientScript,
    /const validationEpoch = continuityValidationGate\.snapshot\(\)/,
  );
  assert.match(
    clientScript,
    /continuityValidationGate\.isCurrent\(validationEpoch\)/,
  );
  assert.match(clientScript, /fetch\("\/api\/auth"/);
  assert.match(clientScript, /cache: "no-store"/);
  assert.match(clientScript, /credentials: "same-origin"/);
  assert.match(
    clientScript,
    /result\.signedIn === true && currentContinuity\?\.mode === "account"[\s\S]*result\.signedIn === false && currentContinuity\?\.mode === "guest"/,
  );
  assert.match(
    clientScript,
    /!sameContinuity\(currentContinuity, continuityState\)[\s\S]*clearPersistedAnswer\(\);[\s\S]*reloadForContinuityChange\(\)/,
  );
  assert.match(clientScript, /showClientNotice\(copy\.sessionCheckFailed, "session-check"\)/);
  assert.match(pageSource, /id="client-notice"[\s\S]*role="status"/);
  assert.match(clientScript, /window\.addEventListener\("blur", hideContinuitySurface\)/);
  assert.match(clientScript, /document\.addEventListener\("visibilitychange"/);
  assert.match(
    clientScript,
    /window\.addEventListener\("pagehide", \(\) => \{[\s\S]*?hideContinuitySurface\(\);[\s\S]*?\}\);/,
  );
  assert.match(
    clientScript,
    /window\.addEventListener\("pageshow", \(event\) => \{[\s\S]*?continuityState\.token !== null[\s\S]*?hideContinuitySurface\(\);[\s\S]*?revalidateContinuity\(\);/,
  );
  assert.match(clientScript, /window\.addEventListener\("focus"/);
  assert.match(clientScript, /new BroadcastChannel\(CONTINUITY_CHANNEL_NAME\)/);
  assert.match(
    clientScript,
    /if \(!message \|\| continuityState\.token === null\) return/,
  );
  assert.match(
    clientScript,
    /sameContinuity\(otherContinuity, continuityState\)[\s\S]*hideContinuitySurface\(\);[\s\S]*revalidateContinuity\(\)/,
  );
  assert.match(
    clientScript,
    /window\.addEventListener\("storage"[\s\S]*event\.storageArea !== localStorage[\s\S]*continuityStorageKey\(\),[\s\S]*deletionPendingStorageKey\(\),[\s\S]*\.includes\(event\.key\)[\s\S]*hideContinuitySurface\(\);[\s\S]*revalidateContinuity\(\)/,
  );
});

test("guests and signed-in users can explicitly delete remembered conversation data", async () => {
  const [clientScript, styles, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.match(clientScript, /form\[action\$="\/memory\/delete"\]/);
  assert.match(clientScript, /deleteMemoryForm\.addEventListener\("submit"/);
  assert.match(clientScript, /window\.confirm\(copy\.deleteMemoryConfirm\)/);
  assert.match(
    clientScript,
    /DELETION_PENDING_STORAGE_PREFIX =\s*"stabilize:memory-delete-pending:v1:"/,
  );
  assert.doesNotMatch(clientScript, /DELETION_PENDING_MAX_AGE_MS/);
  assert.match(
    clientScript,
    /async function sendMessage[\s\S]*if \(deletionIsPending\(\)\) \{[\s\S]*hideForContinuityReload\(\);[\s\S]*showClientNotice\(copy\.deletionPending[\s\S]*return;[\s\S]*fetch\("\/api\/chat"/,
  );
  assert.match(
    clientScript,
    /function revealContinuitySurface[\s\S]*deletionIsPending\(\)[\s\S]*return;[\s\S]*conversationSurface\.hidden = false/,
  );
  assert.match(
    clientScript,
    /function deletionPendingStorageKey[\s\S]*DELETION_PENDING_STORAGE_PREFIX[\s\S]*`\$\{state\.mode\}:\$\{state\.token \|\| "legacy"\}`/,
  );
  assert.match(
    clientScript,
    /function markDeletionPending[\s\S]*localStorage\.setItem\(deletionPendingStorageKey\(state\), String\(Date\.now\(\)\)\)/,
  );
  assert.match(
    clientScript,
    /function readPersistedAnswer[\s\S]*if \(deletionIsPending\(\)\) return null;/,
  );
  assert.match(
    clientScript,
    /function deletionIsPending[\s\S]*localStorage\.getItem\(deletionPendingStorageKey\(state\)\) !== null/,
  );
  assert.match(
    clientScript,
    /deleteMemoryForm\.addEventListener\("submit"[\s\S]*window\.confirm[\s\S]*event\.preventDefault\(\);[\s\S]*return;[\s\S]*markDeletionPending\(\);[\s\S]*hideForContinuityReload\(\);/,
  );
  assert.match(styles, /auth-session/);
  assert.match(pageSource, /continuity\.mode === "account" \? "account" : "guest"/);
  assert.match(pageSource, /page\.auth\.forgetMemory/);

  const token = "a".repeat(43);
  const signedInPage = renderPage({
    signedIn: true,
    continuity: { mode: "account", token },
    memoryDeletionConfirmation: {
      confirmed: true,
      deletedContinuity: { mode: "account", token },
    },
  });
  assert.match(
    signedInPage,
    new RegExp(
      `action="/account/memory/delete" method="post"[\\s\\S]*name="continuity" value="${token}"`,
    ),
  );
  const replacementGuestToken = "g".repeat(43);
  const deletedGuestToken = "d".repeat(43);
  const guestPage = renderPage({
    signedIn: false,
    googleSignInAvailable: true,
    continuity: { mode: "guest", token: replacementGuestToken },
    memoryDeletionConfirmation: {
      confirmed: true,
      deletedContinuity: { mode: "guest", token: deletedGuestToken },
    },
  });
  assert.match(
    guestPage,
    new RegExp(
      `action="/guest/memory/delete" method="post"[\\s\\S]*name="continuity" value="${replacementGuestToken}"`,
    ),
  );
  assert.match(
    guestPage,
    new RegExp(
      `<template id="memory-deletion-state">\\{&quot;confirmed&quot;:true,&quot;deletedContinuity&quot;:\\{&quot;mode&quot;:&quot;guest&quot;,&quot;token&quot;:&quot;${deletedGuestToken}&quot;\\}\\}<\\/template>`,
    ),
  );
  assert.match(clientScript, /memoryDeletionTemplate/);
  assert.doesNotMatch(
    clientScript,
    /location\.search[\s\S]*memory["']?\)\s*===\s*["']deleted/,
  );

  assert.match(clientScript, /type: "memory-deleted"/);
  assert.match(
    clientScript,
    /function scrubForMemoryDeletion\(deletedContinuity\)[\s\S]*?clearPersistedAnswer\(deletedContinuity\);[\s\S]*?clearDeletionPending\(deletedContinuity\);[\s\S]*?activeRequestController\?\.abort\(\);[\s\S]*?awaitingSafetyAnswer = false;[\s\S]*?awaitingSafetyAnswerSince = null;[\s\S]*?restoreComposeView\(\);[\s\S]*?hideContinuitySurface\(\)/,
  );
  assert.match(
    clientScript,
    /message\.type === "memory-deleted"[\s\S]*?sameContinuity\(message\.continuity, continuityState\)[\s\S]*?scrubForMemoryDeletion\(message\.continuity\);[\s\S]*?revalidateContinuity\(\)/,
  );
  assert.match(
    clientScript,
    /memoryDeletionConfirmation[\s\S]*clearPersistedAnswer\(memoryDeletionConfirmation\.deletedContinuity\);[\s\S]*clearDeletionPending\(memoryDeletionConfirmation\.deletedContinuity\);[\s\S]*startContinuityChannel\(\);[\s\S]*memoryDeletionConfirmation[\s\S]*postMessage\(\{[\s\S]*type: "memory-deleted",[\s\S]*continuity: memoryDeletionConfirmation\.deletedContinuity/,
  );
  assert.match(
    clientScript,
    /function clearDeletionPending\(state\)[\s\S]*localStorage\.removeItem\(deletionPendingStorageKey\(state\)\)/,
  );
  const clearAllStart = clientScript.indexOf("function clearAllPersistedAnswers");
  const clearAllEnd = clientScript.indexOf(
    "function retireStalePersistedAnswers",
    clearAllStart,
  );
  const clearAllSource = clientScript.slice(clearAllStart, clearAllEnd);
  assert.doesNotMatch(clearAllSource, /DELETION_PENDING_STORAGE_PREFIX/);

  const entries = new Map([
    ["stabilize:last-answer:v3:guest:answer", "answer"],
    ["stabilize:memory-delete-pending:v1:guest:old", "guest pending"],
    ["stabilize:memory-delete-pending:v1:account:other", "account pending"],
  ]);
  const storage = {
    get length() {
      return entries.size;
    },
    key(index) {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key) {
      entries.delete(key);
    },
  };
  const clearAllPersistedAnswers = Function(
    "localStorage",
    "sessionStorage",
    "LEGACY_LAST_ANSWER_STORAGE_KEY",
    "LAST_ANSWER_STORAGE_PREFIX",
    "RETIRED_LAST_ANSWER_STORAGE_PREFIX",
    `${clearAllSource}; return clearAllPersistedAnswers;`,
  )(
    storage,
    storage,
    "stabilize:last-answer:v1",
    "stabilize:last-answer:v3:",
    "stabilize:last-answer:v2:",
  );
  clearAllPersistedAnswers();
  assert.equal(entries.has("stabilize:last-answer:v3:guest:answer"), false);
  assert.equal(
    entries.has("stabilize:memory-delete-pending:v1:guest:old"),
    true,
  );
  assert.equal(
    entries.has("stabilize:memory-delete-pending:v1:account:other"),
    true,
  );
  const clearPendingStart = clientScript.indexOf("function clearDeletionPending");
  const clearPendingEnd = clientScript.indexOf(
    "function showClientNotice",
    clearPendingStart,
  );
  const clearPendingSource = clientScript.slice(
    clearPendingStart,
    clearPendingEnd,
  );
  const clearDeletionPending = Function(
    "localStorage",
    "deletionPendingStorageKey",
    `${clearPendingSource}; return clearDeletionPending;`,
  )(
    storage,
    (state) =>
      `stabilize:memory-delete-pending:v1:${state.mode}:${state.token}`,
  );
  clearDeletionPending({ mode: "guest", token: "old" });
  assert.equal(
    entries.has("stabilize:memory-delete-pending:v1:guest:old"),
    false,
  );
  assert.equal(
    entries.has("stabilize:memory-delete-pending:v1:account:other"),
    true,
    "a receipt must not clear another continuity's pending deletion",
  );

  const answerEntries = new Map([
    ["stabilize:last-answer:v3:guest:deleted", "old guest answer"],
    ["stabilize:last-answer:v3:guest:replacement", "new guest answer"],
    ["stabilize:last-answer:v3:account:deleted", "old account answer"],
  ]);
  const answerStorage = {
    removeItem(key) {
      answerEntries.delete(key);
    },
  };
  const clearAnswerStart = clientScript.indexOf("function clearPersistedAnswer");
  const clearAnswerEnd = clientScript.indexOf(
    "function clearAllPersistedAnswers",
    clearAnswerStart,
  );
  const clearAnswerSource = clientScript.slice(clearAnswerStart, clearAnswerEnd);
  const clearPersistedAnswer = Function(
    "localStorage",
    "continuityStorageKey",
    `${clearAnswerSource}; return clearPersistedAnswer;`,
  )(
    answerStorage,
    (state) => `stabilize:last-answer:v3:${state.mode}:${state.token}`,
  );
  clearPersistedAnswer({ mode: "account", token: "deleted" });
  assert.equal(
    answerEntries.has("stabilize:last-answer:v3:guest:deleted"),
    true,
    "account deletion must preserve the separate guest answer",
  );
  clearPersistedAnswer({ mode: "guest", token: "deleted" });
  clearPersistedAnswer({ mode: "guest", token: "deleted" });
  assert.equal(
    answerEntries.has("stabilize:last-answer:v3:guest:replacement"),
    true,
    "a repeated old receipt must preserve the replacement guest answer",
  );
  assert.match(COPY.page.auth.memoryDeleted, /deleted from Stabilize/i);
  assert.match(COPY.page.auth.memorySessionChanged, /Nothing was deleted/i);
  assert.match(COPY.page.chat.infoDetails, /For guests, Stabilize stores a bounded summary/i);
  assert.match(COPY.page.chat.infoDetails, /signing in does not merge guest context/i);
  assert.match(
    COPY.page.chat.infoDetails,
    /OpenAI processes replies with response storage enabled for at least 30 days/i,
  );
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
  assert.match(
    copySource,
    /infoDetails:[\s\S]*For guests, Stabilize stores a bounded summary[\s\S]*30 days after the last exchange/i,
  );
  assert.match(
    copySource,
    /infoDetails:[\s\S]*random browser cookie rather than an IP address or fingerprint/i,
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
  assert.match(
    pageSource,
    /id="chat-form" class="chat-form" method="post" action="\/api\/chat"/,
  );
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

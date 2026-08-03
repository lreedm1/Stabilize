import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function webpDimensions(buffer) {
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(buffer.subarray(8, 12).toString("ascii"), "WEBP");

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;

    if (type === "VP8X" && data + 10 <= buffer.length) {
      const width = 1 + buffer.readUIntLE(data + 4, 3);
      const height = 1 + buffer.readUIntLE(data + 7, 3);
      return { width, height };
    }

    if (
      type === "VP8 " &&
      data + 10 <= buffer.length &&
      buffer[data + 3] === 0x9d &&
      buffer[data + 4] === 0x01 &&
      buffer[data + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff,
      };
    }

    if (type === "VP8L" && data + 5 <= buffer.length && buffer[data] === 0x2f) {
      const bits = buffer.readUInt32LE(data + 1);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }

    offset = data + size + (size % 2);
  }

  throw new Error("No supported WebP image chunk found");
}

test("the homepage gives a short product promise", async () => {
  const [pageSource, productStyles, seoStyles] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/product.css", import.meta.url), "utf8"),
    readFile(new URL("../public/seo.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /Get unstuck\./);
  assert.match(pageSource, /Get one clear next step/);
  assert.match(pageSource, /This browser can remember bounded chat context for up to 30 days/);
  assert.doesNotMatch(pageSource, /data-example-message=/);
  assert.doesNotMatch(pageSource, /example-starts/);
  assert.match(pageSource, /href="\/product\.css"/);
  assert.match(pageSource, /href="\/photo-tuning\.css\?v=20260802-8"/);
  assert.doesNotMatch(pageSource, /how-it-works-strip/);
  assert.doesNotMatch(pageSource, /Not a therapist or companion bot/);
  assert.match(
    productStyles,
    /\.product-intro\s*{[\s\S]*max-height:\s*100%;[\s\S]*overflow-y:\s*auto;/,
  );
  assert.match(
    seoStyles,
    /\.seo-intro\s*{[\s\S]*background:\s*rgba\(255,\s*252,\s*242,\s*0\.54\)/,
  );
});

test("the responsive background includes a real 8K WebP", async () => {
  const [pageSource, eightK] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../public/scenes/lake-valley-landscape-7680.webp",
        import.meta.url,
      ),
    ),
  ]);

  assert.match(pageSource, /lake-valley-landscape-7680\.webp 7680w/);
  assert.ok(eightK.byteLength > 500_000);
  assert.deepEqual(webpDimensions(eightK), { width: 7680, height: 4320 });
});

test("photos preserve screen proportion and use a calm mobile treatment", async () => {
  const [pageSource, tuningStyles, mobilePhoto, desktopPhoto, credit] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/photo-tuning.css", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../public/scenes/mobile-sunlit-green-path-v4-1440.webp",
          import.meta.url,
        ),
      ),
      readFile(
        new URL("../public/scenes/lake-valley-landscape-1280.webp", import.meta.url),
      ),
      readFile(
        new URL("../public/scenes/MOBILE_PHOTO_CREDIT.md", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(
    pageSource,
    /media="\(max-width: 980px\) and \(orientation: portrait\)"/,
  );
  assert.match(pageSource, /type="image\/webp"/);
  assert.deepEqual(webpDimensions(mobilePhoto), { width: 1440, height: 2560 });
  assert.equal(mobilePhoto.equals(desktopPhoto), false);
  assert.match(credit, /Wolfgang Hasselmann/);
  assert.match(credit, /Unsplash License/);
  assert.match(
    tuningStyles,
    /\.photo-backdrop img\s*{[\s\S]*object-fit:\s*cover;[\s\S]*object-position:\s*50% 50%;/,
  );
  assert.match(
    tuningStyles,
    /filter:\s*saturate\(1\.24\) contrast\(1\.035\) brightness\(0\.98\)/,
  );
  assert.match(
    tuningStyles,
    /@media \(max-width: 980px\) and \(orientation: portrait\)[\s\S]*object-position:\s*50% 56%;[\s\S]*filter:\s*none/,
  );
  assert.match(tuningStyles, /rgba\(5, 55, 29, 0\.1\)/);
});

test("the homepage has no predefined prompt buttons", async () => {
  const [pageSource, clientScript] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(pageSource, /data-example-message=/);
  assert.doesNotMatch(pageSource, /class="example-start"/);
  assert.match(pageSource, /id="message-input"/);
  assert.match(pageSource, /id="send-button"/);
  assert.match(clientScript, /form\.addEventListener\("submit"/);
});

test("a token-bound guest browser expires safety replies after 2 hours and ordinary replies after 30 days", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(clientScript, /LAST_ANSWER_STORAGE_PREFIX = "stabilize:last-answer:v3:"/);
  assert.match(clientScript, /LAST_ANSWER_MAX_AGE_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(clientScript, /SAFETY_ANSWER_MAX_AGE_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(clientScript, /LEGACY_LAST_ANSWER_STORAGE_KEY/);
  assert.match(clientScript, /RETIRED_LAST_ANSWER_STORAGE_PREFIX/);
  assert.match(clientScript, /function continuityStorageKey/);
  assert.match(clientScript, /`\$\{state\.mode\}:\$\{state\.token \|\| "legacy"\}`/);
  assert.match(clientScript, /localStorage\.setItem/);
  assert.match(clientScript, /localStorage\.getItem/);
  assert.match(clientScript, /localStorage\.removeItem/);
  assert.match(
    clientScript,
    /persistLatestAnswer\(reply, route, needsSafetyAnswer\)/,
  );
  assert.match(
    clientScript,
    /function persistLatestAnswer[\s\S]*?continuityState\.mode !== "guest" \|\| continuityState\.token === null/,
  );
  assert.match(
    clientScript,
    /function readPersistedAnswer[\s\S]*?continuityState\.mode !== "guest" \|\| continuityState\.token === null/,
  );
  assert.match(
    clientScript,
    /function readPersistedAnswer[\s\S]*persistedAnswerIsCurrent\(record, age\);[\s\S]*if \(!valid\) \{[\s\S]*clearPersistedAnswer\(\);[\s\S]*return null;[\s\S]*return record;/,
  );
  assert.match(
    clientScript,
    /function restorePersistedAnswer[\s\S]*const record = readPersistedAnswer\(\);[\s\S]*if \(!record\) return false;[\s\S]*showOutput\(record\.reply/,
  );
  assert.match(
    clientScript,
    /function retireStalePersistedAnswers[\s\S]*!persistedAnswerIsCurrent\(record, age\)[\s\S]*localStorage\.removeItem\(key\)/,
  );
  assert.match(clientScript, /function persistedAnswerIsCurrent[\s\S]*age <= LAST_ANSWER_MAX_AGE_MS[\s\S]*!record\.awaitingSafetyAnswer \|\| age <= SAFETY_ANSWER_MAX_AGE_MS/);
  assert.match(clientScript, /const record = \{[\s\S]*v: 3,[\s\S]*reply: cleanReply,[\s\S]*route: cleanRoute,[\s\S]*awaitingSafetyAnswer:[\s\S]*savedAt: Date\.now\(\)/);
  assert.match(clientScript, /awaitingSafetyAnswerSince = record\.awaitingSafetyAnswer \? record\.savedAt : null/);
  assert.match(clientScript, /function currentAwaitingSafetyAnswer\(\)[\s\S]*age > SAFETY_ANSWER_MAX_AGE_MS[\s\S]*awaitingSafetyAnswer = false;[\s\S]*awaitingSafetyAnswerSince = null;/);
  assert.match(clientScript, /awaitingSafetyAnswerSince = needsSafetyAnswer \? Date\.now\(\) : null/);
  assert.doesNotMatch(clientScript, /const record = \{[\s\S]{0,240}(?:prompt|user|messages):/);
  assert.match(clientScript, /restorePersistedAnswer\(\);/);
  assert.match(clientScript, /form\[action="\/auth\/logout"\]/);
  assert.match(clientScript, /clearAllPersistedAnswers/);
  assert.match(clientScript, /retireStalePersistedAnswers/);
  assert.match(
    clientScript,
    /retireStalePersistedAnswers\(\);[\s\S]*startContinuityChannel\(\)/,
  );
  assert.match(clientScript, /new BroadcastChannel\(CONTINUITY_CHANNEL_NAME\)/);
  assert.match(clientScript, /continuity: continuityState/);
  assert.match(clientScript, /sessionStorage\.removeItem/);

  const currentStart = clientScript.indexOf("function persistedAnswerIsCurrent");
  const currentEnd = clientScript.indexOf("function persistLatestAnswer", currentStart);
  const currentSource = clientScript.slice(currentStart, currentEnd);
  const persistedAnswerIsCurrent = Function(
    "LAST_ANSWER_MAX_AGE_MS",
    "SAFETY_ANSWER_MAX_AGE_MS",
    `${currentSource}; return persistedAnswerIsCurrent;`,
  )(30 * 24 * 60 * 60 * 1000, 2 * 60 * 60 * 1000);
  assert.equal(
    persistedAnswerIsCurrent({ awaitingSafetyAnswer: true }, 2 * 60 * 60 * 1000),
    true,
  );
  assert.equal(
    persistedAnswerIsCurrent(
      { awaitingSafetyAnswer: true },
      2 * 60 * 60 * 1000 + 1,
    ),
    false,
  );
  assert.equal(
    persistedAnswerIsCurrent(
      { awaitingSafetyAnswer: false },
      29 * 24 * 60 * 60 * 1000,
    ),
    true,
  );
  assert.equal(
    persistedAnswerIsCurrent(
      { awaitingSafetyAnswer: false },
      30 * 24 * 60 * 60 * 1000 + 1,
    ),
    false,
  );
});

test("the public privacy page describes persistent guest memory without stale tab-only claims", async () => {
  const privacyPage = await readFile(
    new URL("../public/privacy.html", import.meta.url),
    "utf8",
  );

  assert.match(
    privacyPage,
    /without signing in[\s\S]*bounded\s+summary and up to eight recent messages stored by Stabilize on\s+Cloudflare/i,
  );
  assert.match(
    privacyPage,
    /Remembered text expires 30 days after the last committed\s+exchange/i,
  );
  assert.match(
    privacyPage,
    /latest assistant reply[\s\S]*written to this browser's local storage/i,
  );
  assert.match(
    privacyPage,
    /Records older than 30 days[\s\S]*ignored[\s\S]*attempts to remove them on the next successful[\s\S]*load/i,
  );
  assert.match(
    privacyPage,
    /Browser or profile backups[\s\S]*unavailable JavaScript[\s\S]*unavailable[\s\S]*storage access may retain copies longer/i,
  );
  assert.doesNotMatch(
    privacyPage,
    /Guest messages do not enter server-side conversation memory|current browser tab|tab[- ](?:only|scoped)|24 hours|(?:may|can) remain[^.]{0,100}(?:for )?up to 30 days/i,
  );
});

test("anonymous memory has an explicit production abuse-control launch gate", async () => {
  const [readme, security] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../SECURITY.md", import.meta.url), "utf8"),
  ]);

  assert.match(
    readme,
    /Cloudflare WAF[\s\S]*guest-cookie minting[\s\S]*\/api\/chat[\s\S]*\/guest\/memory\/delete/i,
  );
  assert.match(security, /Anonymous-memory launch gate/);
  assert.match(security, /origin and cookie binding checks prevent browser CSRF/);
  assert.match(security, /not bot authentication/);
});

test("ordinary replies offer useful model follow-up actions", async () => {
  const [clientScript, pageSource, productStyles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/product.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /What would help next\?/);
  assert.match(pageSource, /Make it smaller/);
  assert.match(pageSource, /Another option/);
  assert.match(pageSource, /Help me start now/);
  assert.match(clientScript, /function appendOutcomeCheck/);
  assert.match(clientScript, /ROUTES_WITHOUT_OUTCOME_CHECK/);
  assert.match(clientScript, /result\.awaitingSafetyAnswer !== true|needsSafetyAnswer/);
  assert.match(clientScript, /buildOutcomeActionPrompt/);
  assert.doesNotMatch(clientScript, /\/api\/feedback/);
  assert.doesNotMatch(clientScript, /innerHTML\s*=/);
  assert.match(productStyles, /\.outcome-check/);
  assert.match(productStyles, /\.outcome-button/);
});


test("guest model choice includes a working sign-in action", async () => {
  const [workerSource, billingStyles] = await Promise.all([
    readFile(new URL("../src/paid-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../public/billing.css", import.meta.url), "utf8"),
  ]);

  assert.match(workerSource, /href="\/auth\/google">Sign in to choose a model/);
  assert.match(billingStyles, /\.billing-link/);
});

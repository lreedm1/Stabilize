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
  assert.match(pageSource, /Guest messages aren't saved as server memory/);
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

test("only a guest tab persists the latest assistant answer", async () => {
  const [clientScript, privacyPage] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/privacy.html", import.meta.url), "utf8"),
  ]);

  assert.match(clientScript, /LAST_ANSWER_STORAGE_PREFIX/);
  assert.match(clientScript, /LEGACY_LAST_ANSWER_STORAGE_KEY/);
  assert.match(clientScript, /function continuityStorageKey/);
  assert.match(clientScript, /sessionStorage\.setItem/);
  assert.match(clientScript, /sessionStorage\.getItem/);
  assert.match(clientScript, /sessionStorage\.removeItem/);
  assert.match(
    clientScript,
    /persistLatestAnswer\(reply, route, needsSafetyAnswer\)/,
  );
  assert.match(
    clientScript,
    /function persistLatestAnswer[\s\S]*?if \(continuityState\.mode !== "guest"\) return;/,
  );
  assert.match(
    clientScript,
    /function readPersistedAnswer[\s\S]*?if \(continuityState\.mode !== "guest"\)/,
  );
  assert.match(clientScript, /restorePersistedAnswer\(\);/);
  assert.match(clientScript, /form\[action="\/auth\/logout"\]/);
  assert.match(clientScript, /clearAllPersistedAnswers/);
  assert.match(clientScript, /retireStalePersistedAnswers/);
  assert.match(clientScript, /new BroadcastChannel\(CONTINUITY_CHANNEL_NAME\)/);
  assert.match(clientScript, /continuity: continuityState/);
  assert.doesNotMatch(clientScript, /localStorage/);
  assert.match(privacyPage, /latest assistant reply/i);
  assert.match(privacyPage, /current browser tab/i);
  assert.match(privacyPage, /prompt itself is\s+not included/i);
  assert.match(privacyPage, /Signing in later affects future messages only/i);
  assert.match(privacyPage, /Signed-in assistant replies are\s+not placed in the browser's 24-hour latest-reply cache/i);
  assert.match(privacyPage, /OpenAI is used for stateless processing/i);
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
  assert.doesNotMatch(clientScript, /\/api\/feedback|localStorage/);
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

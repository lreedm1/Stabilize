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
  assert.match(pageSource, /Guest chats aren't remembered/);
  assert.match(pageSource, /data-example-message=/);
  assert.match(pageSource, /href="\/product\.css"/);
  assert.doesNotMatch(pageSource, /how-it-works-strip/);
  assert.doesNotMatch(pageSource, /Not a therapist or companion bot/);
  assert.match(
    productStyles,
    /\.product-intro\s*{[\s\S]*max-height:\s*100%;[\s\S]*overflow-y:\s*auto;/,
  );
  assert.match(productStyles, /\.example-start/);
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

test("example starts fill the composer without sending for the user", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(clientScript, /querySelectorAll\("\[data-example-message\]"\)/);
  assert.match(clientScript, /input\.value = button\.dataset\.exampleMessage/);
  assert.doesNotMatch(
    clientScript,
    /button\.addEventListener\("click"[\s\S]{0,300}sendMessage\(/,
  );
});

test("ordinary replies offer a private next-step check", async () => {
  const [clientScript, pageSource, productStyles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/product.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /Do you have a next step\?/);
  assert.match(clientScript, /function appendOutcomeCheck/);
  assert.match(clientScript, /ROUTES_WITHOUT_OUTCOME_CHECK/);
  assert.match(clientScript, /result\.awaitingSafetyAnswer !== true/);
  assert.match(pageSource, /Give me one step I can do in ten minutes/);
  assert.doesNotMatch(clientScript, /\/api\/feedback|localStorage|sessionStorage/);
  assert.doesNotMatch(clientScript, /innerHTML\s*=/);
  assert.match(productStyles, /\.outcome-check/);
  assert.match(productStyles, /\.outcome-button/);
});

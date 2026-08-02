import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the homepage explains the product before the disclaimer", async () => {
  const [pageSource, productStyles] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/product.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /Get unstuck without solving your whole life/);
  assert.match(pageSource, /Find the weak point/);
  assert.match(pageSource, /Take one next step/);
  assert.match(pageSource, /Not a therapist or companion bot/);
  assert.match(pageSource, /Guest chats are not remembered/);
  assert.match(pageSource, /data-example-message=/);
  assert.match(pageSource, /href="\/product\.css"/);
  assert.match(
    productStyles,
    /\.product-intro\s*{[\s\S]*max-height:\s*100%;[\s\S]*overflow-y:\s*auto;/,
  );
  assert.match(productStyles, /\.how-it-works-strip/);
  assert.match(productStyles, /\.example-start/);
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

  assert.match(pageSource, /Did this help you identify one useful next step\?/);
  assert.match(clientScript, /function appendOutcomeCheck/);
  assert.match(clientScript, /ROUTES_WITHOUT_OUTCOME_CHECK/);
  assert.match(clientScript, /result\.awaitingSafetyAnswer !== true/);
  assert.match(pageSource, /Make this smaller and give me one concrete next step/);
  assert.doesNotMatch(clientScript, /\/api\/feedback|localStorage|sessionStorage/);
  assert.doesNotMatch(clientScript, /innerHTML\s*=/);
  assert.match(productStyles, /\.outcome-check/);
  assert.match(productStyles, /\.outcome-button/);
});

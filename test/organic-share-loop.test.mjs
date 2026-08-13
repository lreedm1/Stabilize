import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PRODUCT_PROMISE =
  "Stabilize helps you turn an overloaded moment into one safe, practical next step.";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the homepage and share flow use one canonical product promise", async () => {
  const [copy, page] = await Promise.all([
    source("src/copy.js"),
    source("src/page.js"),
  ]);

  assert.match(copy, /const PRODUCT_PROMISE =/);
  assert.ok(copy.includes(PRODUCT_PROMISE));
  assert.match(copy, /description: PRODUCT_PROMISE/);
  assert.match(copy, /promise: PRODUCT_PROMISE/);
  assert.match(copy, /share:\s*\{[\s\S]*?promise: PRODUCT_PROMISE/);

  assert.match(page, /const seoDescription = page\.promise;/);
  assert.match(
    page,
    /<p class="product-promise">\$\{escapeHtml\(page\.promise\)\}<\/p>/,
  );
  assert.match(page, /Stabilize — One Safe, Practical Next Step/);
  assert.doesNotMatch(
    page,
    /Tell Stabilize what is happening\. Get one clear next step\./,
  );
});

test("positive feedback and selected actions reveal an editable share surface", async () => {
  const [client, css] = await Promise.all([
    source("public/message-feedback.js"),
    source("public/message-feedback.css"),
  ]);

  assert.doesNotMatch(client, /Was this helpful\?/);
  assert.match(client, /function createShareEditor\(turnId\)/);
  assert.match(client, /function revealShareEditor\(turnId, suggestedStep = ""\)/);
  assert.match(client, /function buildShareText\(nextStep, includeUrl = true\)/);
  assert.match(client, /navigator\.share\(payload\)/);
  assert.match(client, /navigator\.clipboard\?\.writeText/);
  assert.match(client, /document\.execCommand\("copy"\)/);
  assert.match(
    client,
    /if \(rating === "up"\) revealShareEditor\(turn\.turnId\);/,
  );
  assert.match(
    client,
    /\(\) => revealShareEditor\(turnId, button\.textContent\)/,
  );
  assert.match(client, /textarea\.maxLength = SHARE_STEP_MAX_CHARS/);
  assert.match(client, /const step = cleanShareStep\(textarea\.value\)/);
  assert.doesNotMatch(client, /buildShareText\([^)]*article/);
  assert.doesNotMatch(client, /shareEditors[^\n]*assistant-output/);

  assert.match(css, /\/\* Shareable next-step loop \*\//);
  assert.match(css, /\.message-feedback-share \{/);
  assert.match(css, /\.message-feedback-share-button \{/);
  assert.match(css, /\.message-feedback-share-note/);
});

test("sharing stays user-controlled and outside impact analytics", async () => {
  const [copy, events, privacy] = await Promise.all([
    source("src/copy.js"),
    source("src/impact-events.js"),
    source("public/privacy.html"),
  ]);

  assert.match(copy, /Only this field and the Stabilize link will be copied or shared/);
  assert.match(events, /20260808-browser-response-time-1/);
  assert.match(events, /The optional copy\/share editor stays in the browser/);
  assert.match(events, /it is not sent to impact analytics/);
  assert.match(privacy, /id="sharing-a-next-step"/);
  assert.match(privacy, /does not automatically place the conversation or assistant/);
  assert.match(privacy, /not submitted to Stabilize impact analytics/);
});

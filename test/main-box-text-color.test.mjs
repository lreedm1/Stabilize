import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the main content box uses white text in compose and response views", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/main-box-white.css", import.meta.url), "utf8"),
  ]);

  const productIndex = pageSource.indexOf("/product.css?v=");
  const whiteTextIndex = pageSource.indexOf(
    "/main-box-white.css?v=20260805-1",
  );

  assert.ok(productIndex >= 0);
  assert.ok(whiteTextIndex > productIndex);
  assert.match(styles, /\.seo-intro,[\s\S]*\.assistant-output,/);
  assert.match(styles, /color:\s*#fffef8;/);
  assert.match(
    styles,
    /\.assistant-output pre,[\s\S]*\.assistant-output code[\s\S]*background:\s*rgba\(5, 25, 18, 0\.72\);/,
  );
});

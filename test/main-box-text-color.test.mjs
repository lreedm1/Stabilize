import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the main content box uses white text over gray reading surfaces", async () => {
  const [pageSource, styles] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/main-box-white.css", import.meta.url), "utf8"),
  ]);

  const productIndex = pageSource.indexOf("/product.css?v=");
  const readingSurfaceIndex = pageSource.indexOf(
    "/main-box-white.css?v=20260805-2",
  );

  assert.ok(productIndex >= 0);
  assert.ok(readingSurfaceIndex > productIndex);
  assert.match(styles, /\.seo-intro,[\s\S]*\.assistant-output,/);
  assert.match(styles, /color:\s*#fffef8;/);
  assert.match(styles, /\/\* Translucent gray reading surfaces \*\//);
  assert.match(
    styles,
    /\.seo-intro,[\s\S]*\.assistant-output \{[\s\S]*background:\s*rgba\(42, 47, 46, 0\.68\);[\s\S]*backdrop-filter:\s*blur\(10px\)/,
  );
  assert.match(
    styles,
    /\.assistant-output pre,[\s\S]*\.assistant-output code[\s\S]*background:\s*rgba\(5, 25, 18, 0\.72\);/,
  );
});

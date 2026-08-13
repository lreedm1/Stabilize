import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("follow-up prompts are borderless compact buttons arranged left to right", async () => {
  const [pageSource, productCss] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/product.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /product\.css\?v=20260804-compact-outcomes-2/);
  assert.match(productCss, /\.outcome-tray \.outcome-question \{\s*display: none;/);
  assert.match(
    productCss,
    /\.outcome-tray \.outcome-check \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
  );
  assert.match(
    productCss,
    /\.outcome-tray \.outcome-actions \{[\s\S]*?display: flex;[\s\S]*?flex-flow: row wrap;/,
  );
  assert.match(
    productCss,
    /\.outcome-tray \.outcome-button \{[\s\S]*?width: auto;[\s\S]*?white-space: nowrap;/,
  );
  assert.doesNotMatch(productCss, /\.outcome-actions,\s*@media/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the composer placeholder is centered horizontally while entered text stays left-aligned", async () => {
  const [css, worker, packageSource] = await Promise.all([
    read("public/billing.css"),
    read("src/paid-worker.js"),
    read("package.json"),
  ]);

  assert.match(css, /\/\* Horizontally centered composer placeholder \*\//);
  assert.match(
    css,
    /\.composer-dock textarea\s*\{[\s\S]*?text-align:\s*left;/,
  );
  assert.match(
    css,
    /\.composer-dock textarea::placeholder\s*\{[\s\S]*?text-align:\s*center;/,
  );
  assert.match(
    worker,
    /\/billing\.css\?v=20260805-centered-placeholder-2/,
  );
  assert.match(
    packageSource,
    /node scripts\/center-composer-placeholder\.mjs/,
  );
});

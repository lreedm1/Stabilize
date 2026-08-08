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
    /\/billing\.css\?v=20260807-free-gpt56-first-50-1/,
  );

  const config = JSON.parse(packageSource);
  assert.equal(
    config.scripts["apply:prompt-policy"],
    "node scripts/apply-priority-latency.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/add-guest-summary.mjs",
  );
});
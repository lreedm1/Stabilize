import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const STATIC_PAGES = [
  "public/about.html",
  "public/floor-first.html",
  "public/how-it-works.html",
  "public/privacy.html",
  "public/safety.html",
  "public/support.html",
  "public/sustainability.html",
];

test("the model tile shows the active 5.x version and pages expose a tab icon", async () => {
  const [worker, client, css, page, favicon, ...staticPages] =
    await Promise.all([
      read("src/paid-worker.js"),
      read("public/billing-client.js"),
      read("public/billing.css"),
      read("src/page.js"),
      read("public/favicon.svg"),
      ...STATIC_PAGES.map(read),
    ]);

  assert.match(worker, /function compactModelTileLabel\(model\)/);
  assert.match(
    worker,
    /buttonLabel = compactModelTileLabel\(choice\.selected\)/,
  );
  assert.match(client, /function compactModelTileLabel\(model\)/);
  assert.match(
    client,
    /current\.textContent = compactModelTileLabel\(defaultModel\)/,
  );
  assert.match(css, /\/\* Exact 5\.x model tile \*\//);
  assert.match(css, /\.composer-model-button \{[\s\S]*?width: 66px;[\s\S]*?height: 64px;/);
  assert.match(css, /\.composer-model-current \{[\s\S]*?font-size: clamp\(0\.9rem/);

  assert.match(
    page,
    /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" \/>/,
  );
  for (const html of staticPages) {
    assert.match(
      html,
      /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" \/>/,
    );
  }

  assert.match(favicon, /<svg[^>]*viewBox="0 0 64 64"/);
  assert.match(favicon, /<title id="title">Stabilize<\/title>/);
  assert.match(favicon, /fill="#173f31"/);
  assert.match(favicon, /stroke="#fffaf0"/);
});

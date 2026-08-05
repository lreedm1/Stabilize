import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readBytes = (path) =>
  readFile(new URL(`../${path}`, import.meta.url));

const STATIC_PAGES = [
  "public/about.html",
  "public/floor-first.html",
  "public/how-it-works.html",
  "public/privacy.html",
  "public/safety.html",
  "public/support.html",
  "public/sustainability.html",
];

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test("the model tile shows the active 5.x version and pages expose browser-compatible tab icons", async () => {
  const [
    worker,
    client,
    css,
    page,
    faviconSvg,
    faviconIco,
    favicon32,
    appleTouch,
    ...staticPages
  ] = await Promise.all([
    read("src/paid-worker.js"),
    read("public/billing-client.js"),
    read("public/billing.css"),
    read("src/page.js"),
    read("public/favicon.svg"),
    readBytes("public/favicon.ico"),
    readBytes("public/favicon-32x32.png"),
    readBytes("public/apple-touch-icon.png"),
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
  assert.match(
    css,
    /\.composer-model-button \{[\s\S]*?width: 66px;[\s\S]*?height: 64px;/,
  );
  assert.match(
    css,
    /\.composer-model-current \{[\s\S]*?font-size: clamp\(0\.9rem/,
  );

  const pageIconPatterns = [
    /<link rel="icon" href="\/favicon\.ico\?v=20260805-7" sizes="any" \/>/,
    /<link rel="icon" href="\/favicon\.svg\?v=20260805-7" type="image\/svg\+xml" sizes="any" \/>/,
    /<link rel="icon" href="\/favicon-32x32\.png\?v=20260805-7" type="image\/png" sizes="32x32" \/>/,
    /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png\?v=20260805-7" sizes="180x180" \/>/,
  ];
  for (const pattern of pageIconPatterns) assert.match(page, pattern);
  assert.doesNotMatch(page, /data:image\/svg\+xml/);

  for (const html of staticPages) {
    for (const pattern of pageIconPatterns) assert.match(html, pattern);
  }

  assert.match(faviconSvg, /<svg[^>]*viewBox="0 0 64 64"/);
  assert.match(faviconSvg, /<title id="title">Stabilize<\/title>/);
  assert.match(faviconSvg, /fill="#173f31"/);
  assert.match(faviconSvg, /stroke="#fffaf0"/);

  assert.deepEqual(
    faviconIco.subarray(0, 4),
    Buffer.from([0x00, 0x00, 0x01, 0x00]),
  );
  assert.ok(faviconIco.byteLength > 1_000);
  for (const png of [favicon32, appleTouch]) {
    assert.deepEqual(png.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
    assert.ok(png.byteLength > 250);
  }
});

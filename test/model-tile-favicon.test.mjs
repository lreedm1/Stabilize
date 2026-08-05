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

test("the model tile shows 5.x, the composer is 42px tall, and pages hard-reset browser tab icons", async () => {
  const [
    worker,
    client,
    css,
    page,
    faviconIco,
    favicon16,
    favicon32,
    appleTouch,
    safariMask,
    manifestSource,
    refreshScript,
    ...staticPages
  ] = await Promise.all([
    read("src/paid-worker.js"),
    read("public/billing-client.js"),
    read("public/billing.css"),
    read("src/page.js"),
    readBytes("public/stabilize-tab-20260805.ico"),
    readBytes("public/stabilize-tab-20260805-16.png"),
    readBytes("public/stabilize-tab-20260805-32.png"),
    readBytes("public/stabilize-app-20260805-180.png"),
    read("public/safari-pinned-tab.svg"),
    read("public/site.webmanifest"),
    read("public/favicon-refresh.js"),
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
    /\.composer-model-button \{[\s\S]*?width: 66px;[\s\S]*?min-width: 66px;/,
  );
  assert.match(css, /\/\* Balanced 42px composer bar \*\//);
  assert.match(
    css,
    /\.composer-model-button,[\s\S]*?\.composer-dock textarea,[\s\S]*?\.composer-dock #send-button \{[\s\S]*?height: 42px;[\s\S]*?min-height: 42px;[\s\S]*?max-height: 42px;/,
  );
  assert.match(
    css,
    /\.composer-model-button::after \{[\s\S]*?display: none;[\s\S]*?content: none;/,
  );
  assert.match(css, /\.composer-model-kicker \{[\s\S]*?display: none;/);

  const pageIconPatterns = [
    /<link rel="shortcut icon" href="\/stabilize-tab-20260805\.ico" type="image\/x-icon" \/>/,
    /<link rel="icon" href="\/stabilize-tab-20260805-16\.png" type="image\/png" sizes="16x16" \/>/,
    /<link rel="icon" href="\/stabilize-tab-20260805-32\.png" type="image\/png" sizes="32x32" \/>/,
    /<link rel="apple-touch-icon" href="\/stabilize-app-20260805-180\.png" sizes="180x180" \/>/,
    /<link rel="mask-icon" href="\/safari-pinned-tab\.svg" color="#173f31" \/>/,
    /<link rel="manifest" href="\/site\.webmanifest\?v=20260805-8" \/>/,
    /<script src="\/favicon-refresh\.js\?v=20260805-8" defer><\/script>/,
  ];
  for (const pattern of pageIconPatterns) assert.match(page, pattern);
  assert.match(page, /<meta name="application-name" content="STABILIZE" \/>/);
  assert.match(
    page,
    /<meta name="apple-mobile-web-app-title" content="STABILIZE" \/>/,
  );
  assert.doesNotMatch(page, /href="\/favicon\.svg/);
  assert.doesNotMatch(page, /data:image\/svg\+xml/);

  for (const html of staticPages) {
    for (const pattern of pageIconPatterns) assert.match(html, pattern);
  }

  assert.deepEqual(
    faviconIco.subarray(0, 4),
    Buffer.from([0x00, 0x00, 0x01, 0x00]),
  );
  assert.ok(faviconIco.byteLength > 1_000);
  for (const png of [favicon16, favicon32, appleTouch]) {
    assert.deepEqual(png.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
  }
  assert.equal(favicon16.readUInt32BE(16), 16);
  assert.equal(favicon16.readUInt32BE(20), 16);
  assert.equal(favicon32.readUInt32BE(16), 32);
  assert.equal(favicon32.readUInt32BE(20), 32);
  assert.equal(appleTouch.readUInt32BE(16), 180);
  assert.equal(appleTouch.readUInt32BE(20), 180);

  assert.match(safariMask, /viewBox="0 0 16 16"/);
  assert.match(safariMask, /<path fill="#000000"/);
  assert.doesNotMatch(safariMask, /<rect|<circle/);

  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.name, "STABILIZE");
  assert.equal(manifest.icons[0].src, "/stabilize-app-20260805-180.png");
  assert.equal(manifest.icons[0].sizes, "180x180");

  assert.match(refreshScript, /stabilize-live-tab-icon/);
  assert.match(
    refreshScript,
    /\/stabilize-tab-20260805-32\.png\?refresh=20260805-8/,
  );
  assert.match(refreshScript, /document\.head\.append\(icon\)/);
});

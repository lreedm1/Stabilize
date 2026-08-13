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
  "public/uwmadison.html",
];

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test("the model tile and composer remain correct while pages use static tab icons", async () => {
  const [
    worker,
    client,
    css,
    page,
    vectorIcon,
    faviconIco,
    favicon32,
    appleTouch,
    safariMask,
    manifestSource,
    headers,
    ...staticPages
  ] = await Promise.all([
    read("src/paid-worker.js"),
    read("public/billing-client.js"),
    read("public/billing.css"),
    read("src/page.js"),
    read("public/stabilize-tab-20260813.svg"),
    readBytes("public/favicon.ico"),
    readBytes("public/stabilize-tab-20260813-static-32.png"),
    readBytes("public/stabilize-app-20260805-180.png"),
    read("public/safari-pinned-tab.svg"),
    read("public/site.webmanifest"),
    read("public/_headers"),
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
    /<link rel="shortcut icon" href="\/favicon\.ico" type="image\/x-icon" \/>/,
    /<link rel="icon" href="\/stabilize-tab-20260813\.svg" type="image\/svg\+xml" sizes="any" \/>/,
    /<link rel="icon" href="\/stabilize-tab-20260813-static-32\.png" type="image\/png" sizes="32x32" \/>/,
    /<link rel="apple-touch-icon" href="\/stabilize-app-20260805-180\.png" sizes="180x180" \/>/,
    /<link rel="mask-icon" href="\/safari-pinned-tab\.svg" color="#173f31" \/>/,
    /<link rel="manifest" href="\/site\.webmanifest\?v=20260813-static-1" \/>/,
  ];

  for (const html of [page, ...staticPages]) {
    for (const pattern of pageIconPatterns) assert.match(html, pattern);
    assert.match(html, /<meta name="application-name" content="STABILIZE" \/>/);
    assert.match(
      html,
      /<meta name="apple-mobile-web-app-title" content="STABILIZE" \/>/,
    );
    assert.doesNotMatch(html, /favicon-refresh\.js/);
    assert.doesNotMatch(html, /data:image\/(?:png|svg\+xml)/);
    assert.doesNotMatch(html, /stabilize-tab-20260805-(?:16|32)\.png/);
  }

  assert.deepEqual(
    faviconIco.subarray(0, 4),
    Buffer.from([0x00, 0x00, 0x01, 0x00]),
  );
  assert.ok(faviconIco.byteLength > 1_000);
  for (const png of [favicon32, appleTouch]) {
    assert.deepEqual(png.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
  }
  assert.equal(favicon32.readUInt32BE(16), 32);
  assert.equal(favicon32.readUInt32BE(20), 32);
  assert.equal(appleTouch.readUInt32BE(16), 180);
  assert.equal(appleTouch.readUInt32BE(20), 180);

  assert.match(vectorIcon, /viewBox="0 0 64 64"/);
  assert.match(vectorIcon, /fill="#173f31"/);
  assert.match(vectorIcon, /stroke="#fffaf0"/);

  assert.match(safariMask, /viewBox="0 0 16 16"/);
  assert.match(safariMask, /<path fill="#000000"/);
  assert.doesNotMatch(safariMask, /<rect|<circle/);

  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.name, "STABILIZE");
  assert.equal(manifest.icons.length, 2);
  assert.equal(
    manifest.icons[0].src,
    "/stabilize-tab-20260813-static-32.png",
  );
  assert.equal(manifest.icons[0].sizes, "32x32");
  assert.equal(manifest.icons[1].src, "/stabilize-tab-20260813.svg");

  assert.match(
    headers,
    /\/stabilize-tab-20260813-static-32\.png[\s\S]*Cache-Control: public, max-age=31536000, immutable/,
  );
  assert.match(
    headers,
    /\/stabilize-tab-20260813\.svg[\s\S]*Cache-Control: public, max-age=31536000, immutable/,
  );
  assert.doesNotMatch(headers, /cache-independent-safari-tab-icon/);
});

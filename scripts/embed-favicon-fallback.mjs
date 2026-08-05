import { readFile, writeFile } from "node:fs/promises";

const STATIC_PAGES = [
  "public/about.html",
  "public/floor-first.html",
  "public/how-it-works.html",
  "public/privacy.html",
  "public/safety.html",
  "public/support.html",
  "public/sustainability.html",
];

const ICON_VERSION = "20260805-7";
const BINARY_ASSETS = [
  ["scripts/favicon-assets/favicon.ico.b64", "public/favicon.ico"],
  ["scripts/favicon-assets/favicon-32x32.png.b64", "public/favicon-32x32.png"],
  ["scripts/favicon-assets/apple-touch-icon.png.b64", "public/apple-touch-icon.png"],
];

const ICON_LINKS = `    <link rel="icon" href="/favicon.ico?v=${ICON_VERSION}" sizes="any" />
    <link rel="icon" href="/favicon.svg?v=${ICON_VERSION}" type="image/svg+xml" sizes="any" />
    <link rel="icon" href="/favicon-32x32.png?v=${ICON_VERSION}" type="image/png" sizes="32x32" />
    <link rel="shortcut icon" href="/favicon.ico?v=${ICON_VERSION}" type="image/x-icon" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${ICON_VERSION}" sizes="180x180" />
    <link rel="mask-icon" href="/favicon.svg?v=${ICON_VERSION}" color="#173f31" />`;

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Favicon loading repair could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function normalizeIconLinks(source, anchor, label) {
  let text = source.replace(
    /^\s*<link\s+rel="(?:icon|alternate icon|shortcut icon|apple-touch-icon|mask-icon)"[^>]*>\s*$/gim,
    "",
  );
  requireText(text, anchor, label);
  return text.replace(anchor, `${anchor}\n${ICON_LINKS}`);
}

for (const [source, target] of BINARY_ASSETS) {
  const encoded = (await readFile(source, "utf8")).trim();
  await writeFile(target, Buffer.from(encoded, "base64"));
}

await update("src/page.js", (source) =>
  normalizeIconLinks(
    source,
    '    <meta name="theme-color" content="#173f31" />',
    "the main-page theme color",
  ),
);

for (const path of STATIC_PAGES) {
  await update(path, (source) => {
    const themeMatch = source.match(/\s*<meta name="theme-color"[^>]*\/?>/);
    if (themeMatch) {
      return normalizeIconLinks(source, themeMatch[0], `${path} theme color`);
    }

    let text = source.replace(
      /^\s*<link\s+rel="(?:icon|alternate icon|shortcut icon|apple-touch-icon|mask-icon)"[^>]*>\s*$/gim,
      "",
    );
    requireText(text, "</head>", `${path} head closing tag`);
    return text.replace("</head>", `${ICON_LINKS}\n  </head>`);
  });
}

await update("src/index.js", (source) => {
  let text = source;

  const typesBlock = `const FAVICON_CONTENT_TYPES = new Map([
  ["/favicon.ico", "image/x-icon"],
  ["/favicon.svg", "image/svg+xml; charset=utf-8"],
  ["/favicon-32x32.png", "image/png"],
  ["/apple-touch-icon.png", "image/png"],
]);

`;
  const typesAnchor = "const FIXED_ROUTE_MEMORY = {";
  if (!text.includes("const FAVICON_CONTENT_TYPES = new Map([")) {
    requireText(text, typesAnchor, "the fixed-route memory map");
    text = text.replace(typesAnchor, typesBlock + typesAnchor);
  }

  const helper = `async function faviconAssetResponse(request, env, contentType) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response(COPY.api.methodNotAllowed, {
      status: 405,
      headers: pageHeaders("text/plain; charset=utf-8"),
    });
  }

  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok) return asset;

  const headers = new Headers(asset.headers);
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=300, must-revalidate");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(request.method === "HEAD" ? null : asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
}

`;
  const helperAnchor = "function jsonResponse(body, status = 200, extraHeaders = {}) {";
  if (!text.includes("async function faviconAssetResponse(")) {
    requireText(text, helperAnchor, "the JSON response helper");
    text = text.replace(helperAnchor, helper + helperAnchor);
  }

  const route = `      if (FAVICON_CONTENT_TYPES.has(url.pathname)) {
        return faviconAssetResponse(
          request,
          env,
          FAVICON_CONTENT_TYPES.get(url.pathname),
        );
      }

`;
  const routeAnchor = '      if (url.pathname === "/" || url.pathname === "/index.html") {';
  if (!text.includes("if (FAVICON_CONTENT_TYPES.has(url.pathname))")) {
    requireText(text, routeAnchor, "the root-page route");
    text = text.replace(routeAnchor, route + routeAnchor);
  }

  return text;
});

await update("test/worker.test.mjs", (source) => {
  if (source.includes('test("favicon endpoints return browser-compatible content types"')) {
    return source;
  }

  const testBlock = `test("favicon endpoints return browser-compatible content types", async () => {
  const cases = [
    ["/favicon.ico", "image/x-icon"],
    ["/favicon.svg", "image/svg+xml; charset=utf-8"],
    ["/favicon-32x32.png", "image/png"],
    ["/apple-touch-icon.png", "image/png"],
  ];

  for (const [path, contentType] of cases) {
    const response = await worker.fetch(
      new Request("https://stabilize.test" + path),
      createEnv(),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), contentType);
    assert.match(response.headers.get("cache-control") || "", /max-age=300/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
});

`;
  const testAnchor = 'test("root page renders the simplified chat without audio or a danger shortcut"';
  requireText(source, testAnchor, "the root-page Worker test");
  return source.replace(testAnchor, testBlock + testAnchor);
});

console.log(
  "Generated ICO, PNG, and Apple favicon assets with explicit browser-compatible responses.",
);

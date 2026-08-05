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

const ICON_RELEASE = "20260805";
const REFRESH_VERSION = "20260805-8";
const BINARY_ASSETS = [
  ["scripts/favicon-assets/favicon.ico.b64", "public/favicon.ico"],
  [
    "scripts/favicon-assets/favicon.ico.b64",
    `public/stabilize-tab-${ICON_RELEASE}.ico`,
  ],
  ["scripts/favicon-assets/favicon-16x16.png.b64", "public/favicon-16x16.png"],
  [
    "scripts/favicon-assets/favicon-16x16.png.b64",
    `public/stabilize-tab-${ICON_RELEASE}-16.png`,
  ],
  ["scripts/favicon-assets/favicon-32x32.png.b64", "public/favicon-32x32.png"],
  [
    "scripts/favicon-assets/favicon-32x32.png.b64",
    `public/stabilize-tab-${ICON_RELEASE}-32.png`,
  ],
  ["scripts/favicon-assets/apple-touch-icon.png.b64", "public/apple-touch-icon.png"],
  [
    "scripts/favicon-assets/apple-touch-icon.png.b64",
    `public/stabilize-app-${ICON_RELEASE}-180.png`,
  ],
];

const ICON_LINKS = `    <link rel="shortcut icon" href="/stabilize-tab-${ICON_RELEASE}.ico" type="image/x-icon" />
    <link rel="icon" href="/stabilize-tab-${ICON_RELEASE}.ico" type="image/x-icon" sizes="16x16 32x32 48x48" />
    <link rel="icon" href="/stabilize-tab-${ICON_RELEASE}-16.png" type="image/png" sizes="16x16" />
    <link rel="icon" href="/stabilize-tab-${ICON_RELEASE}-32.png" type="image/png" sizes="32x32" />
    <link rel="apple-touch-icon" href="/stabilize-app-${ICON_RELEASE}-180.png" sizes="180x180" />
    <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#173f31" />
    <link rel="manifest" href="/site.webmanifest?v=${REFRESH_VERSION}" />
    <meta name="application-name" content="STABILIZE" />
    <meta name="apple-mobile-web-app-title" content="STABILIZE" />
    <script src="/favicon-refresh.js?v=${REFRESH_VERSION}" defer></script>`;

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

function stripIconMetadata(source) {
  return source
    .replace(
      /^\s*<link\s+rel="(?:icon|alternate icon|shortcut icon|apple-touch-icon|mask-icon|manifest)"[^>]*>\s*$/gim,
      "",
    )
    .replace(
      /^\s*<meta\s+name="(?:application-name|apple-mobile-web-app-title)"[^>]*>\s*$/gim,
      "",
    )
    .replace(
      /^\s*<script\s+src="\/favicon-refresh\.js[^"]*"\s+defer><\/script>\s*$/gim,
      "",
    );
}

function normalizeIconLinks(source, anchor, label) {
  const text = stripIconMetadata(source);
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

    const text = stripIconMetadata(source);
    requireText(text, "</head>", `${path} head closing tag`);
    return text.replace("</head>", `${ICON_LINKS}\n  </head>`);
  });
}

await update("src/index.js", (source) => {
  let text = source;

  const typesBlock = `const FAVICON_CONTENT_TYPES = new Map([
  ["/favicon.ico", "image/x-icon"],
  ["/favicon.svg", "image/svg+xml; charset=utf-8"],
  ["/favicon-16x16.png", "image/png"],
  ["/favicon-32x32.png", "image/png"],
  ["/apple-touch-icon.png", "image/png"],
  ["/stabilize-tab-${ICON_RELEASE}.ico", "image/x-icon"],
  ["/stabilize-tab-${ICON_RELEASE}-16.png", "image/png"],
  ["/stabilize-tab-${ICON_RELEASE}-32.png", "image/png"],
  ["/stabilize-app-${ICON_RELEASE}-180.png", "image/png"],
  ["/safari-pinned-tab.svg", "image/svg+xml; charset=utf-8"],
  ["/site.webmanifest", "application/manifest+json; charset=utf-8"],
]);

`;
  const typesPattern =
    /const FAVICON_CONTENT_TYPES = new Map\(\[[\s\S]*?\]\);\n\n/;
  const typesAnchor = "const FIXED_ROUTE_MEMORY = {";
  if (typesPattern.test(text)) {
    text = text.replace(typesPattern, typesBlock);
  } else {
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
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(request.method === "HEAD" ? null : asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
}

`;
  const helperPattern =
    /async function faviconAssetResponse\([\s\S]*?\n}\n\n(?=function jsonResponse)/;
  const helperAnchor = "function jsonResponse(body, status = 200, extraHeaders = {}) {";
  if (helperPattern.test(text)) {
    text = text.replace(helperPattern, helper);
  } else {
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
  const testBlock = `test("favicon endpoints return browser-compatible content types", async () => {
  const cases = [
    ["/favicon.ico", "image/x-icon"],
    ["/favicon.svg", "image/svg+xml; charset=utf-8"],
    ["/favicon-16x16.png", "image/png"],
    ["/favicon-32x32.png", "image/png"],
    ["/apple-touch-icon.png", "image/png"],
    ["/stabilize-tab-${ICON_RELEASE}.ico", "image/x-icon"],
    ["/stabilize-tab-${ICON_RELEASE}-16.png", "image/png"],
    ["/stabilize-tab-${ICON_RELEASE}-32.png", "image/png"],
    ["/stabilize-app-${ICON_RELEASE}-180.png", "image/png"],
    ["/safari-pinned-tab.svg", "image/svg+xml; charset=utf-8"],
    ["/site.webmanifest", "application/manifest+json; charset=utf-8"],
  ];

  for (const [path, contentType] of cases) {
    const response = await worker.fetch(
      new Request("https://stabilize.test" + path),
      createEnv(),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), contentType);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
});

`;
  const testPattern =
    /test\("favicon endpoints return browser-compatible content types",[\s\S]*?\n}\);\n\n(?=test\("root page renders the simplified chat without audio or a danger shortcut")/;
  const testAnchor = 'test("root page renders the simplified chat without audio or a danger shortcut"';
  if (testPattern.test(source)) return source.replace(testPattern, testBlock);
  requireText(source, testAnchor, "the root-page Worker test");
  return source.replace(testAnchor, testBlock + testAnchor);
});

console.log(
  "Hard-reset favicon identity with new tab-icon URLs, a true 16px PNG, and a valid Safari mask.",
);

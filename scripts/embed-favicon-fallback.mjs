import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PNG_NAME = "stabilize-tab-20260813-static-32.png";
const SVG_NAME = "stabilize-tab-20260813.svg";
const MANIFEST_VERSION = "20260813-static-1";

const ICON_LINKS = `    <link rel="shortcut icon" href="/favicon.ico" type="image/x-icon" />
    <link rel="icon" href="/${SVG_NAME}" type="image/svg+xml" sizes="any" />
    <link rel="icon" href="/${PNG_NAME}" type="image/png" sizes="32x32" />
    <link rel="apple-touch-icon" href="/stabilize-app-20260805-180.png" sizes="180x180" />
    <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#173f31" />
    <link rel="manifest" href="/site.webmanifest?v=${MANIFEST_VERSION}" />
    <meta name="application-name" content="STABILIZE" />
    <meta name="apple-mobile-web-app-title" content="STABILIZE" />`;

const ICON_LINK_PATTERN =
  /^[ \t]*<link\s+rel="(?:icon|alternate icon|shortcut icon|apple-touch-icon|mask-icon|manifest)"[^>]*>[ \t]*\r?$/gim;
const ICON_META_PATTERN =
  /^[ \t]*<meta\s+name="(?:application-name|apple-mobile-web-app-title)"[^>]*>[ \t]*\r?$/gim;
const REFRESH_SCRIPT_PATTERN =
  /^[ \t]*<script\s+src="\/favicon-refresh\.js[^"]*"\s+defer><\/script>[ \t]*\r?$/gim;

function stripIconMetadata(source) {
  return source
    .replace(ICON_LINK_PATTERN, "")
    .replace(ICON_META_PATTERN, "")
    .replace(REFRESH_SCRIPT_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n");
}

function installStaticIcons(source, label) {
  const text = stripIconMetadata(source);
  const themePattern = /^([ \t]*<meta name="theme-color"[^>]*\/?>)[ \t]*\r?$/im;
  const themeMatch = text.match(themePattern);

  if (themeMatch) {
    return text.replace(themePattern, `${themeMatch[1]}\n${ICON_LINKS}`);
  }

  if (!text.includes("</head>")) {
    throw new Error(`Could not find a head insertion point in ${label}`);
  }
  return text.replace("</head>", `${ICON_LINKS}\n  </head>`);
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function decodeAsset(path) {
  return readFile(path, "utf8").then((source) =>
    Buffer.from(source.replace(/\s+/g, ""), "base64"),
  );
}

await writeFile(
  "public/favicon.ico",
  await decodeAsset("scripts/favicon-assets/favicon.ico.b64"),
);
await writeFile(
  `public/${PNG_NAME}`,
  await decodeAsset("scripts/favicon-assets/favicon-32x32.png.b64"),
);

await update("src/page.js", (source) =>
  installStaticIcons(source, "src/page.js"),
);

for (const entry of await readdir("public", { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  const path = join("public", entry.name);
  await update(path, (source) => installStaticIcons(source, path));
}

const manifest = {
  name: "STABILIZE",
  short_name: "STABILIZE",
  description: "One clear next step for overloaded moments.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#173f31",
  theme_color: "#173f31",
  icons: [
    {
      src: `/${PNG_NAME}`,
      sizes: "32x32",
      type: "image/png",
      purpose: "any",
    },
    {
      src: `/${SVG_NAME}`,
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
};
await writeFile("public/site.webmanifest", `${JSON.stringify(manifest, null, 2)}\n`);

await update("public/_headers", (source) => {
  const withoutOldBlocks = source
    .replace(
      /\n?# cache-independent-safari-tab-icon-start[\s\S]*?# cache-independent-safari-tab-icon-end\n?/g,
      "\n",
    )
    .replace(
      /\n?# static-favicon-20260813-start[\s\S]*?# static-favicon-20260813-end\n?/g,
      "\n",
    )
    .trimEnd();

  return `${withoutOldBlocks}

# static-favicon-20260813-start
/favicon.ico
  Content-Type: image/x-icon
  Cache-Control: public, max-age=86400
  Content-Disposition: inline
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

/${PNG_NAME}
  Content-Type: image/png
  Cache-Control: public, max-age=31536000, immutable
  Content-Disposition: inline
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

/${SVG_NAME}
  Content-Type: image/svg+xml; charset=utf-8
  Cache-Control: public, max-age=31536000, immutable
  Content-Disposition: inline
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
# static-favicon-20260813-end
`;
});

await rm("public/favicon-refresh.js", { force: true });

console.log(
  "Installed one static PNG, one static SVG, and /favicon.ico without runtime favicon mutation.",
);

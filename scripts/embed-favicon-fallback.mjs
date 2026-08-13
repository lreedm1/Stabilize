import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FAVICON_NAME = "favicon-32x32.png";

const ICON_LINKS = `    <link rel="icon" href="/${FAVICON_NAME}" type="image/png" sizes="32x32" />
    <link rel="apple-touch-icon" href="/stabilize-app-20260805-180.png" sizes="180x180" />
    <link rel="manifest" href="/site.webmanifest" />
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

// Keep the conventional root ICO available for implicit legacy discovery, but
// do not advertise it in page markup. The only declared browser favicon is the
// stable 32x32 PNG below.
await writeFile(
  "public/favicon.ico",
  await decodeAsset("scripts/favicon-assets/favicon.ico.b64"),
);
await writeFile(
  `public/${FAVICON_NAME}`,
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
      src: "/stabilize-app-20260805-180.png",
      sizes: "180x180",
      type: "image/png",
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
    .replace(
      /\n?# canonical-favicon-start[\s\S]*?# canonical-favicon-end\n?/g,
      "\n",
    )
    .trimEnd();

  return `${withoutOldBlocks}

# canonical-favicon-start
/favicon.ico
  Content-Type: image/x-icon
  Cache-Control: public, max-age=86400
  Content-Disposition: inline
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

/${FAVICON_NAME}
  Content-Type: image/png
  Cache-Control: public, max-age=86400
  Content-Disposition: inline
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
# canonical-favicon-end
`;
});

await rm("public/favicon-refresh.js", { force: true });

console.log(
  "Installed one stable declared PNG favicon with an implicit /favicon.ico fallback.",
);

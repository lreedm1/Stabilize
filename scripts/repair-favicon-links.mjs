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

const ICON_LINKS = `    <link rel="icon" href="/favicon.svg?v=20260805-2" type="image/svg+xml" sizes="any" />
    <link rel="icon" href="/favicon-64.png?v=20260805-2" type="image/png" sizes="64x64" />
    <link rel="shortcut icon" href="/favicon-64.png?v=20260805-2" type="image/png" />
    <link rel="apple-touch-icon" href="/favicon-64.png?v=20260805-2" />`;

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Favicon repair could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceIconLinks(source, anchor, label) {
  let text = source.replace(
    /\s*<link\s+rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>\s*/g,
    "\n",
  );
  requireText(text, anchor, label);
  return text.replace(anchor, `${anchor}\n${ICON_LINKS}`);
}

await update("src/page.js", (source) =>
  replaceIconLinks(
    source,
    '    <meta name="theme-color" content="#173f31" />',
    "the main-page theme color",
  ),
);

for (const path of STATIC_PAGES) {
  await update(path, (source) => {
    const themeMatch = source.match(/\s*<meta name="theme-color"[^>]*\/?>/);
    if (themeMatch) {
      return replaceIconLinks(source, themeMatch[0], `${path} theme color`);
    }
    let text = source.replace(
      /\s*<link\s+rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>\s*/g,
      "\n",
    );
    requireText(text, "</head>", `${path} head closing tag`);
    return text.replace("</head>", `${ICON_LINKS}\n  </head>`);
  });
}

console.log("Added cache-busted SVG, PNG, shortcut, and Apple favicon links.");

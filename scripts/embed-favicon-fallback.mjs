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

const INLINE_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23173f31'/%3E%3Ccircle cx='50' cy='13' r='5' fill='%23d6a849'/%3E%3Cpath d='M43 20c-3-3-7-5-12-5-8 0-14 4-14 11 0 6 4 9 13 11 6 2 8 3 8 6 0 3-3 5-8 5-5 0-9-2-13-6l-5 6c5 6 11 9 19 9 10 0 16-5 16-14 0-7-4-10-14-13-6-1-7-3-7-5 0-2 2-4 6-4 4 0 7 1 10 4z' fill='%23fff8e2'/%3E%3C/svg%3E";

const ICON_LINKS = `    <link rel="icon" href="${INLINE_ICON}" type="image/svg+xml" />
    <link rel="alternate icon" href="/favicon.svg?v=20260805-3" type="image/svg+xml" />
    <link rel="shortcut icon" href="/favicon.svg?v=20260805-3" type="image/svg+xml" />`;

function stripIconLinks(source) {
  return source.replace(
    /^\s*<link\s+rel="(?:icon|alternate icon|shortcut icon|apple-touch-icon)"[^>]*>\s*$/gim,
    "",
  );
}

async function update(path) {
  const before = await readFile(path, "utf8");
  let after = stripIconLinks(before);
  const themePattern = /(\s*<meta name="theme-color"[^>]*\/?>)/;
  if (themePattern.test(after)) {
    after = after.replace(themePattern, `$1\n${ICON_LINKS}`);
  } else {
    after = after.replace("</head>", `${ICON_LINKS}\n  </head>`);
  }
  if (after !== before) await writeFile(path, after);
}

await update("src/page.js");
for (const path of STATIC_PAGES) await update(path);

console.log("Embedded a self-contained favicon with a cache-busted SVG fallback.");

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

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Compact header and menu Info update could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/copy.js", (source) => {
  let text = source;

  const oldHeader = `    header: {\n      name: "Stabilize",\n    },`;
  const newHeader = `    header: {\n      name: "STABILIZE",\n    },`;
  if (text.includes(oldHeader)) {
    text = text.replace(oldHeader, newHeader);
  } else {
    requireText(text, newHeader, "the uppercase header wordmark");
  }

  const oldPlaceholder = '      inputPlaceholder: "What is happening right now?",';
  const newPlaceholder = '      inputPlaceholder: "What is happening?",';
  if (text.includes(oldPlaceholder)) {
    text = text.replace(oldPlaceholder, newPlaceholder);
  } else {
    requireText(text, newPlaceholder, "the concise composer placeholder");
  }

  return text;
});

await update("src/page.js", (source) => {
  let text = source;

  const landingInfoPattern = /\n\s*<details class="info-disclosure">\s*<summary>\$\{escapeHtml\(page\.chat\.infoLabel\)\}<\/summary>\s*<div class="info-popover">\s*<p>\$\{escapeHtml\(page\.chat\.infoDetails\)\}<\/p>\s*<\/div>\s*<\/details>/;
  if (landingInfoPattern.test(text)) {
    text = text.replace(landingInfoPattern, "");
  } else if (text.includes('class="info-disclosure"')) {
    throw new Error("Compact header and menu Info update could not remove the landing disclosure");
  }

  const menuInfo = `              <details class="menu-info-disclosure">\n                <summary>\${escapeHtml(page.chat.infoLabel)}</summary>\n                <p>\${escapeHtml(page.chat.infoDetails)}</p>\n              </details>\n`;
  if (!text.includes('class="menu-info-disclosure"')) {
    const accountAnchor = '              <div class="menu-account"';
    requireText(text, accountAnchor, "the hamburger-menu account section");
    text = text.replace(accountAnchor, menuInfo + accountAnchor);
  }

  requireText(text, 'class="menu-info-disclosure"', "the menu Info disclosure");
  if (text.includes('class="info-disclosure"')) {
    throw new Error("The landing Info disclosure is still present");
  }

  return text;
});

await update("public/seo.css", (source) => {
  if (source.includes("/* Info disclosure inside the hamburger menu */")) {
    return source;
  }

  return `${source.trimEnd()}

/* Info disclosure inside the hamburger menu */
.menu-panel {
  max-height: min(82vh, 640px);
  overflow-y: auto;
}

.menu-info-disclosure {
  margin: 6px 2px 8px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 7px 4px;
}

.menu-info-disclosure summary {
  border-radius: 10px;
  color: var(--text);
  cursor: pointer;
  padding: 9px 8px;
  font-size: 0.88rem;
  font-weight: 680;
  line-height: 1.3;
  list-style: none;
}

.menu-info-disclosure summary::-webkit-details-marker {
  display: none;
}

.menu-info-disclosure summary::after {
  float: right;
  content: "+";
  color: var(--accent-dark);
  font-weight: 780;
}

.menu-info-disclosure[open] summary::after {
  content: "−";
}

.menu-info-disclosure summary:hover,
.menu-info-disclosure summary:focus-visible {
  background: var(--accent-soft);
  color: var(--accent-dark);
}

.menu-info-disclosure p {
  margin: 3px 8px 7px;
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.5;
}
`;
});

for (const path of STATIC_PAGES) {
  await update(path, (source) => {
    const oldBrand = '<a class="brand" href="/">Stabilize</a>';
    const newBrand = '<a class="brand" href="/">STABILIZE</a>';
    if (source.includes(oldBrand)) return source.replace(oldBrand, newBrand);
    requireText(source, newBrand, `${path} uppercase wordmark`);
    return source;
  });
}

await update("test/ui.test.mjs", (source) => {
  const replacement = `test("privacy detail lives in the hamburger menu rather than the landing card", async () => {
  const [seoStyles, pageSource, copySource] = await Promise.all([
    readFile(new URL("../public/seo.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/copy.js", import.meta.url), "utf8"),
  ]);

  const menuIndex = pageSource.indexOf('class="menu-panel"');
  const infoIndex = pageSource.indexOf('class="menu-info-disclosure"', menuIndex);
  const accountIndex = pageSource.indexOf('class="menu-account"', menuIndex);

  assert.ok(menuIndex >= 0);
  assert.ok(infoIndex > menuIndex);
  assert.ok(accountIndex > infoIndex);
  assert.doesNotMatch(pageSource, /<details class="info-disclosure">/);
  assert.match(
    pageSource,
    /<details class="menu-info-disclosure">[\\s\\S]*?<summary>\\$\\{escapeHtml\\(page\\.chat\\.infoLabel\\)\\}<\\/summary>/,
  );
  assert.match(pageSource, /page\\.chat\\.supportNote/);
  assert.match(pageSource, /page\\.chat\\.infoDetails/);
  assert.match(copySource, /supportNote:[\\s\\S]*not emergency care/i);
  assert.match(copySource, /infoDetails:[\\s\\S]*remembered for 30 days/i);
  assert.match(
    copySource,
    /infoDetails:[\\s\\S]*does not use IP addresses for memory or application logs/i,
  );
  assert.match(
    seoStyles,
    /\\.menu-panel\\s*{[\\s\\S]*max-height:[\\s\\S]*overflow-y:\\s*auto/,
  );
  assert.match(seoStyles, /\\.menu-info-disclosure\\s*{/);
});

`;

  const oldPattern = /test\("privacy detail stays behind a compact Info disclosure",[\s\S]*?\n}\);\n\n(?=test\("Google account controls stay compact and guest chat remains visible")/;
  if (oldPattern.test(source)) return source.replace(oldPattern, replacement);
  requireText(
    source,
    'test("privacy detail lives in the hamburger menu rather than the landing card"',
    "the updated menu Info regression test",
  );
  return source;
});

console.log(
  "Uppercased the visible wordmark, shortened the composer placeholder, and moved Info into the hamburger menu.",
);

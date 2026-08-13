import { readFile, writeFile } from "node:fs/promises";

const PAGE_PATH = "src/page.js";
const STYLE_PATH = "public/seo.css";
const ADMIN_LINK =
  '              <a class="menu-admin-link" href="/admin/impact" aria-label="Open admin dashboard" rel="nofollow">Admin</a>';
const STYLE_MARKER =
  "/* Admin dashboard button at the bottom of the hamburger menu */";

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Admin menu update could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update(PAGE_PATH, (source) => {
  let text = source;
  const menuStart = text.indexOf('<div class="menu-panel">');
  const menuEnd = text.indexOf(
    "\n            </div>\n          </details>",
    menuStart,
  );
  if (menuStart < 0 || menuEnd <= menuStart) {
    throw new Error("Admin menu update could not inspect the hamburger menu");
  }

  if (!text.includes('class="menu-admin-link"')) {
    const accountStart = text.indexOf('<div class="menu-account"', menuStart);
    const accountEndMarker = "\n              </div>";
    const accountEnd = text.indexOf(accountEndMarker, accountStart);
    if (
      accountStart < 0 ||
      accountEnd < 0 ||
      accountEnd >= menuEnd
    ) {
      throw new Error("Admin menu update could not find the menu account section");
    }

    const insertionPoint = accountEnd + accountEndMarker.length;
    text =
      text.slice(0, insertionPoint) +
      `\n${ADMIN_LINK}` +
      text.slice(insertionPoint);
  }

  const matches = text.match(/class="menu-admin-link"/g) || [];
  if (matches.length !== 1) {
    throw new Error(
      `Admin menu update expected one Admin button, found ${matches.length}`,
    );
  }

  const finalMenuStart = text.indexOf('<div class="menu-panel">');
  const finalMenuEnd = text.indexOf(
    "\n            </div>\n          </details>",
    finalMenuStart,
  );
  const accountIndex = text.indexOf('class="menu-account"', finalMenuStart);
  const adminIndex = text.indexOf('class="menu-admin-link"', finalMenuStart);
  if (
    accountIndex < 0 ||
    adminIndex <= accountIndex ||
    adminIndex >= finalMenuEnd
  ) {
    throw new Error("Admin button must be the final section of the hamburger menu");
  }

  requireText(
    text,
    'href="/admin/impact"',
    "the impact dashboard destination",
  );
  return text;
});

await update(STYLE_PATH, (source) => {
  if (source.includes(STYLE_MARKER)) {
    requireText(source, ".menu-admin-link", "the Admin button style");
    return source;
  }

  return `${source.trimEnd()}

${STYLE_MARKER}
.menu-admin-link {
  display: flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  margin: 8px 2px 2px;
  border: 1px solid var(--accent-dark);
  border-radius: 10px;
  background: var(--accent-dark);
  color: #ffffff;
  padding: 9px 11px;
  font-size: 0.8rem;
  font-weight: 760;
  line-height: 1.2;
  text-align: center;
  text-decoration: none;
}

.menu-admin-link:hover,
.menu-admin-link:focus-visible {
  background: var(--accent);
  color: #ffffff;
  outline: 3px solid rgba(46, 101, 80, 0.24);
  outline-offset: 2px;
}
`;
});

console.log("Added the Admin button to the bottom of the hamburger menu.");

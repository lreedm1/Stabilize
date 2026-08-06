import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderPage } from "../src/page.js";

const STATIC_PAGES = [
  "about.html",
  "floor-first.html",
  "how-it-works.html",
  "privacy.html",
  "safety.html",
  "support.html",
  "sustainability.html",
];

test("the main page keeps Home, Info, account, and Admin in menu order", () => {
  const html = renderPage({
    signedIn: false,
    googleSignInAvailable: false,
  });

  assert.doesNotMatch(html, /class="site-name"/);
  assert.doesNotMatch(html, /class="home-button"/);
  assert.match(
    html,
    /<nav class="header-navigation" aria-label="Primary navigation">/,
  );

  const headerNavigationIndex = html.indexOf('class="header-navigation"');
  const headerMenuIndex = html.indexOf('class="site-menu"', headerNavigationIndex);
  const headerActionsIndex = html.indexOf('class="header-actions"', headerNavigationIndex);

  assert.ok(headerNavigationIndex >= 0);
  assert.ok(headerMenuIndex > headerNavigationIndex);
  assert.ok(headerActionsIndex > headerMenuIndex);
  assert.match(html, /placeholder="What is happening\?"/);
  assert.doesNotMatch(html, /What is happening right now\?/);

  const menuPanelIndex = html.indexOf('class="menu-panel"');
  const menuPanelEnd = html.indexOf("</details>", menuPanelIndex);
  const menuLinksIndex = html.indexOf('class="menu-links"', menuPanelIndex);
  const homeIndex = html.indexOf('<a href="/">Home</a>', menuLinksIndex);
  const aboutIndex = html.indexOf('<a href="/about.html">About</a>', menuLinksIndex);
  const infoIndex = html.indexOf('class="menu-info-disclosure"', menuPanelIndex);
  const accountIndex = html.indexOf('class="menu-account"', menuPanelIndex);
  const adminIndex = html.indexOf('class="menu-admin-link"', menuPanelIndex);

  assert.ok(menuPanelIndex >= 0);
  assert.ok(menuPanelEnd > menuPanelIndex);
  assert.ok(menuLinksIndex > menuPanelIndex);
  assert.ok(homeIndex > menuLinksIndex);
  assert.ok(aboutIndex > homeIndex);
  assert.ok(infoIndex > aboutIndex);
  assert.ok(accountIndex > infoIndex);
  assert.ok(adminIndex > accountIndex);
  assert.ok(adminIndex < menuPanelEnd);
  assert.match(
    html,
    /<a class="menu-admin-link" href="\/admin\/impact" aria-label="Open admin dashboard" rel="nofollow">Admin<\/a>/,
  );
  assert.equal((html.match(/class="menu-admin-link"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="info-disclosure"/);
  assert.match(
    html,
    /<details class="menu-info-disclosure">[\s\S]*?<summary>Info<\/summary>[\s\S]*?<p>/,
  );
});

test("the Admin menu link is styled as a full-width button", async () => {
  const css = await readFile(
    new URL("../public/seo.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /\/\* Admin dashboard button at the bottom of the hamburger menu \*\/[\s\S]*?\.menu-admin-link\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-height:\s*40px;[\s\S]*?justify-content:\s*center;/,
  );
  assert.match(css, /\.menu-admin-link:hover,[\s\S]*?\.menu-admin-link:focus-visible/);
});

test("public information pages use the uppercase wordmark", async () => {
  for (const page of STATIC_PAGES) {
    const html = await readFile(
      new URL(`../public/${page}`, import.meta.url),
      "utf8",
    );
    assert.match(
      html,
      /<a class="brand" href="\/">STABILIZE<\/a>/,
      `${page} should use the uppercase wordmark`,
    );
  }
});

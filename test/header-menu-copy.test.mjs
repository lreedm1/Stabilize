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

test("the main page keeps Home inside the left menu, concise placeholder, and menu Info", () => {
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
  const menuLinksIndex = html.indexOf('class="menu-links"', menuPanelIndex);
  const homeIndex = html.indexOf('<a href="/">Home</a>', menuLinksIndex);
  const aboutIndex = html.indexOf('<a href="/about.html">About</a>', menuLinksIndex);
  const infoIndex = html.indexOf('class="menu-info-disclosure"', menuPanelIndex);
  const accountIndex = html.indexOf('class="menu-account"', menuPanelIndex);

  assert.ok(menuPanelIndex >= 0);
  assert.ok(menuLinksIndex > menuPanelIndex);
  assert.ok(homeIndex > menuLinksIndex);
  assert.ok(aboutIndex > homeIndex);
  assert.ok(infoIndex > aboutIndex);
  assert.ok(accountIndex > infoIndex);
  assert.doesNotMatch(html, /class="info-disclosure"/);
  assert.match(
    html,
    /<details class="menu-info-disclosure">[\s\S]*?<summary>Info<\/summary>[\s\S]*?<p>/,
  );
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

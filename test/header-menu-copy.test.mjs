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

test("the main page uses left navigation, a Home control, concise placeholder, and menu Info", () => {
  const html = renderPage({
    signedIn: false,
    googleSignInAvailable: false,
  });

  assert.doesNotMatch(html, /class="site-name"/);
  assert.match(
    html,
    /<nav class="header-navigation" aria-label="Primary navigation">/,
  );
  assert.match(
    html,
    /<a class="home-button" href="\/" aria-label="Home">[\s\S]*?<span>Home<\/span>[\s\S]*?<\/a>/,
  );

  const headerNavigationIndex = html.indexOf('class="header-navigation"');
  const headerMenuIndex = html.indexOf('class="site-menu"', headerNavigationIndex);
  const homeIndex = html.indexOf('class="home-button"', headerNavigationIndex);
  const headerActionsIndex = html.indexOf('class="header-actions"', headerNavigationIndex);

  assert.ok(headerNavigationIndex >= 0);
  assert.ok(headerMenuIndex > headerNavigationIndex);
  assert.ok(homeIndex > headerMenuIndex);
  assert.ok(headerActionsIndex > homeIndex);
  assert.match(html, /placeholder="What is happening\?"/);
  assert.doesNotMatch(html, /What is happening right now\?/);

  const menuPanelIndex = html.indexOf('class="menu-panel"');
  const infoIndex = html.indexOf('class="menu-info-disclosure"', menuPanelIndex);
  const accountIndex = html.indexOf('class="menu-account"', menuPanelIndex);

  assert.ok(menuPanelIndex >= 0);
  assert.ok(infoIndex > menuPanelIndex);
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

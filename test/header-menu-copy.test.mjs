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

test("the main page uses the uppercase wordmark, concise placeholder, and menu Info", () => {
  const html = renderPage({
    signedIn: false,
    googleSignInAvailable: false,
  });

  assert.match(
    html,
    /<a class="site-name" href="\/" aria-label="Stabilize home">STABILIZE<\/a>/,
  );
  assert.match(html, /placeholder="What is happening\?"/);
  assert.doesNotMatch(html, /What is happening right now\?/);

  const menuIndex = html.indexOf('class="menu-panel"');
  const infoIndex = html.indexOf('class="menu-info-disclosure"', menuIndex);
  const accountIndex = html.indexOf('class="menu-account"', menuIndex);

  assert.ok(menuIndex >= 0);
  assert.ok(infoIndex > menuIndex);
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

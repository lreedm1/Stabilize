import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderPage } from "../src/page.js";

test("Home lives in the hamburger menu without chat actions or duplicate model choice", async () => {
  const [pageSource, workerSource, seoStyles, packageSource] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/paid-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../public/seo.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  const menuLinksIndex = pageSource.indexOf('class="menu-links"');
  const homeIndex = pageSource.indexOf('<a href="/">Home</a>', menuLinksIndex);
  const aboutIndex = pageSource.indexOf(
    '<a href="/about.html">About</a>',
    menuLinksIndex,
  );

  assert.ok(menuLinksIndex >= 0);
  assert.ok(homeIndex > menuLinksIndex);
  assert.ok(aboutIndex > homeIndex);
  assert.doesNotMatch(pageSource, /class="home-button"/);
  assert.doesNotMatch(seoStyles, /\.home-button|\.home-icon/);

  const html = renderPage({
    signedIn: true,
    googleSignInAvailable: true,
  });
  const menuPanelStart = html.indexOf('class="menu-panel"');
  const menuPanelEnd = html.indexOf("</details>", menuPanelStart);
  const menuPanel = html.slice(menuPanelStart, menuPanelEnd);

  assert.ok(menuPanelStart >= 0);
  assert.ok(menuPanelEnd > menuPanelStart);
  assert.doesNotMatch(menuPanel, /new-conversation-button/);
  assert.doesNotMatch(menuPanel, /private-chat-button/);
  assert.doesNotMatch(pageSource, /\$\{privateChatControl\}/);

  assert.match(workerSource, /const markup = "";/);
  assert.match(
    workerSource,
    /const composerModelPicker = composerModelPickerMarkup\(/,
  );
  assert.match(workerSource, /if \(markup\) \{/);
  assert.match(
    packageSource,
    /node scripts\/finalize-home-menu-and-model-placement\.mjs/,
  );
});

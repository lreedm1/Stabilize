import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderPage } from "../src/page.js";

test("Home lives in the hamburger menu without chat actions, duplicate model choice, or a save notice", async () => {
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
  const proxyStart = html.indexOf('class="chat-action-proxies"');
  const proxyEnd = html.indexOf('<main class="chat-card"', proxyStart);
  const proxies = html.slice(proxyStart, proxyEnd);

  assert.ok(menuPanelStart >= 0);
  assert.ok(menuPanelEnd > menuPanelStart);
  assert.doesNotMatch(menuPanel, /new-conversation-button/);
  assert.doesNotMatch(menuPanel, /private-chat-button/);

  assert.ok(proxyStart >= 0);
  assert.ok(proxyEnd > proxyStart);
  assert.match(proxies, /class="chat-action-proxies" hidden aria-hidden="true"/);
  assert.match(proxies, /id="new-conversation-button"/);
  assert.match(proxies, /id="private-chat-button"/);

  assert.match(workerSource, /const markup = "";/);
  assert.match(
    workerSource,
    /const composerModelPicker = composerModelPickerMarkup\(/,
  );
  assert.match(workerSource, /if \(markup\) \{/);
  assert.doesNotMatch(workerSource, /Your AI model choice was saved\./);
  assert.doesNotMatch(
    workerSource,
    /url\.searchParams\.get\("model"\) === "saved"/,
  );

  const config = JSON.parse(packageSource);
  assert.equal(
    config.scripts["apply:prompt-policy"],
    "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs",
  );
});
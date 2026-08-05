import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Home lives in the hamburger menu and model choice is not duplicated there", async () => {
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

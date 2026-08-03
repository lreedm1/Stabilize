import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repositoryFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("stabilize.info is the canonical production domain", async () => {
  const [configText, router, page, sitemap, robots, workflow] = await Promise.all([
    repositoryFile("wrangler.jsonc"),
    repositoryFile("src/domain-router.js"),
    repositoryFile("src/page.js"),
    repositoryFile("public/sitemap.xml"),
    repositoryFile("public/robots.txt"),
    repositoryFile(".github/workflows/deploy-cloudflare.yml"),
  ]);
  const config = JSON.parse(configText);

  assert.equal(config.main, "src/domain-router.js");
  assert.equal(config.vars.PUBLIC_ORIGIN, "https://stabilize.info");
  assert.equal(config.assets.run_worker_first, true);
  assert.deepEqual(config.routes, [
    { pattern: "stabilize.info/*", zone_name: "stabilize.info" },
    { pattern: "reedlokken.com/*", zone_name: "reedlokken.com" },
  ]);
  assert.equal(
    config.routes.some((route) => route.custom_domain === true),
    false,
    "production domains must be Worker routes so requests are answered at the edge before an origin TLS handshake",
  );

  assert.match(router, /const CANONICAL_ORIGIN = "https:\/\/stabilize\.info"/);
  assert.match(router, /"reedlokken\.com"/);
  assert.match(router, /status: 308/);
  assert.match(router, /url\.protocol !== "https:"/);
  assert.match(router, /Strict-Transport-Security/);
  assert.match(router, /max-age=31536000; includeSubDomains/);
  assert.match(router, /return withStrictTransportSecurity\(response\)/);
  assert.match(router, /property === "PUBLIC_ORIGIN"/);
  assert.match(router, /await worker\.fetch\(request, canonicalEnv, ctx\)/);
  assert.doesNotMatch(router, /from "\.\/auth\.js"|await signOut\(/);
  assert.match(page, /const canonicalUrl = "https:\/\/stabilize\.info\/"/);
  assert.match(sitemap, /https:\/\/stabilize\.info\//);
  assert.match(sitemap, /https:\/\/stabilize\.info\/about\.html/);
  assert.match(sitemap, /https:\/\/stabilize\.info\/sustainability\.html/);
  assert.doesNotMatch(sitemap, /reedlokken\.com/);
  assert.match(robots, /Sitemap: https:\/\/stabilize\.info\/sitemap\.xml/);
  assert.match(workflow, /https:\/\/stabilize\.info\/api\/auth/);
  assert.match(workflow, /https:\/\/reedlokken\.com\//);
});

test("all public guide pages use stabilize.info canonicals", async () => {
  const pages = await Promise.all([
    repositoryFile("public/about.html"),
    repositoryFile("public/sustainability.html"),
    repositoryFile("public/how-it-works.html"),
    repositoryFile("public/floor-first.html"),
    repositoryFile("public/safety.html"),
    repositoryFile("public/privacy.html"),
  ]);

  for (const page of pages) {
    assert.match(page, /rel="canonical" href="https:\/\/stabilize\.info\//);
    assert.doesNotMatch(page, /rel="canonical" href="https:\/\/reedlokken\.com\//);
  }
});

test("the About page preserves the origin while stating evidence and sustainability limits", async () => {
  const [about, enhancer, howItWorks, floorFirst, safety, privacy] =
    await Promise.all([
      repositoryFile("public/about.html"),
      repositoryFile("src/memory-prompt-worker.js"),
      repositoryFile("public/how-it-works.html"),
      repositoryFile("public/floor-first.html"),
      repositoryFile("public/safety.html"),
      repositoryFile("public/privacy.html"),
    ]);

  assert.match(about, /I am a suicide survivor/i);
  assert.match(about, /next person/i);
  assert.match(about, /does not, by itself, prove that the\s+product works/i);
  assert.match(about, /has not been clinically validated/i);
  assert.match(about, /preserve agency/i);
  assert.match(about, /Impact requires sustainability/i);
  assert.match(about, /current paid model-choice subscription is an early payment experiment/i);
  assert.match(about, /not emergency care/i);
  assert.match(enhancer, /href=\"\/about\.html\"/);

  for (const page of [howItWorks, floorFirst, safety, privacy]) {
    assert.match(page, /href="\/about\.html">About<\/a>/);
  }
});

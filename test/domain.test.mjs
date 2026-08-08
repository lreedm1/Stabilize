import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repositoryFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("stabilize.info is the only production domain", async () => {
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
  ]);
  assert.equal(
    config.routes.some((route) => route.custom_domain === true),
    false,
    "the production domain must be a Worker route so requests are answered at the edge before an origin TLS handshake",
  );

  assert.match(router, /const CANONICAL_ORIGIN = "https:\/\/stabilize\.info"/);
  assert.match(router, /const CANONICAL_HOST = "stabilize\.info"/);
  assert.match(router, /function unknownHostResponse\(\)/);
  assert.match(router, /status: 404/);
  assert.match(router, /status: 308/);
  assert.match(router, /url\.protocol !== "https:"/);
  assert.match(router, /Strict-Transport-Security/);
  assert.match(router, /max-age=31536000; includeSubDomains/);
  assert.match(router, /return withStrictTransportSecurity\(response\)/);
  assert.match(router, /property === "PUBLIC_ORIGIN"/);
  assert.match(router, /url\.pathname === "\/auth\/logout"/);
  assert.match(router, /await signOut\(request, canonicalEnv\)/);
  assert.match(page, /const canonicalUrl = "https:\/\/stabilize\.info\/"/);
  assert.match(sitemap, /https:\/\/stabilize\.info\//);
  assert.match(sitemap, /https:\/\/stabilize\.info\/about\.html/);
  assert.match(sitemap, /https:\/\/stabilize\.info\/sustainability\.html/);
  assert.match(robots, /Sitemap: https:\/\/stabilize\.info\/sitemap\.xml/);
  assert.match(workflow, /https:\/\/stabilize\.info\/api\/auth/);
  assert.doesNotMatch(workflow, /Legacy-domain redirect/);
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
  }
});

test("public website attribution stays project-based rather than personal", async () => {
  const [about, page, credit] = await Promise.all([
    repositoryFile("public/about.html"),
    repositoryFile("src/page.js"),
    repositoryFile("public/scenes/MOBILE_GOLDEN_ALPINE_CREDIT.md"),
  ]);

  assert.match(about, /content="Why Stabilize was built/);
  assert.match(
    about,
    /<footer>Built for the next person—and tested against the responsibility to last\.<\/footer>/,
  );
  assert.doesNotMatch(about, /<footer>Built by /);
  assert.doesNotMatch(page, /creator:\s*\{/);
  assert.match(credit, /from project direction/);
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
  assert.match(about, /20 messages per UTC day/i);
  assert.match(about, /current paid model-allowance\s+subscription is an early payment experiment/i);
  assert.match(about, /not emergency care/i);
  assert.match(enhancer, /href=\"\/about\.html\"/);

  for (const page of [howItWorks, floorFirst, safety, privacy]) {
    assert.match(page, /href="\/about\.html">About<\/a>/);
  }
});

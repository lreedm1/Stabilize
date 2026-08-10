import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repositoryFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("stabilize.info is canonical and reedlokken.com redirects", async () => {
  const [configText, router, page, sitemap, robots, workflow, staticHeaders] =
    await Promise.all([
    repositoryFile("wrangler.jsonc"),
    repositoryFile("src/domain-router.js"),
    repositoryFile("src/page.js"),
    repositoryFile("public/sitemap.xml"),
    repositoryFile("public/robots.txt"),
    repositoryFile(".github/workflows/deploy-cloudflare.yml"),
    repositoryFile("public/_headers"),
  ]);
  const config = JSON.parse(configText);

  assert.equal(config.main, "src/domain-router.js");
  assert.equal(config.vars.PUBLIC_ORIGIN, "https://stabilize.info");
  assert.deepEqual(config.assets.run_worker_first, [
    "/*",
    "!/*.css",
    "!/*.js",
    "!/*.mjs",
    "!/*.map",
    "!/*.ico",
    "!/*.png",
    "!/*.jpg",
    "!/*.jpeg",
    "!/*.gif",
    "!/*.webp",
    "!/*.avif",
    "!/*.svg",
    "!/*.woff",
    "!/*.woff2",
    "!/site.webmanifest",
    "!/fonts/*",
    "!/scenes/*"
  ]);
  assert.match(
    staticHeaders,
    /Strict-Transport-Security:\s*max-age=31536000; includeSubDomains/,
  );
  assert.deepEqual(config.routes, [
    { pattern: "stabilize.info/*", zone_name: "stabilize.info" },
    { pattern: "reedlokken.com", custom_domain: true },
    { pattern: "www.reedlokken.com", custom_domain: true },
  ]);
  assert.equal(
    config.routes[0].custom_domain,
    undefined,
    "the canonical production domain must remain a Worker route",
  );
  assert.deepEqual(
    config.routes
      .filter((route) => route.custom_domain === true)
      .map((route) => route.pattern),
    ["reedlokken.com", "www.reedlokken.com"],
  );

  assert.match(router, /const CANONICAL_ORIGIN = "https:\/\/stabilize\.info"/);
  assert.match(router, /const CANONICAL_HOST = "stabilize\.info"/);
  assert.match(router, /"reedlokken\.com"/);
  assert.match(router, /"www\.reedlokken\.com"/);
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
  assert.match(sitemap, /https:\/\/stabilize\.info\/support\.html/);
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Sitemap: https:\/\/stabilize\.info\/sitemap\.xml/);
  assert.doesNotMatch(robots, /Disallow: \/\s*$/m);
  assert.match(workflow, /https:\/\/stabilize\.info\/api\/auth/);
  assert.match(workflow, /Verify reedlokken\.com redirects/);
  assert.match(workflow, /www\.reedlokken\.com/);
});

test("repository and public descriptions match the current model policy", async () => {
  const [configText, readme, setupGuide, about, sustainability] =
    await Promise.all([
      repositoryFile("wrangler.jsonc"),
      repositoryFile("README.md"),
      repositoryFile("docs/STRIPE_MODEL_CHOICE_SETUP.md"),
      repositoryFile("public/about.html"),
      repositoryFile("public/sustainability.html"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(
    config.vars.MODEL_CHOICES,
    "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
  );
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "50");
  assert.equal(config.vars.FREE_PLAN_PRIMARY_MODEL, "gpt-5.6-sol");
  assert.equal(config.vars.FREE_PLAN_FALLBACK_MODEL, "gpt-5.4");
  assert.equal(config.vars.PAID_MONTHLY_MESSAGE_LIMIT, "200");

  for (const description of [readme, setupGuide, about, sustainability]) {
    assert.match(description, /50|Fifty/);
    assert.match(description, /GPT-5\.6 Fast/);
    assert.match(description, /GPT-5\.4/);
    assert.match(description, /200/);
    assert.doesNotMatch(description, /20 (?:messages|non-default-model)/i);
    assert.doesNotMatch(description, /GPT-5 mini|GPT-5\.1|GPT-5\.6 Luna|GPT-5\.6 Terra/);
  }

  assert.match(readme, /FREE_PLAN_PRIMARY_MODEL=gpt-5\.6-sol/);
  assert.match(readme, /FREE_PLAN_FALLBACK_MODEL=gpt-5\.4/);
  assert.match(setupGuide, /fixed urgent routes and failed provider requests do not consume/i);
  assert.match(about, /Signed-in free accounts receive 50 GPT-5\.6 Fast/);
  assert.match(sustainability, /free GPT-5\.6 Fast-first policy intact/);
});

test("all public guide pages use stabilize.info canonicals and remain indexable", async () => {
  const pages = await Promise.all([
    repositoryFile("public/about.html"),
    repositoryFile("public/sustainability.html"),
    repositoryFile("public/how-it-works.html"),
    repositoryFile("public/floor-first.html"),
    repositoryFile("public/safety.html"),
    repositoryFile("public/privacy.html"),
    repositoryFile("public/support.html"),
  ]);

  for (const page of pages) {
    assert.match(page, /rel="canonical" href="https:\/\/stabilize\.info\//);
    assert.match(page, /meta name="robots" content="index,follow/);
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
  assert.match(about, /50 GPT-5\.6 Fast\s+messages per UTC day/i);
  assert.match(about, /current paid model-allowance subscription\s+enables subscriber model choice/i);
  assert.match(about, /not emergency care/i);
  assert.match(enhancer, /href=\"\/about\.html\"/);

  for (const page of [howItWorks, floorFirst, safety, privacy]) {
    assert.match(page, /href="\/about\.html">About<\/a>/);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the About page states the product limits and funding problem honestly", async () => {
  const about = await read("public/about.html");

  assert.match(about, /That experience explains the\s+mission\. It does not, by itself, prove that the\s+product works\./);
  assert.match(about, /has not been clinically validated/i);
  assert.match(about, /cannot predict a\s+crisis/i);
  assert.match(about, /Impact requires sustainability/);
  assert.match(about, /current paid model-choice subscription is an early payment experiment/i);
  assert.match(about, /href="\/sustainability\.html"/);
});

test("the public sustainability page provides a real revenue route with firm boundaries", async () => {
  const [page, homePageSource, sitemap] = await Promise.all([
    read("public/sustainability.html"),
    read("src/page.js"),
    read("public/sitemap.xml"),
  ]);

  assert.match(page, /action="\/billing\/checkout" method="post"/);
  assert.match(page, /Support Stabilize and unlock model choice/);
  assert.match(page, /organizational pilots/i);
  assert.match(page, /fixed monthly ceiling/i);
  assert.match(page, /should not count “lives saved[,.”]/i);
  assert.match(page, /should not fund itself with advertising, sale of conversation data/i);
  assert.match(homePageSource, /href="\/about\.html">About<\/a>/);
  assert.match(homePageSource, /href="\/sustainability\.html">Sustainability<\/a>/);
  assert.match(sitemap, /https:\/\/stabilize\.info\/sustainability\.html/);
});

test("the internal business plan includes pricing, unit economics, decision gates, and stop conditions", async () => {
  const plan = await read("docs/SUSTAINABLE_GROWTH_PLAN.md");

  assert.match(plan, /\$8–\$12 per month/);
  assert.match(plan, /\$5,000–\$15,000/);
  assert.match(plan, /65% gross margin/);
  assert.match(plan, /six months of runway/i);
  assert.match(plan, /Twelve-month operating plan/);
  assert.match(plan, /Main risks and stop conditions/);
  assert.match(plan, /Illustrative use of a \$10,000 bootstrap grant/);
  assert.match(plan, /Do not report “lives saved[.”]/);
});

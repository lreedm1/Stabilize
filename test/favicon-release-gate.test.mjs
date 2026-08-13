import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the main-branch favicon gate validates the committed static icon contract", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/favicon-release-gate.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /push:[\s\S]*branches:[\s\S]*- main/);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(
    workflow,
    /node --test[\s\S]*model-tile-favicon\.test\.mjs[\s\S]*favicon-source-validation\.test\.mjs/,
  );
  assert.match(workflow, /embed-favicon-fallback\.mjs/);
  assert.match(workflow, /stabilize-tab-20260813-static-32\.png/);
  assert.match(workflow, /stabilize-tab-20260813\.svg/);
  assert.match(workflow, /favicon\.ico/);
  assert.match(workflow, /test ! -e public\/favicon-refresh\.js/);
});

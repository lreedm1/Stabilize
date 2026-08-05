import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the main-branch favicon gate verifies the new icon identity and Safari assets", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/favicon-release-gate.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /push:[\s\S]*branches:[\s\S]*- main/);
  assert.match(workflow, /statuses:\s*write/);
  assert.match(workflow, /"context":"verification\/favicon"/);
  assert.match(workflow, /stabilize-tab-20260805\.ico\?favicon-gate=/);
  assert.match(workflow, /stabilize-tab-20260805-16\.png\?favicon-gate=/);
  assert.match(workflow, /stabilize-tab-20260805-32\.png\?favicon-gate=/);
  assert.match(workflow, /stabilize-app-20260805-180\.png\?favicon-gate=/);
  assert.match(workflow, /safari-pinned-tab\.svg\?favicon-gate=/);
  assert.match(workflow, /site\.webmanifest\?favicon-gate=/);
  assert.match(workflow, /favicon-refresh\.js\?v=20260805-8/);
  assert.match(workflow, /ico_magic[\s\S]*00000100/);
  assert.match(workflow, /png16_magic[\s\S]*89504e470d0a1a0a/);
  assert.match(workflow, /png32_magic[\s\S]*89504e470d0a1a0a/);
  assert.match(workflow, /viewBox="0 0 16 16"/);
  assert.match(workflow, /application\/manifest\+json/);
  assert.match(
    workflow,
    /New tab-icon identity, Safari mask, MIME, and byte checks passed/,
  );
});

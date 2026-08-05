import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the main-branch favicon gate publishes a status only after live byte checks", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/favicon-release-gate.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /push:[\s\S]*branches:[\s\S]*- main/);
  assert.match(workflow, /statuses:\s*write/);
  assert.match(workflow, /"context":"verification\/favicon"/);
  assert.match(workflow, /favicon\.ico\?favicon-gate=/);
  assert.match(workflow, /favicon-32x32\.png\?favicon-gate=/);
  assert.match(workflow, /apple-touch-icon\.png\?favicon-gate=/);
  assert.match(workflow, /ico_magic[\s\S]*00000100/);
  assert.match(workflow, /png_magic[\s\S]*89504e470d0a1a0a/);
  assert.match(workflow, /image\/x-icon/);
  assert.match(workflow, /image\/png/);
  assert.match(workflow, /Live ICO, PNG, Apple icon, MIME, and HTML checks passed/);
});

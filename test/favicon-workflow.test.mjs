import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production favicon verification checks HTML, MIME types, and file signatures", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/verify-favicon.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_run:[\s\S]*Deploy Stabilize to Cloudflare/);
  assert.match(workflow, /favicon\.ico\?favicon-check=/);
  assert.match(workflow, /favicon-32x32\.png\?favicon-check=/);
  assert.match(workflow, /apple-touch-icon\.png\?favicon-check=/);
  assert.match(workflow, /ico_magic[\s\S]*00000100/);
  assert.match(workflow, /png_magic[\s\S]*89504e470d0a1a0a/);
  assert.match(workflow, /image\/x-icon/);
  assert.match(workflow, /image\/png/);
});

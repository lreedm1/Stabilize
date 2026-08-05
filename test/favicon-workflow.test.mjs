import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("post-deploy favicon verification checks new URLs, Safari mask, and bytes", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/verify-favicon.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_run:[\s\S]*Deploy Stabilize to Cloudflare/);
  assert.match(workflow, /stabilize-tab-20260805\.ico\?favicon-check=/);
  assert.match(workflow, /stabilize-tab-20260805-16\.png\?favicon-check=/);
  assert.match(workflow, /stabilize-tab-20260805-32\.png\?favicon-check=/);
  assert.match(workflow, /safari-pinned-tab\.svg\?favicon-check=/);
  assert.match(workflow, /favicon-refresh\.js\?v=20260805-8/);
  assert.match(workflow, /ico_magic[\s\S]*00000100/);
  assert.match(workflow, /png16_magic[\s\S]*89504e470d0a1a0a/);
  assert.match(workflow, /png32_magic[\s\S]*89504e470d0a1a0a/);
  assert.match(workflow, /image\/x-icon/);
  assert.match(workflow, /image\/png/);
  assert.match(workflow, /image\/svg\+xml/);
  assert.match(workflow, /viewBox="0 0 16 16"/);
});

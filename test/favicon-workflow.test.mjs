import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("post-deploy favicon verification checks the static PNG, SVG, ICO, and source HTML", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/verify-favicon.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_run:[\s\S]*Deploy Stabilize to Cloudflare/);
  assert.match(workflow, /favicon\.ico\?favicon-check=/);
  assert.match(
    workflow,
    /stabilize-tab-20260813-static-32\.png\?favicon-check=/,
  );
  assert.match(workflow, /stabilize-tab-20260813\.svg\?favicon-check=/);
  assert.match(workflow, /safari-pinned-tab\.svg\?favicon-check=/);
  assert.match(workflow, /site\.webmanifest\?favicon-check=/);
  assert.match(workflow, /ico_magic[\s\S]*00000100/);
  assert.match(workflow, /png_magic[\s\S]*89504e470d0a1a0a/);
  assert.match(workflow, /image\/x-icon/);
  assert.match(workflow, /image\/png/);
  assert.match(workflow, /image\/svg\+xml/);
  assert.match(workflow, /max-age=31536000/);
  assert.match(workflow, /immutable/);
  assert.match(workflow, /does not use runtime favicon mutation/);
  assert.match(workflow, /! grep -Fq 'favicon-refresh\.js'/);
  assert.match(workflow, /! grep -Fq 'data:image\/'/);
});

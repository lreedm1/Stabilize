import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production favicon check targets the canonical PNG", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/verify-favicon.yml", import.meta.url),
    "utf8",
  );
  assert.ok(workflow.includes("favicon-32x32.png?favicon-check="));
  assert.ok(workflow.includes("favicon.ico?favicon-check="));
  assert.ok(workflow.includes("one canonical browser favicon"));
});

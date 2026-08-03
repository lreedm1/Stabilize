import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("remembered risk is timestamped and devalued with age", async () => {
  const [memorySource, policySource] = await Promise.all([
    readFile(new URL("../src/session-memory.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/apply-recency-policy.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(memorySource, /SAFETY_ANSWER_MAX_AGE_MS = 2 \* 60 \* 60 \* 1_000/);
  assert.match(memorySource, /SELECT role, content, created_at/);
  assert.match(memorySource, /\[Recorded \$\{new Date\(timestamp\)\.toISOString\(\)\}/);
  assert.match(memorySource, /older context with reduced relevance/);
  assert.match(memorySource, /historical context only/);
  assert.match(memorySource, /not evidence of present danger or current intent/);
  assert.match(memorySource, /now - updatedAt <= SAFETY_ANSWER_MAX_AGE_MS/);

  assert.match(policySource, /Judge the user's present state from the current turn/);
  assert.match(policySource, /Past suicidality, crisis, or danger is historical awareness only/);
  assert.match(policySource, /A neutral greeting must receive a normal greeting/);
  assert.match(policySource, /after 3 days it is historical background only/);
  assert.match(policySource, /Preserve dates or age labels for safety events and deadlines/);
});

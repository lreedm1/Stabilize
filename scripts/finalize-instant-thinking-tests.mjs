import { readFile, writeFile } from "node:fs/promises";

const path = "test/prompt-policy-idempotency.test.mjs";
const before = await readFile(path, "utf8");
let after = before;

if (!after.includes('"scripts/prepare-instant-thinking-policy.mjs"')) {
  const marker = '  "scripts/prepare-openai-policy-pass.mjs",\n';
  if (!after.includes(marker)) {
    throw new Error("Could not locate the reasoning-policy preparation fixture");
  }
  after = after.replace(
    marker,
    `${marker}  "scripts/prepare-instant-thinking-policy.mjs",\n`,
  );
}

if (!after.includes('"scripts/finalize-instant-thinking-tests.mjs"')) {
  const marker = '  "scripts/add-instant-thinking-menu.mjs",\n';
  if (!after.includes(marker)) {
    throw new Error("Could not locate the instant-thinking fixture");
  }
  after = after.replace(
    marker,
    `${marker}  "scripts/finalize-instant-thinking-tests.mjs",\n`,
  );
}

if (after !== before) await writeFile(path, after);
console.log("Finalized instant-thinking idempotency fixtures.");

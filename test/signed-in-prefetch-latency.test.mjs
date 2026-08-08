import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("signed-in memory prefetch stays outside the guest chat application", async () => {
  const [
    auth,
    billingAccount,
    paidWorker,
    billingClient,
    app,
    readme,
    privacy,
    publicPrivacy,
    packageSource,
    generator,
  ] = await Promise.all([
    read("src/auth.js"),
    read("src/billing-account.js"),
    read("src/paid-worker.js"),
    read("public/billing-client.js"),
    read("public/app.js"),
    read("README.md"),
    read("PRIVACY.md"),
    read("public/privacy.html"),
    read("package.json"),
    read("scripts/apply-signed-in-prefetch-latency.mjs"),
  ]);

  assert.match(auth, /createAccountContextToken/);
  assert.match(auth, /readAccountContextToken/);
  assert.match(auth, /ACCOUNT_CONTEXT_TOKEN_SECONDS = 15 \* 60/);
  assert.match(auth, /payload\.a !== expectedAccount/);
  assert.match(auth, /cachedHmacKeyPromise/);
  assert.match(auth, /maxLength = 4_096/);

  assert.match(billingAccount, /CREATE TABLE IF NOT EXISTS account_context_state/);
  assert.match(billingAccount, /async setMemoryGeneration\(value\)/);
  assert.match(billingAccount, /includeMemoryGeneration/);
  assert.match(billingAccount, /memoryGeneration: this\.memoryGeneration\(\)/);

  assert.match(paidWorker, /\/api\/account\/context/);
  assert.match(paidWorker, /preparedMemoryFromAccountContext/);
  assert.match(paidWorker, /source: "prefetched"/);
  assert.match(paidWorker, /X-Stabilize-Memory-Source/);
  assert.match(paidWorker, /prefetched\.value\.generation === currentGeneration/);
  assert.match(paidWorker, /syncBillingMemoryGeneration/);
  assert.match(
    paidWorker,
    /url\.pathname === "\/api\/account\/memory"[\s\S]*url\.pathname === "\/api\/conversation\/new"/,
  );
  assert.doesNotMatch(paidWorker, /const memoryWarmup = readMemoryContext/);

  assert.match(billingClient, /Signed-in account-context prefetch/);
  assert.match(billingClient, /refreshAccountContext/);
  assert.match(billingClient, /accountContextToken/);
  assert.match(billingClient, /observeAccountContextResponse/);
  assert.doesNotMatch(billingClient, /localStorage\.setItem/);
  assert.doesNotMatch(billingClient, /sessionStorage\.setItem/);
  assert.match(paidWorker, /billing-client\.js\?v=20260808-account-preflight-1/);

  assert.doesNotMatch(app, /accountContextToken/);
  assert.doesNotMatch(app, /Signed-in account-context prefetch/);
  assert.match(app, /MAX_GUEST_SUMMARY_CHARS = 30_000/);

  for (const source of [readme, privacy, publicPrivacy]) {
    assert.match(source, /short-lived/i);
    assert.match(source, /account-context snapshot/i);
    assert.match(source, /localStorage or sessionStorage/);
  }

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /finalize-decision-grade-impact\.mjs$/,
  );
  assert.match(
    packageJson.scripts["test:node"],
    /signed-in-prefetch-latency\.test\.mjs/,
  );
  assert.match(
    packageJson.scripts["test:worker"],
    /signed-in-prefetch-latency-worker\.test\.mjs/,
  );
  assert.match(generator, /accountContextWrappedFetch/);
});

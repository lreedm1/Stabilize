import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("signed-in quota and subscription are checked before send", async () => {
  const [billingAccount, paidWorker, billingClient, packageSource] =
    await Promise.all([
      read("src/billing-account.js"),
      read("src/paid-worker.js"),
      read("public/billing-client.js"),
      read("package.json"),
    ]);

  assert.match(billingAccount, /async previewChat\(options\)/);
  assert.match(billingAccount, /subscriptionStatus: status/);
  assert.match(
    billingAccount,
    /remaining: Math\.max\(0, config\.freeLimit - used\)/,
  );
  assert.match(
    paidWorker,
    /accountStub\.previewChat\(chatPreparationOptions\(env\)\)/,
  );
  assert.match(
    paidWorker,
    /Promise\.all\(\[\s*memoryPromise,\s*billingPromise/,
  );
  assert.match(paidWorker, /X-Stabilize-Billing-Source/);
  assert.match(
    paidWorker,
    /billing-client\.js\?v=20260808-account-preflight-1/,
  );
  assert.doesNotMatch(paidWorker, /body\.accountBillingPreflight/);
  assert.match(billingClient, /normalizeAccountBillingPreflight/);
  assert.match(billingClient, /installAccountBillingPreflight/);
  assert.match(billingClient, /scheduleAccountContextRefresh/);
  assert.match(billingClient, /visibilitychange/);
  assert.match(billingClient, /#message-input/);
  assert.doesNotMatch(
    billingClient,
    /await refreshAccountContext\(\);\s*const response = await accountContextWrappedFetch/,
  );
  assert.doesNotMatch(billingClient, /localStorage\.setItem/);

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /finalize-decision-grade-impact\.mjs$/,
  );
  assert.match(
    packageJson.scripts["test:node"],
    /account-preflight\.test\.mjs/,
  );
  assert.match(
    packageJson.scripts["test:worker"],
    /account-preflight-worker\.test\.mjs/,
  );
});

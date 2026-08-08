import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("signed-in memory is prefetched off the critical chat path", async () => {
  const [
    auth,
    paidWorker,
    billingAccount,
    sessionMemory,
    index,
    app,
    page,
    privacy,
    publicPrivacy,
    packageSource,
  ] = await Promise.all([
    read("src/auth.js"),
    read("src/paid-worker.js"),
    read("src/billing-account.js"),
    read("src/session-memory.js"),
    read("src/index.js"),
    read("public/app.js"),
    read("src/page.js"),
    read("PRIVACY.md"),
    read("public/privacy.html"),
    read("package.json"),
  ]);

  assert.match(auth, /createAccountContextToken/);
  assert.match(auth, /readAccountContextToken/);
  assert.match(auth, /ACCOUNT_CONTEXT_TOKEN_SECONDS = 15 \* 60/);
  assert.match(auth, /cachedHmacKeyPromise/);
  assert.match(auth, /maxLength = 4_096/);
  assert.match(auth, /payload\.a !== expectedAccount/);

  assert.match(paidWorker, /\/api\/account\/context/);
  assert.match(paidWorker, /preparedMemoryFromAccountContext/);
  assert.match(paidWorker, /source: "prefetched"/);
  assert.match(paidWorker, /X-Stabilize-Memory-Source/);
  assert.match(paidWorker, /readAccountContextToken/);
  assert.match(paidWorker, /syncBillingMemoryGeneration/);
  assert.match(
    paidWorker,
    /prefetchedMemory\.generation === currentGeneration/,
  );
  assert.match(
    paidWorker,
    /Promise\.all\(\[prefetchedMemoryPromise, billingPreparation\]\)/,
  );
  assert.match(
    paidWorker,
    /url\.pathname === "\/api\/account\/memory"[\s\S]*url\.pathname === "\/api\/conversation\/new"/,
  );

  assert.match(billingAccount, /CREATE TABLE IF NOT EXISTS account_context_state/);
  assert.match(billingAccount, /async setMemoryGeneration\(value\)/);
  assert.match(billingAccount, /memoryGeneration,/);
  assert.match(sessionMemory, /return \{ started: true, generation \}/);

  assert.match(
    index,
    /streamChatReply\([\s\S]*?stub,\s*memory\.generation,\s*ctx,/,
  );
  assert.match(index, /expectedGeneration: memory\.generation/);
  assert.match(
    index,
    /recordFixedRoute\([\s\S]*?memory\.generation/,
  );
  assert.match(index, /jsonResponse\(\{ ok: true, generation \}\)/);

  assert.match(app, /fetch\("\/api\/account\/context"/);
  assert.match(app, /accountContextToken/);
  assert.match(app, /signedInThreadMessages/);
  assert.match(app, /prefetchAccountContextToken/);
  assert.match(app, /accountContextToken: contextToken \|\| undefined/);
  assert.match(app, /if \(signedIn && !privateChat\) void prefetchAccountContextToken\(\)/);
  assert.match(app, /\^\[A-Za-z0-9_-\]\+\\\.\[A-Za-z0-9_-\]\+\$/);
  assert.match(page, /app\.js\?v=20260808-signed-in-prefetch-1/);

  assert.match(privacy, /short-lived HMAC-signed snapshot/);
  assert.match(privacy, /signed-in account binding/);
  assert.match(privacy, /current memory generation/);
  assert.match(privacy, /not written to localStorage or sessionStorage/);
  assert.match(publicPrivacy, /short-lived HMAC-signed memory snapshot/);
  assert.match(publicPrivacy, /current memory/);

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /finalize-signed-in-context-prefetch\.mjs$/,
  );
  assert.match(
    packageJson.scripts["test:node"],
    /signed-in-context-prefetch\.test\.mjs/,
  );
  assert.match(
    packageJson.scripts["test:worker"],
    /signed-in-context-prefetch-worker\.test\.mjs/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("signed-in memory is prefetched off the critical chat path", async () => {
  const [auth, paidWorker, index, app, page, privacy, publicPrivacy, packageSource] =
    await Promise.all([
      read("src/auth.js"),
      read("src/paid-worker.js"),
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

  assert.match(paidWorker, /\/api\/account\/context/);
  assert.match(paidWorker, /preparedMemoryFromAccountContext/);
  assert.match(paidWorker, /source: "prefetched"/);
  assert.match(paidWorker, /X-Stabilize-Memory-Source/);
  assert.match(paidWorker, /readAccountContextToken/);
  assert.match(paidWorker, /Promise\.all\(\[\s*billingPreparation,\s*memoryPreparation/);

  assert.match(
    index,
    /streamChatReply\([\s\S]*?stub,\s*memory\.generation,\s*ctx,/,
  );
  assert.match(index, /expectedGeneration: memory\.generation/);
  assert.match(
    index,
    /recordFixedRoute\([\s\S]*?memory\.generation/,
  );

  assert.match(app, /fetch\("\/api\/account\/context"/);
  assert.match(app, /accountContextToken/);
  assert.match(app, /signedInThreadMessages/);
  assert.match(app, /prefetchAccountContextToken/);
  assert.match(app, /accountContextToken: contextToken \|\| undefined/);
  assert.match(app, /if \(signedIn && !privateChat\) void prefetchAccountContextToken\(\)/);
  assert.match(page, /app\.js\?v=20260808-signed-in-prefetch-1/);

  assert.match(privacy, /short-lived HMAC-signed snapshot/);
  assert.match(privacy, /not written to localStorage or sessionStorage/);
  assert.match(publicPrivacy, /short-lived HMAC-signed memory snapshot/);

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /apply-signed-in-context-prefetch\.mjs$/,
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

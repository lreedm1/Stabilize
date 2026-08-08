import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function read(path) {
  return readFile(path, "utf8");
}

async function update(path, transform) {
  const before = await read(path);
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Signed-in prefetch finalizer could not find ${label}`);
  }
  return source.replace(before, after);
}

function insertBefore(source, marker, addition, label) {
  const additionMarker = addition.trim().split("\n")[0];
  if (additionMarker && source.includes(additionMarker)) return source;
  const index = source.indexOf(marker);
  if (index < 0) {
    throw new Error(`Signed-in prefetch finalizer could not find ${label}`);
  }
  return source.slice(0, index) + addition + source.slice(index);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Signed-in prefetch finalizer could not replace ${label}`);
  }
  const current = source.slice(start, end);
  if (current === replacement) return source;
  return source.slice(0, start) + replacement + source.slice(end);
}

const prefetchPipeline =
  "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs && node scripts/apply-signed-in-context-prefetch.mjs";
const finalPipeline =
  prefetchPipeline + " && node scripts/finalize-signed-in-context-prefetch.mjs";

// Make the source generator marker-based and preserve escapes on every run.
await update("scripts/apply-signed-in-context-prefetch.mjs", (source) =>
  source
    .replace(
      "  if (source.includes(addition.trim())) return source;",
      `  const additionMarker = addition.trim().split("\\n")[0];
  if (additionMarker && source.includes(additionMarker)) return source;`,
    )
    .replace(
      'previous.content + "\\n" + message.content,',
      'previous.content + "\\\\n" + message.content,',
    )
    .replace(
      "!/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(token)",
      "!/^[A-Za-z0-9_-]+\\\\.[A-Za-z0-9_-]+$/.test(token)",
    ),
);

await update("src/auth.js", (source) => {
  const createToken = `export async function createAccountContextToken(
  accountKey,
  context,
  env,
  nowMs = Date.now(),
) {
  const account = String(accountKey || "");
  if (!ACCOUNT_KEY_PATTERN.test(account)) {
    throw new GoogleAuthFlowError("InvalidAccountContextAccount");
  }
  const { authSecret } = googleConfig(env);
  const issuedAt = Math.floor(nowMs / 1_000);
  return signToken(
    {
      v: 1,
      a: account,
      iat: issuedAt,
      exp: issuedAt + ACCOUNT_CONTEXT_TOKEN_SECONDS,
      c: context,
    },
    authSecret,
    "account-context",
  );
}

`;
  let next = replaceBlock(
    source,
    "export async function createAccountContextToken(\n",
    "export async function readAccountContextToken(\n",
    createToken,
    "the account-context token creator",
  );

  const readToken = `export async function readAccountContextToken(
  token,
  accountKey,
  env,
  nowMs = Date.now(),
) {
  if (!token) return null;
  const expectedAccount = String(accountKey || "");
  if (!ACCOUNT_KEY_PATTERN.test(expectedAccount)) return null;
  const { authSecret } = googleConfig(env);
  const payload = await verifyToken(
    token,
    authSecret,
    "account-context",
    16_384,
  );
  const now = Math.floor(nowMs / 1_000);
  if (
    payload?.v !== 1 ||
    payload.a !== expectedAccount ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.iat > now + 60 ||
    payload.exp <= now ||
    payload.exp - payload.iat !== ACCOUNT_CONTEXT_TOKEN_SECONDS ||
    !payload.c ||
    typeof payload.c !== "object"
  ) {
    return null;
  }
  return payload.c;
}

`;
  next = replaceBlock(
    next,
    "export async function readAccountContextToken(\n",
    "export async function beginGoogleSignIn(request, env) {\n",
    readToken,
    "the account-context token reader",
  );
  return next;
});

await update("src/session-memory.js", (source) => {
  const replacement = `  async startNewConversation() {
    const generation = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM recent_messages");
      this.ctx.storage.sql.exec(
        \`UPDATE memory_state
         SET awaiting_safety_answer = 0
         WHERE id = 1\`,
      );
      this.ctx.storage.sql.exec(
        "UPDATE memory_control SET generation = generation + 1 WHERE id = 1",
      );
      return this.currentGeneration();
    });

    return { started: true, generation };
  }

`;
  return replaceBlock(
    source,
    "  async startNewConversation() {\n",
    "  async deleteRememberedContext() {\n",
    replacement,
    "the new-conversation generation result",
  );
});

await update("src/billing-account.js", (source) => {
  let next = source;
  const contextTable = `      this.ctx.storage.sql.exec(\`
        CREATE TABLE IF NOT EXISTS account_context_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          memory_generation INTEGER NOT NULL DEFAULT 0 CHECK (memory_generation >= 0),
          updated_at INTEGER NOT NULL
        );
      \`);
      this.ctx.storage.sql.exec(\`
        INSERT OR IGNORE INTO account_context_state (
          id, memory_generation, updated_at
        ) VALUES (1, 0, 0);
      \`);
`;
  next = insertBefore(
    next,
    "      this.ctx.storage.sql.exec(`\n        INSERT OR IGNORE INTO model_usage (\n",
    contextTable,
    "the account-context generation table",
  );

  const generationMethods = `  memoryGeneration() {
    const row = this.ctx.storage.sql
      .exec(
        "SELECT memory_generation FROM account_context_state WHERE id = 1",
      )
      .toArray()[0];
    return Math.max(0, Number(row?.memory_generation) || 0);
  }

  async setMemoryGeneration(value) {
    const supplied = Number(value);
    if (!Number.isSafeInteger(supplied) || supplied < 0) {
      throw new Error("Invalid memory generation");
    }

    return this.ctx.storage.transactionSync(() => {
      const current = this.memoryGeneration();
      const generation = Math.max(current, supplied);
      if (generation !== current) {
        this.ctx.storage.sql.exec(
          \`UPDATE account_context_state
           SET memory_generation = ?, updated_at = ?
           WHERE id = 1\`,
          generation,
          Date.now(),
        );
      }
      return generation;
    });
  }

`;
  next = insertBefore(
    next,
    "  readUsage(tier) {\n",
    generationMethods,
    "the account-context generation methods",
  );

  let prepare = next.slice(
    next.indexOf("  async prepareChat(options) {\n"),
    next.indexOf("  async refundUsage(", next.indexOf("  async prepareChat(options) {\n")),
  );
  if (!prepare.includes("const memoryGeneration = this.memoryGeneration();")) {
    prepare = replaceRequired(
      prepare,
      `      const storedModel = cleanModelId(billing?.selected_model);
`,
      `      const storedModel = cleanModelId(billing?.selected_model);
      const memoryGeneration = this.memoryGeneration();
`,
      "the prepareChat memory generation read",
    );
  }
  prepare = prepare
    .replace(
      `            reservationMade: false,
          };`,
      `            reservationMade: false,
            memoryGeneration,
          };`,
    )
    .replaceAll(
      `          reservationMade: reservation.allowed,
        };`,
      `          reservationMade: reservation.allowed,
          memoryGeneration,
        };`,
    )
    .replace(
      `          reservationMade: true,
        };`,
      `          reservationMade: true,
          memoryGeneration,
        };`,
    )
    .replace(
      `        reservationMade: false,
      };`,
      `        reservationMade: false,
        memoryGeneration,
      };`,
    );
  next = replaceBlock(
    next,
    "  async prepareChat(options) {\n",
    "  async refundUsage(",
    prepare,
    "the prepareChat generation result",
  );
  return next;
});

await update("src/index.js", (source) => {
  const replacement = `async function handleNewConversation(request, env, accountKey) {
  const body = await readBoundedJson(request);
  let generation = null;
  if (body?.privateChat !== true) {
    const stub = accountMemoryStub(env, accountKey);
    if (stub && typeof stub.startNewConversation === "function") {
      const result = await stub.startNewConversation();
      const suppliedGeneration = Number(result?.generation);
      generation =
        Number.isSafeInteger(suppliedGeneration) && suppliedGeneration >= 0
          ? suppliedGeneration
          : null;
    }
  }
  return jsonResponse({ ok: true, generation });
}

`;
  return replaceBlock(
    source,
    "async function handleNewConversation(request, env, accountKey) {\n",
    "export async function handlePreparedChat(\n",
    replacement,
    "the new-conversation response",
  );
});

await update("src/paid-worker.js", (source) => {
  let next = source
    .replace(
      'previous.content + "\n" + message.content,',
      'previous.content + "\\n" + message.content,',
    )
    .replace(
      "!/^[A-Za-z0-9_-]+.[A-Za-z0-9_-]+$/.test(token)",
      "!/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(token)",
    );

  const syncHelper = `async function syncBillingMemoryGeneration(stub, value) {
  const generation = Number(value);
  if (!Number.isSafeInteger(generation) || generation < 0) return null;
  if (!stub || typeof stub.setMemoryGeneration !== "function") {
    return generation;
  }
  try {
    return await stub.setMemoryGeneration(generation);
  } catch (error) {
    console.error(JSON.stringify({
      event: "billing_memory_generation_sync_failed",
      error: error instanceof Error ? error.name : "UnknownError",
    }));
    return null;
  }
}

`;
  next = insertBefore(
    next,
    "async function accountContextResponse(request, env) {\n",
    syncHelper,
    "the billing generation sync helper",
  );

  const accountContextHandler = `async function accountContextResponse(request, env) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  const authSession = await readAuthSession(request, env);
  if (!authSession) {
    return jsonResponse({ error: "Sign in to use account memory." }, 401);
  }

  const memoryStub = accountMemoryStub(env, authSession.accountKey);
  const accountStub = billingStub(env, authSession.accountKey);
  let memory = await readMemoryContext(memoryStub);
  const syncedGeneration = await syncBillingMemoryGeneration(
    accountStub,
    memory.generation,
  );
  if (
    Number.isSafeInteger(syncedGeneration) &&
    syncedGeneration !== memory.generation
  ) {
    memory = await readMemoryContext(memoryStub);
    await syncBillingMemoryGeneration(accountStub, memory.generation);
  }
  const token = await createAccountContextToken(
    authSession.accountKey,
    boundedAccountContext(memory),
    env,
  );
  return jsonResponse(
    {
      token,
      expiresInSeconds: ACCOUNT_CONTEXT_TOKEN_SECONDS,
    },
    200,
    { "X-Stabilize-Memory-Source": "durable-object" },
  );
}

`;
  next = replaceBlock(
    next,
    "async function accountContextResponse(request, env) {\n",
    "async function checkoutResponse(request, env) {\n",
    accountContextHandler,
    "the account-bound context endpoint",
  );

  const memoryControlHandler = `async function memoryControlResponse(request, env, ctx) {
  const authSessionPromise = readAuthSession(request, env);
  const response = await originalWorker.fetch(request, env, ctx);
  if (!response.ok) return response;

  const authSession = await authSessionPromise;
  if (!authSession) return response;
  let result;
  try {
    result = await response.clone().json();
  } catch {
    return response;
  }
  await syncBillingMemoryGeneration(
    billingStub(env, authSession.accountKey),
    result?.generation,
  );
  return response;
}

`;
  next = insertBefore(
    next,
    "async function shouldRefundModelUsage(response) {\n",
    memoryControlHandler,
    "the memory-control synchronization handler",
  );

  const preparationBlock = `  const memoryStub = body?.privateChat === true
    ? null
    : accountMemoryStub(env, authSession.accountKey);
  const memoryStartedAt = Date.now();
  const prefetchedMemoryPromise = body?.privateChat === true
    ? Promise.resolve(null)
    : readAccountContextToken(
        String(body?.accountContextToken || ""),
        authSession.accountKey,
        env,
      )
        .then((context) =>
          preparedMemoryFromAccountContext(context, body?.messages),
        )
        .catch(() => null);
  const billingStartedAt = Date.now();
  const billingPreparation = stub
    .prepareChat(chatPreparationOptions(env, body))
    .then((value) => ({
      value,
      durationMs: Date.now() - billingStartedAt,
    }));
  const memoryPreparation = body?.privateChat === true
    ? Promise.resolve({
        value: emptyMemoryContext(),
        durationMs: 0,
        source: "private",
      })
    : Promise.all([prefetchedMemoryPromise, billingPreparation]).then(
        async ([prefetchedMemory, preparedBilling]) => {
          const suppliedGeneration = Number(
            preparedBilling.value?.memoryGeneration,
          );
          const currentGeneration =
            Number.isSafeInteger(suppliedGeneration) && suppliedGeneration >= 0
              ? suppliedGeneration
              : 0;
          if (
            prefetchedMemory &&
            prefetchedMemory.generation === currentGeneration
          ) {
            return {
              value: prefetchedMemory,
              durationMs: Date.now() - memoryStartedAt,
              source: "prefetched",
            };
          }

          const value = await readMemoryContext(memoryStub);
          await syncBillingMemoryGeneration(stub, value.generation);
          return {
            value,
            durationMs: Date.now() - memoryStartedAt,
            source: "durable-object",
          };
        },
      );
  const [billingResult, memoryResult] = await Promise.all([
    billingPreparation,
    memoryPreparation,
  ]);
`;
  next = replaceBlock(
    next,
    "  const memoryStub = body?.privateChat === true\n",
    "  const preparation = billingResult.value;\n",
    preparationBlock,
    "the generation-checked chat preparation",
  );

  next = replaceRequired(
    next,
    `      if (url.pathname === "/api/account/context") {
        return await accountContextResponse(request, env);
      }`,
    `      if (
        url.pathname === "/api/account/memory" ||
        url.pathname === "/api/conversation/new"
      ) {
        return await memoryControlResponse(request, env, ctx);
      }
      if (url.pathname === "/api/account/context") {
        return await accountContextResponse(request, env);
      }`,
    "the synchronized memory-control routes",
  );
  return next;
});

await update("public/app.js", (source) =>
  source.replace(
    "!/^[A-Za-z0-9_-]+.[A-Za-z0-9_-]+$/.test(token)",
    "!/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(token)",
  ),
);

await update("README.md", (source) =>
  source.replace(
    "the page prefetches a bounded, short-lived HMAC-signed memory snapshot into tab memory and returns that opaque token with the next chat request; the token is refreshed after successful replies and is not written to localStorage or sessionStorage.",
    "the page prefetches a bounded, short-lived HMAC-signed memory snapshot into tab memory and returns that opaque token with the next chat request; the token is bound to the signed-in account, checked against the current cross-device memory generation returned by the existing quota lookup, refreshed after successful replies, and not written to localStorage or sessionStorage.",
  ),
);

await update("PRIVACY.md", (source) =>
  source.replace(
    "The Worker verifies the signature and expiry before using the snapshot; an invalid or expired token falls back to the Durable Object. The token is not written to localStorage or sessionStorage.",
    "The Worker verifies the signature, expiry, signed-in account binding, and current memory generation before using the snapshot; an invalid, expired, cross-account, or superseded token falls back to the Durable Object. The generation is carried by the quota lookup already required for signed-in chat, so this revocation check adds no separate chat round trip. Deleting memory or starting a new conversation advances that generation across devices before the control request returns. The token is not written to localStorage or sessionStorage.",
  ),
);

await update("public/privacy.html", (source) =>
  source.replace(
    "        sessionStorage. Invalid or expired tokens fall back to the Durable Object.\n",
    "        sessionStorage. The Worker also checks the signed-in account and the current memory\n        generation returned by the existing quota lookup, so deleted or superseded context is not\n        accepted from another tab or device. Invalid, expired, cross-account, or superseded tokens\n        fall back to the Durable Object.\n",
  ),
);

async function testFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await testFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

for (const path of await testFiles("test")) {
  await update(path, (source) =>
    source
      .split(prefetchPipeline)
      .join(finalPipeline)
      .replace(
        /apply-signed-in-context-prefetch\\\.mjs\$\//g,
        "finalize-signed-in-context-prefetch\\.mjs$/",
      ),
  );
}

console.log(
  "Finalized account-bound, generation-revoked signed-in context prefetch.",
);

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
    throw new Error(`Signed-in prefetch policy could not find ${label}`);
  }
  return source.replace(before, after);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Signed-in prefetch policy could not replace ${label}`);
  }
  const current = source.slice(start, end);
  if (current === replacement) return source;
  return source.slice(0, start) + replacement + source.slice(end);
}

function insertBefore(source, marker, addition, uniqueMarker, label) {
  if (source.includes(uniqueMarker)) return source;
  const index = source.indexOf(marker);
  if (index < 0) {
    throw new Error(`Signed-in prefetch policy could not find ${label}`);
  }
  return source.slice(0, index) + addition + source.slice(index);
}

function appendOnce(source, marker, addition) {
  if (source.includes(marker)) return source;
  return source.trimEnd() + "\n\n" + addition.trim() + "\n";
}

const currentPipeline =
  "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs && node scripts/add-guest-summary.mjs";
const nextPipeline =
  currentPipeline + " && node scripts/apply-signed-in-prefetch-latency.mjs";

await update("src/auth.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    "const OAUTH_STATE_SECONDS = 10 * 60;\n",
    "const OAUTH_STATE_SECONDS = 10 * 60;\nconst ACCOUNT_CONTEXT_TOKEN_SECONDS = 15 * 60;\n",
    "the account-context token lifetime",
  );
  next = replaceRequired(
    next,
    "const decoder = new TextDecoder();\n",
    "const decoder = new TextDecoder();\nlet cachedHmacSecret = null;\nlet cachedHmacKeyPromise = null;\n",
    "the cached HMAC key state",
  );

  const hmacKey = `async function hmacKey(secret) {
  const normalized = String(secret || "");
  if (cachedHmacSecret === normalized && cachedHmacKeyPromise) {
    return cachedHmacKeyPromise;
  }

  const keyPromise = crypto.subtle.importKey(
    "raw",
    encoder.encode(normalized),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cachedHmacSecret = normalized;
  cachedHmacKeyPromise = keyPromise;

  try {
    return await keyPromise;
  } catch (error) {
    if (cachedHmacKeyPromise === keyPromise) {
      cachedHmacSecret = null;
      cachedHmacKeyPromise = null;
    }
    throw error;
  }
}
`;
  next = replaceBlock(
    next,
    "async function hmacKey(secret) {\n",
    "\nasync function hmac(secret, purpose, value) {\n",
    hmacKey,
    "the HMAC key importer",
  );
  next = replaceRequired(
    next,
    `async function verifyToken(token, secret, purpose) {
  const text = String(token || "");
  if (!text || text.length > 4_096) return null;`,
    `async function verifyToken(
  token,
  secret,
  purpose,
  maxLength = 4_096,
) {
  const text = String(token || "");
  if (!text || text.length > maxLength) return null;`,
    "the configurable token-size guard",
  );

  const accountContextTokens = `export async function createAccountContextToken(
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

export async function readAccountContextToken(
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
  next = insertBefore(
    next,
    "export async function beginGoogleSignIn(request, env) {\n",
    accountContextTokens,
    "export async function createAccountContextToken(",
    "the Google sign-in entrypoint",
  );
  return next;
});

await update("src/billing-account.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    "  const freeLimit = Number(options?.freeLimit);\n",
    "  const freeLimit = Number(options?.freeLimit);\n  const includeMemoryGeneration = options?.includeMemoryGeneration === true;\n",
    "the optional memory-generation flag",
  );
  next = replaceRequired(
    next,
    `    paidLimit,
    freeLimit,
  };`,
    `    paidLimit,
    freeLimit,
    includeMemoryGeneration,
  };`,
    "the normalized memory-generation flag",
  );

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
    "CREATE TABLE IF NOT EXISTS account_context_state",
    "the model-usage migration",
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
    "  memoryGeneration() {",
    "the model-usage reader",
  );

  const prepareChat = `  async prepareChat(options) {
    const config = normalizePrepareOptions(options);

    return this.ctx.storage.transactionSync(() => {
      const billing = this.ctx.storage.sql
        .exec(
          \`SELECT subscription_status, selected_model
           FROM billing_state
           WHERE id = 1\`,
        )
        .toArray()[0];
      const status = String(billing?.subscription_status || "none");
      const paid = ACTIVE_STATUSES.has(status);
      const storedModel = cleanModelId(billing?.selected_model);
      const contextFields = config.includeMemoryGeneration
        ? { memoryGeneration: this.memoryGeneration() }
        : {};

      if (paid) {
        const model = config.allowedModels.has(storedModel)
          ? storedModel
          : config.defaultModel;
        if (model === config.defaultModel) {
          return {
            allowed: true,
            reason: null,
            model,
            tier: null,
            period: null,
            used: 0,
            limit: 0,
            fallback: false,
            paid: true,
            reservationMade: false,
            ...contextFields,
          };
        }

        const reservation = this.reserveUsageSync(
          "paid",
          config.paidPeriod,
          config.paidLimit,
        );
        return {
          ...reservation,
          model,
          tier: "paid",
          period: config.paidPeriod,
          fallback: false,
          paid: true,
          reservationMade: reservation.allowed,
          ...contextFields,
        };
      }

      const reservation = this.reserveUsageSync(
        "free",
        config.freePeriod,
        config.freeLimit,
      );
      if (reservation.allowed) {
        return {
          ...reservation,
          model: config.freeModel,
          tier: "free",
          period: config.freePeriod,
          fallback: false,
          paid: false,
          reservationMade: true,
          ...contextFields,
        };
      }

      return {
        allowed: true,
        reason: "fallback",
        model: config.fallbackModel,
        tier: "free",
        period: config.freePeriod,
        used: Math.max(reservation.used, config.freeLimit),
        limit: config.freeLimit,
        fallback: true,
        paid: false,
        reservationMade: false,
        ...contextFields,
      };
    });
  }

`;
  next = replaceBlock(
    next,
    "  async prepareChat(options) {\n",
    "  async refundUsage(",
    prepareChat,
    "the atomic chat preparation method",
  );
  return next;
});

await update("src/paid-worker.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `import { readAuthSession } from "./auth.js";`,
    `import {
  createAccountContextToken,
  readAccountContextToken,
  readAuthSession,
} from "./auth.js";`,
    "the account-context auth imports",
  );

  const contextHelpers = `const ACCOUNT_CONTEXT_VERSION = 1;
const ACCOUNT_CONTEXT_TOKEN_SECONDS = 15 * 60;
const ACCOUNT_CONTEXT_SUMMARY_BYTES = 1_600;
const ACCOUNT_CONTEXT_MESSAGE_BYTES = 1_600;
const ACCOUNT_CONTEXT_RECENT_MESSAGES = 4;
const ACCOUNT_CONTEXT_MERGED_MESSAGES = 8;
const accountContextEncoder = new TextEncoder();

function truncateAccountContextUtf8(value, maxBytes) {
  const text = String(value || "").trim();
  if (!text || accountContextEncoder.encode(text).byteLength <= maxBytes) {
    return text;
  }

  const points = Array.from(text);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = points.slice(0, middle).join("");
    if (accountContextEncoder.encode(candidate).byteLength <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return points.slice(0, low).join("").trim();
}

function normalizeAccountContextMessages(
  messages,
  limit = ACCOUNT_CONTEXT_MERGED_MESSAGES,
) {
  if (!Array.isArray(messages)) return [];
  const cleaned = messages
    .filter(
      (message) =>
        message && ["user", "assistant"].includes(message.role),
    )
    .map((message) => ({
      role: message.role,
      content: truncateAccountContextUtf8(
        message.content,
        ACCOUNT_CONTEXT_MESSAGE_BYTES,
      ),
    }))
    .filter((message) => message.content)
    .slice(-limit);

  const alternating = [];
  for (const message of cleaned) {
    const previous = alternating.at(-1);
    if (previous?.role === message.role) {
      previous.content = truncateAccountContextUtf8(
        previous.content + "\\n" + message.content,
        ACCOUNT_CONTEXT_MESSAGE_BYTES,
      );
    } else if (
      previous?.role !== message.role ||
      previous?.content !== message.content
    ) {
      alternating.push({ ...message });
    }
  }
  return alternating.slice(-limit);
}

function boundedAccountContext(memory) {
  const generation = Number(memory?.generation);
  return {
    v: ACCOUNT_CONTEXT_VERSION,
    summary: truncateAccountContextUtf8(
      memory?.summary,
      ACCOUNT_CONTEXT_SUMMARY_BYTES,
    ),
    recent: normalizeAccountContextMessages(
      memory?.recent,
      ACCOUNT_CONTEXT_RECENT_MESSAGES,
    ),
    awaitingSafetyAnswer: memory?.awaitingSafetyAnswer === true,
    turnCount: Math.max(0, Number(memory?.turnCount) || 0),
    updatedAt: Number(memory?.updatedAt) || null,
    generation:
      Number.isSafeInteger(generation) && generation >= 0 ? generation : 0,
  };
}

function localAccountContextMessages(body) {
  const messages = normalizeAccountContextMessages(body?.messages);
  const latest = messages.at(-1);
  const current = String(body?.message || "").trim();
  if (latest?.role === "user" && latest.content === current) messages.pop();
  return messages;
}

function preparedMemoryFromAccountContext(context, body) {
  const generation = Number(context?.generation);
  if (
    context?.v !== ACCOUNT_CONTEXT_VERSION ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  ) {
    return null;
  }

  return {
    summary: truncateAccountContextUtf8(
      context.summary,
      ACCOUNT_CONTEXT_SUMMARY_BYTES,
    ),
    recent: normalizeAccountContextMessages(
      [
        ...(Array.isArray(context.recent) ? context.recent : []),
        ...localAccountContextMessages(body),
      ],
      ACCOUNT_CONTEXT_MERGED_MESSAGES,
    ),
    awaitingSafetyAnswer: context.awaitingSafetyAnswer === true,
    turnCount: Math.max(0, Number(context.turnCount) || 0),
    updatedAt: Number(context.updatedAt) || null,
    generation,
  };
}

`;
  next = insertBefore(
    next,
    "function escapeHtml(value) {\n",
    contextHelpers,
    "const ACCOUNT_CONTEXT_VERSION = 1;",
    "the HTML escaping helper",
  );

  next = replaceRequired(
    next,
    `    freeLimit: freeDailyModelMessageLimit(env),
  };`,
    `    freeLimit: freeDailyModelMessageLimit(env),
    includeMemoryGeneration: true,
  };`,
    "the chat preparation options",
  );

  const accountHandlers = `async function syncBillingMemoryGeneration(stub, value) {
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

async function accountContextResponse(request, env) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!sameOriginOrNonBrowser(request)) {
    return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  }
  const authSession = await readAuthSession(request, env);
  if (!authSession) {
    return jsonResponse({ error: "Sign in to use account memory." }, 401);
  }

  const accountStub = billingStub(env, authSession.accountKey);
  const memory = await readMemoryContext(
    accountMemoryStub(env, authSession.accountKey),
  );
  await syncBillingMemoryGeneration(accountStub, memory.generation);
  const token = await createAccountContextToken(
    authSession.accountKey,
    boundedAccountContext(memory),
    env,
  );
  return jsonResponse(
    {
      token,
      expiresInSeconds: ACCOUNT_CONTEXT_TOKEN_SECONDS,
      generation: Math.max(0, Number(memory.generation) || 0),
      turnCount: Math.max(0, Number(memory.turnCount) || 0),
    },
    200,
    { "X-Stabilize-Memory-Source": "durable-object" },
  );
}

async function memoryControlResponse(request, env, ctx) {
  const authSessionPromise = readAuthSession(request, env);
  const response = await originalWorker.fetch(request, env, ctx);
  if (!response.ok) return response;

  const authSession = await authSessionPromise;
  if (!authSession) return response;
  let generation = null;
  try {
    const result = await response.clone().json();
    const supplied = Number(result?.generation);
    if (Number.isSafeInteger(supplied) && supplied >= 0) {
      generation = supplied;
    }
  } catch {
    // The original control response remains authoritative.
  }
  if (generation === null) {
    const memory = await readMemoryContext(
      accountMemoryStub(env, authSession.accountKey),
    );
    generation = Math.max(0, Number(memory.generation) || 0);
  }
  await syncBillingMemoryGeneration(
    billingStub(env, authSession.accountKey),
    generation,
  );
  return response;
}

`;
  next = insertBefore(
    next,
    "async function checkoutResponse(request, env) {\n",
    accountHandlers,
    "async function accountContextResponse(request, env) {",
    "the checkout handler",
  );

  const preparation = `  const memoryStub = body?.privateChat === true
    ? null
    : accountMemoryStub(env, authSession.accountKey);
  const contextStartedAt = Date.now();
  const contextPreparation = body?.privateChat === true
    ? Promise.resolve({ value: null, durationMs: 0 })
    : readAccountContextToken(
        String(body?.accountContextToken || ""),
        authSession.accountKey,
        env,
      )
        .then((value) => ({
          value: preparedMemoryFromAccountContext(value, body),
          durationMs: Date.now() - contextStartedAt,
        }))
        .catch(() => ({
          value: null,
          durationMs: Date.now() - contextStartedAt,
        }));
  const billingStartedAt = Date.now();
  const billingPreparation = stub
    .prepareChat(chatPreparationOptions(env, body))
    .then((value) => ({
      value,
      durationMs: Date.now() - billingStartedAt,
    }));
  const memoryStartedAt = Date.now();
  const memoryPreparation = body?.privateChat === true
    ? Promise.resolve({
        value: emptyMemoryContext(),
        durationMs: 0,
        source: "private",
      })
    : Promise.all([contextPreparation, billingPreparation]).then(
        async ([prefetched, preparedBilling]) => {
          const suppliedGeneration = Number(
            preparedBilling.value?.memoryGeneration,
          );
          const currentGeneration =
            Number.isSafeInteger(suppliedGeneration) && suppliedGeneration >= 0
              ? suppliedGeneration
              : 0;
          if (
            prefetched.value &&
            prefetched.value.generation === currentGeneration
          ) {
            return {
              value: prefetched.value,
              durationMs: prefetched.durationMs,
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
    preparation,
    "the signed-in chat preparation block",
  );
  next = replaceRequired(
    next,
    `  const preparation = billingResult.value;
  const memory = memoryResult.value;
  const preparationMs = Date.now() - requestStartedAt;`,
    `  const preparation = billingResult.value;
  const memory = memoryResult.value;
  const memorySource = memoryResult.source || "durable-object";
  const preparationMs = Date.now() - requestStartedAt;`,
    "the prepared memory source",
  );
  next = replaceRequired(
    next,
    `      memoryMs: memoryResult.durationMs,
      preparationMs,`,
    `      memoryMs: memoryResult.durationMs,
      memorySource,
      preparationMs,`,
    "the preparation log memory source",
  );
  next = replaceRequired(
    next,
    `    memoryMs: memoryResult.durationMs,
    preparationMs,
    model: preparation.model,`,
    `    memoryMs: memoryResult.durationMs,
    memorySource,
    preparationMs,
    model: preparation.model,`,
    "the timing response memory source",
  );
  next = replaceRequired(
    next,
    `  { authMs, billingMs, memoryMs, preparationMs, model },
) {`,
    `  {
    authMs,
    billingMs,
    memoryMs,
    memorySource,
    preparationMs,
    model,
  },
) {`,
    "the timing helper parameters",
  );
  next = replaceRequired(
    next,
    `  headers.set("X-Stabilize-Model-Selected", String(model || ""));`,
    `  headers.set("X-Stabilize-Model-Selected", String(model || ""));
  headers.set(
    "X-Stabilize-Memory-Source",
    String(memorySource || "durable-object"),
  );`,
    "the memory-source response header",
  );
  next = replaceRequired(
    next,
    `      if (url.pathname === "/api/chat") {
        return await paidChatResponse(request, env, ctx);
      }`,
    `      if (
        url.pathname === "/api/account/memory" ||
        url.pathname === "/api/conversation/new"
      ) {
        return await memoryControlResponse(request, env, ctx);
      }
      if (url.pathname === "/api/account/context") {
        return await accountContextResponse(request, env);
      }
      if (url.pathname === "/api/chat") {
        return await paidChatResponse(request, env, ctx);
      }`,
    "the signed-in account routes",
  );
  next = next.replace(
    `  let state = await readBillingState(stub);
  if (authSession) {
    const memoryWarmup = readMemoryContext(
      accountMemoryStub(env, authSession.accountKey),
    );
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(memoryWarmup);
    else void memoryWarmup;
  }
`,
    `  let state = await readBillingState(stub);
`,
  );
  next = next.replaceAll(
    "billing-client.js?v=20260808-gpt56-fast-first-1",
    "billing-client.js?v=20260808-signed-in-prefetch-1",
  );
  return next;
});

await update("public/billing-client.js", (source) => {
  const client = `/* Signed-in account-context prefetch */
const accountContextSignedIn =
  document.documentElement.dataset.signedIn === "true";
const ACCOUNT_CONTEXT_TOKEN_PATTERN =
  /^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/;
const ACCOUNT_CONTEXT_MAX_TOKEN_CHARS = 16_384;
const ACCOUNT_CONTEXT_MAX_MESSAGES = 8;
const ACCOUNT_CONTEXT_MAX_MESSAGE_CHARS = 1_600;
const accountContextFetch = globalThis.fetch.bind(globalThis);
let accountContextToken = "";
let accountContextExpiresAt = 0;
let accountContextGeneration = 0;
let accountContextTurnCount = 0;
let accountContextPendingTurns = 0;
let accountContextMinimumTurnCount = 0;
let accountContextDeltas = [];
let accountContextRefreshPromise = null;

function resetAccountContextClient() {
  accountContextToken = "";
  accountContextExpiresAt = 0;
  accountContextGeneration = 0;
  accountContextTurnCount = 0;
  accountContextPendingTurns = 0;
  accountContextMinimumTurnCount = 0;
  accountContextDeltas = [];
}

function normalizeAccountContextDeltas(messages) {
  if (!Array.isArray(messages)) return [];
  const cleaned = messages
    .filter(
      (message) =>
        message && ["user", "assistant"].includes(message.role),
    )
    .map((message) => ({
      role: message.role,
      content: String(message.content || "")
        .trim()
        .slice(0, ACCOUNT_CONTEXT_MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.content)
    .slice(-ACCOUNT_CONTEXT_MAX_MESSAGES);

  const alternating = [];
  for (const message of cleaned) {
    const previous = alternating.at(-1);
    if (previous?.role === message.role) {
      previous.content = (previous.content + "\\n" + message.content).slice(
        0,
        ACCOUNT_CONTEXT_MAX_MESSAGE_CHARS,
      );
    } else {
      alternating.push({ ...message });
    }
  }
  return alternating.slice(-ACCOUNT_CONTEXT_MAX_MESSAGES);
}

function appendAccountContextDelta(role, content) {
  accountContextDeltas = normalizeAccountContextDeltas([
    ...accountContextDeltas,
    { role, content },
  ]);
}

function currentAccountContextToken() {
  if (
    !accountContextSignedIn ||
    !accountContextToken ||
    Date.now() + 5_000 >= accountContextExpiresAt
  ) {
    return "";
  }
  return accountContextToken;
}

async function refreshAccountContext(minimumTurnCount = 0) {
  if (!accountContextSignedIn) return null;
  const minimum = Number(minimumTurnCount);
  if (Number.isSafeInteger(minimum) && minimum >= 0) {
    accountContextMinimumTurnCount = Math.max(
      accountContextMinimumTurnCount,
      minimum,
    );
  }
  if (accountContextRefreshPromise) return accountContextRefreshPromise;

  accountContextRefreshPromise = (async () => {
    try {
      const response = await accountContextFetch("/api/account/context", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!response.ok) return null;
      const result = await response.json().catch(() => ({}));
      const token = String(result?.token || "");
      const expiresInSeconds = Number(result?.expiresInSeconds);
      const generation = Number(result?.generation);
      const turnCount = Number(result?.turnCount);
      if (
        token.length < 80 ||
        token.length > ACCOUNT_CONTEXT_MAX_TOKEN_CHARS ||
        !ACCOUNT_CONTEXT_TOKEN_PATTERN.test(token) ||
        !Number.isFinite(expiresInSeconds) ||
        expiresInSeconds < 60 ||
        expiresInSeconds > 3_600 ||
        !Number.isSafeInteger(generation) ||
        generation < 0 ||
        !Number.isSafeInteger(turnCount) ||
        turnCount < 0
      ) {
        return null;
      }

      const generationChanged =
        Boolean(accountContextToken) &&
        generation !== accountContextGeneration;
      if (generationChanged) {
        accountContextDeltas = [];
        accountContextPendingTurns = 0;
        accountContextMinimumTurnCount = 0;
      }
      accountContextToken = token;
      accountContextExpiresAt = Date.now() + expiresInSeconds * 1_000;
      accountContextGeneration = generation;
      accountContextTurnCount = turnCount;
      if (
        turnCount >= accountContextMinimumTurnCount &&
        !generationChanged
      ) {
        accountContextDeltas = [];
        accountContextPendingTurns = 0;
        accountContextMinimumTurnCount = turnCount;
      }
      return result;
    } catch {
      return null;
    } finally {
      accountContextRefreshPromise = null;
    }
  })();
  return accountContextRefreshPromise;
}

function absoluteRequestUrl(input) {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return new URL(String(input || ""), window.location.href).href;
}

async function requestBodyObject(input, init) {
  try {
    if (input instanceof Request) return await input.clone().json();
    if (typeof init?.body === "string") return JSON.parse(init.body);
    const request = new Request(absoluteRequestUrl(input), init);
    return await request.clone().json();
  } catch {
    return null;
  }
}

async function requestWithAccountContext(input, init) {
  const request = input instanceof Request
    ? input.clone()
    : new Request(absoluteRequestUrl(input), init);
  const body = await request.clone().json().catch(() => null);
  if (!body || body.privateChat === true) {
    return { request, message: "", privateChat: body?.privateChat === true };
  }

  const token = currentAccountContextToken();
  if (token) {
    body.accountContextToken = token;
    const existing = Array.isArray(body.messages) ? body.messages : [];
    body.messages = normalizeAccountContextDeltas([
      ...existing,
      ...accountContextDeltas,
    ]);
  } else {
    delete body.accountContextToken;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return {
    request: new Request(request, {
      headers,
      body: JSON.stringify(body),
    }),
    message: String(body.message || "").trim(),
    privateChat: false,
  };
}

async function replyFromAccountContextResponse(response) {
  if (!response.ok) return "";
  const contentType = String(response.headers.get("content-type") || "")
    .toLowerCase();
  if (contentType.includes("application/json")) {
    const result = await response.json().catch(() => ({}));
    return String(result?.reply || "").trim();
  }
  if (!contentType.includes("application/x-ndjson")) return "";

  const text = await response.text().catch(() => "");
  let reply = "";
  for (const line of text.split(/\\r?\\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "done" && typeof event.reply === "string") {
        reply = event.reply.trim();
      }
    } catch {
      // A malformed observer line does not affect the visible response.
    }
  }
  return reply;
}

async function observeAccountContextResponse(response, message) {
  const reply = await replyFromAccountContextResponse(response);
  if (!message || !reply) return;
  appendAccountContextDelta("user", message);
  appendAccountContextDelta("assistant", reply);
  accountContextPendingTurns += 1;
  const minimumTurnCount =
    accountContextTurnCount + accountContextPendingTurns;
  await refreshAccountContext(minimumTurnCount);
}

const accountContextWrappedFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const path = chatRequestPath(input);
  if (accountContextSignedIn && path === "/api/chat") {
    const prepared = await requestWithAccountContext(input, init);
    const response = await accountContextWrappedFetch(prepared.request);
    if (!prepared.privateChat) {
      try {
        const observer = response.clone();
        void observeAccountContextResponse(observer, prepared.message);
      } catch {
        // The visible response remains usable if observation is unavailable.
      }
    }
    return response;
  }

  const controlBody =
    accountContextSignedIn && path === "/api/conversation/new"
      ? await requestBodyObject(input, init)
      : null;
  const response = await accountContextWrappedFetch(input, init);
  if (
    accountContextSignedIn &&
    response.ok &&
    (path === "/api/account/memory" ||
      (path === "/api/conversation/new" && controlBody?.privateChat !== true))
  ) {
    resetAccountContextClient();
    void refreshAccountContext();
  }
  return response;
};

if (accountContextSignedIn) void refreshAccountContext();
`;
  return appendOnce(
    source,
    "/* Signed-in account-context prefetch */",
    client,
  );
});

await update("README.md", (source) => {
  if (source.includes("short-lived signed account-context snapshot")) return source;
  const anchor =
    "Signed-in users can start a private chat that bypasses Stabilize account-memory reads and writes for that tab. Private chat does not disable Cloudflare or OpenAI processing and does not change the provider-retention behavior described above.\n";
  const addition =
    anchor +
    "\nTo reduce signed-in response delay, the web page prefetches a bounded, short-lived signed account-context snapshot while the user is reading or typing. The opaque snapshot is bound to the signed-in account, held only in active page memory, checked against the current memory generation returned by the existing quota lookup, and refreshed after completed replies. It is not written to localStorage or sessionStorage. Invalid, expired, cross-account, or superseded snapshots fall back to the account-memory Durable Object.\n";
  return replaceRequired(
    source,
    anchor,
    addition,
    "the README private-chat paragraph",
  );
});

await update("PRIVACY.md", (source) => {
  if (source.includes("short-lived HMAC-signed account-context snapshot")) {
    return source;
  }
  const anchor =
    "The summary is generated by a model and may be incomplete or wrong. The application tells the reply model to treat it as fallible context, never as instructions, and to prefer the current message.\n";
  const addition =
    "To avoid a blocking account-memory Durable Object read before every signed-in model request, the web page requests a bounded, short-lived HMAC-signed account-context snapshot. The opaque token is bound to the signed-in account, held only in the page's active JavaScript memory, returned with a later chat request, and refreshed after completed replies. The Worker verifies its signature, expiry, account binding, and memory generation. The generation is returned by the quota lookup already required for signed-in chat, so this revocation check adds no separate chat round trip. Invalid, expired, cross-account, or superseded tokens fall back to the Durable Object. Deleting memory or starting a new non-private conversation advances and synchronizes the generation before the control request returns. The token is not written to localStorage or sessionStorage.\n\n" +
    anchor;
  return replaceRequired(
    source,
    anchor,
    addition,
    "the memory-summary warning",
  );
});

await update("public/privacy.html", (source) => {
  if (source.includes("short-lived HMAC-signed account-context snapshot")) {
    return source;
  }
  const anchor = `        local deletion does not shorten the separate OpenAI storage period.
      </p>`;
  const addition = `        local deletion does not shorten the separate OpenAI storage period.
      </p>
      <p>
        To reduce signed-in response delay, the page requests a bounded, short-lived HMAC-signed account-context snapshot while you read or type. The opaque token is bound to the signed-in account, kept only in active page memory, checked against the current memory generation returned by the existing quota lookup, and refreshed after completed replies. It is not written to localStorage or sessionStorage. Invalid, expired, cross-account, or superseded tokens fall back to the account-memory Durable Object.
      </p>`;
  return replaceRequired(
    source,
    anchor,
    addition,
    "the public signed-in memory paragraph",
  );
});

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
  await update(path, (source) => {
    let next = source;
    if (!next.includes(nextPipeline)) {
      next = next.split(currentPipeline).join(nextPipeline);
    }
    next = next.replaceAll(
      "20260808-gpt56-fast-first-1",
      "20260808-signed-in-prefetch-1",
    );
    return next;
  });
}

console.log(
  "Applied signed-in account-context prefetch and removed the blocking memory read from warm sends.",
);

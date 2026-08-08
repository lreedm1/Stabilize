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
    throw new Error(`Account preflight policy could not find ${label}`);
  }
  return source.replace(before, after);
}

function insertBefore(source, marker, addition, uniqueMarker, label) {
  if (source.includes(uniqueMarker)) return source;
  const index = source.indexOf(marker);
  if (index < 0) {
    throw new Error(`Account preflight policy could not find ${label}`);
  }
  return source.slice(0, index) + addition + source.slice(index);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Account preflight policy could not replace ${label}`);
  }
  const current = source.slice(start, end);
  if (current === replacement) return source;
  return source.slice(0, start) + replacement + source.slice(end);
}

const currentPipeline =
  "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs && node scripts/add-guest-summary.mjs && node scripts/apply-signed-in-prefetch-latency.mjs && node scripts/finalize-signed-in-prefetch-tests.mjs";
const nextPipeline =
  currentPipeline + " && node scripts/apply-account-preflight.mjs";

await update("src/billing-account.js", (source) => {
  const previewChat = `  async previewChat(options) {
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
            remaining: null,
            fallback: false,
            paid: true,
            reservationMade: false,
            subscriptionStatus: status,
            ...contextFields,
          };
        }

        const usage = this.ctx.storage.sql
          .exec(
            \`SELECT usage_count
             FROM model_usage
             WHERE tier = 'paid' AND period = ?\`,
            config.paidPeriod,
          )
          .toArray()[0];
        const used = usage
          ? Math.max(0, Number(usage.usage_count) || 0)
          : 0;
        const allowed = used < config.paidLimit;
        return {
          allowed,
          reason: allowed ? null : "limit",
          model,
          tier: "paid",
          period: config.paidPeriod,
          used,
          limit: config.paidLimit,
          remaining: Math.max(0, config.paidLimit - used),
          fallback: false,
          paid: true,
          reservationMade: false,
          subscriptionStatus: status,
          ...contextFields,
        };
      }

      const usage = this.ctx.storage.sql
        .exec(
          \`SELECT usage_count
           FROM model_usage
           WHERE tier = 'free' AND period = ?\`,
          config.freePeriod,
        )
        .toArray()[0];
      const used = usage
        ? Math.max(0, Number(usage.usage_count) || 0)
        : 0;
      const fallback = used >= config.freeLimit;
      return {
        allowed: true,
        reason: fallback ? "fallback" : null,
        model: fallback ? config.fallbackModel : config.freeModel,
        tier: "free",
        period: config.freePeriod,
        used,
        limit: config.freeLimit,
        remaining: Math.max(0, config.freeLimit - used),
        fallback,
        paid: false,
        reservationMade: false,
        subscriptionStatus: status,
        ...contextFields,
      };
    });
  }

`;
  return insertBefore(
    source,
    "  async prepareChat(options) {\n",
    previewChat,
    "  async previewChat(options) {\n",
    "the read-only chat preflight method",
  );
});

await update("src/paid-worker.js", (source) => {
  let next = source;

  const boundedBilling = `function boundedBillingPreflight(value) {
  if (!value || typeof value !== "object") return null;
  const model = String(value.model || "").trim().slice(0, 128);
  const tier = value.tier === null ? null : String(value.tier || "").trim();
  const period = value.period === null ? null : String(value.period || "").trim();
  const used = Math.max(0, Number(value.used) || 0);
  const limit = Math.max(0, Number(value.limit) || 0);
  const suppliedRemaining = Number(value.remaining);
  const remaining = Number.isFinite(suppliedRemaining)
    ? Math.max(0, suppliedRemaining)
    : Math.max(0, limit - used);
  const subscriptionStatus = String(
    value.subscriptionStatus || "none",
  )
    .trim()
    .slice(0, 32);
  if (!model || ![null, "free", "paid"].includes(tier)) return null;
  return {
    allowed: value.allowed === true,
    reason: value.reason === null ? null : String(value.reason || "").slice(0, 32),
    model,
    tier,
    period,
    used,
    limit,
    remaining: tier === null ? null : remaining,
    fallback: value.fallback === true,
    paid: value.paid === true,
    subscriptionStatus,
    checkedAt: Date.now(),
  };
}

`;
  next = insertBefore(
    next,
    "function escapeHtml(value) {\n",
    boundedBilling,
    "function boundedBillingPreflight(value) {\n",
    "the bounded billing preflight helper",
  );

  const accountContext = `async function accountContextResponse(request, env) {
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
  const memoryPromise = readMemoryContext(
    accountMemoryStub(env, authSession.accountKey),
  );
  const billingPromise =
    accountStub && typeof accountStub.previewChat === "function"
      ? accountStub.previewChat(chatPreparationOptions(env))
      : Promise.resolve(null);
  const [memory, billingPreview] = await Promise.all([
    memoryPromise,
    billingPromise,
  ]);
  await syncBillingMemoryGeneration(accountStub, memory.generation);
  const token = await createAccountContextToken(
    authSession.accountKey,
    boundedAccountContext(memory),
    env,
  );
  const billing = boundedBillingPreflight(billingPreview);
  return jsonResponse(
    {
      token,
      expiresInSeconds: ACCOUNT_CONTEXT_TOKEN_SECONDS,
      generation: Math.max(0, Number(memory.generation) || 0),
      turnCount: Math.max(0, Number(memory.turnCount) || 0),
      billing,
    },
    200,
    {
      "X-Stabilize-Memory-Source": "durable-object",
      "X-Stabilize-Billing-Source": billing ? "prefetched" : "unavailable",
    },
  );
}
`;
  next = replaceBlock(
    next,
    "async function accountContextResponse(request, env) {\n",
    "\nasync function memoryControlResponse(request, env, ctx) {\n",
    accountContext,
    "the combined memory and billing preflight endpoint",
  );

  next = next.replaceAll(
    "billing-client.js?v=20260808-signed-in-prefetch-1",
    "billing-client.js?v=20260808-account-preflight-1",
  );
  return next;
});

await update("public/billing-client.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    "let accountContextRefreshPromise = null;\n",
    `let accountContextRefreshPromise = null;
let accountBillingPreflight = null;
let accountContextRefreshTimer = 0;
`,
    "the account preflight client state",
  );

  next = replaceRequired(
    next,
    `  accountContextDeltas = [];
}`,
    `  accountContextDeltas = [];
  accountBillingPreflight = null;
  if (accountContextRefreshTimer) {
    clearTimeout(accountContextRefreshTimer);
    accountContextRefreshTimer = 0;
  }
  delete document.documentElement.dataset.accountPreflight;
  delete document.documentElement.dataset.subscriptionActive;
}`,
    "the account preflight reset",
  );

  const clientHelpers = `function normalizeAccountBillingPreflight(value) {
  if (!value || typeof value !== "object") return null;
  const model = String(value.model || "").trim().slice(0, 128);
  const tier = value.tier === null ? null : String(value.tier || "").trim();
  const used = Math.max(0, Number(value.used) || 0);
  const limit = Math.max(0, Number(value.limit) || 0);
  const remaining = value.remaining === null
    ? null
    : Math.max(0, Number(value.remaining) || 0);
  const subscriptionStatus = String(value.subscriptionStatus || "none")
    .trim()
    .slice(0, 32);
  if (!model || ![null, "free", "paid"].includes(tier)) return null;
  return {
    allowed: value.allowed === true,
    reason: value.reason === null ? null : String(value.reason || "").slice(0, 32),
    model,
    tier,
    used,
    limit,
    remaining,
    fallback: value.fallback === true,
    paid: value.paid === true,
    subscriptionStatus,
  };
}

function accountBillingUsageCopy(preflight) {
  if (!preflight) return "";
  if (preflight.paid && preflight.tier === null) {
    return "Subscription active. GPT-5.4 does not use the subscriber message allowance.";
  }
  if (preflight.paid) {
    return (
      preflight.used +
      " of " +
      preflight.limit +
      " subscriber model messages used this UTC month. GPT-5.4 does not count."
    );
  }
  return (
    preflight.used +
    " of " +
    preflight.limit +
    " free GPT-5.6 Fast messages used today. GPT-5.4 takes over after this allowance. The allowance resets at 00:00 UTC."
  );
}

function installAccountBillingPreflight(preflight) {
  if (!preflight) return;
  accountBillingPreflight = preflight;
  document.documentElement.dataset.accountPreflight = "ready";
  document.documentElement.dataset.subscriptionActive = String(
    preflight.paid,
  );
  const copy = accountBillingUsageCopy(preflight);
  if (!copy) return;
  for (const node of document.querySelectorAll('[data-model-usage="true"]')) {
    node.textContent = copy;
  }
}

function scheduleAccountContextRefresh() {
  if (!accountContextSignedIn || !accountContextExpiresAt) return;
  if (accountContextRefreshTimer) clearTimeout(accountContextRefreshTimer);
  const refreshAt = accountContextExpiresAt - 60_000;
  const delay = Math.max(5_000, refreshAt - Date.now());
  accountContextRefreshTimer = setTimeout(() => {
    accountContextRefreshTimer = 0;
    void refreshAccountContext();
  }, delay);
}

function refreshAccountPreflightIfNeeded() {
  if (!accountContextSignedIn) return;
  if (
    !currentAccountContextToken() ||
    Date.now() + 60_000 >= accountContextExpiresAt
  ) {
    void refreshAccountContext();
  }
}

`;
  next = insertBefore(
    next,
    "function normalizeAccountContextDeltas(messages) {\n",
    clientHelpers,
    "function normalizeAccountBillingPreflight(value) {\n",
    "the client-side account preflight helpers",
  );

  next = replaceRequired(
    next,
    "      const turnCount = Number(result?.turnCount);\n",
    `      const turnCount = Number(result?.turnCount);
      const billingPreflight = normalizeAccountBillingPreflight(
        result?.billing,
      );
`,
    "the billing preflight response parser",
  );

  next = replaceRequired(
    next,
    "      accountContextTurnCount = turnCount;\n",
    `      accountContextTurnCount = turnCount;
      installAccountBillingPreflight(billingPreflight);
      scheduleAccountContextRefresh();
`,
    "the billing preflight installer",
  );

  next = replaceRequired(
    next,
    "if (accountContextSignedIn) void refreshAccountContext();\n",
    `if (accountContextSignedIn) {
  void refreshAccountContext();
  window.addEventListener("focus", refreshAccountPreflightIfNeeded);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAccountPreflightIfNeeded();
  });
  const messageInput = document.querySelector("#message-input");
  if (messageInput instanceof HTMLTextAreaElement) {
    messageInput.addEventListener("focus", refreshAccountPreflightIfNeeded);
    messageInput.addEventListener("input", refreshAccountPreflightIfNeeded);
  }
}
`,
    "the initial and resumed account preflight",
  );

  return next;
});

await update("package.json", (source) => {
  let next = source.replaceAll(currentPipeline, nextPipeline);
  next = next.replace(
    "test/signed-in-prefetch-latency.test.mjs\"",
    "test/signed-in-prefetch-latency.test.mjs test/account-preflight.test.mjs\"",
  );
  next = next.replace(
    "test/signed-in-prefetch-latency-worker.test.mjs\"",
    "test/signed-in-prefetch-latency-worker.test.mjs test/account-preflight-worker.test.mjs\"",
  );
  return next;
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
  await update(path, (source) =>
    source
      .split(currentPipeline)
      .join(nextPipeline)
      .replaceAll(
        "billing-client\\.js\\?v=20260808-signed-in-prefetch-1",
        "billing-client\\.js\\?v=20260808-account-preflight-1",
      )
      .replaceAll(
        "billing-client.js?v=20260808-signed-in-prefetch-1",
        "billing-client.js?v=20260808-account-preflight-1",
      ),
  );
}

console.log(
  "Applied early signed-in memory, subscription, and quota preflight without weakening atomic allowance reservations.",
);

import { readFile, writeFile } from "node:fs/promises";

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Signed-in latency policy could not find ${label}`);
  }
  return source.replace(before, after);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Signed-in latency policy could not replace ${label}`);
  }
  const current = source.slice(start, end);
  if (current === replacement) return source;
  return source.slice(0, start) + replacement + source.slice(end);
}

function replaceRegexRequired(source, pattern, replacement, label) {
  if (typeof replacement === "string" && source.includes(replacement)) {
    return source;
  }
  pattern.lastIndex = 0;
  if (!pattern.test(source)) {
    throw new Error(`Signed-in latency policy could not find ${label}`);
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/billing-account.js", (source) => {
  const marker = "// Signed-in instant chats use the unmetered default model.";
  if (source.includes(marker)) return source;

  const anchor = `      const reservation = this.reserveUsageSync(
        "free",
        config.freePeriod,
        config.freeLimit,
      );`;
  const replacement = `      ${marker}
      if (config.freeModel === config.defaultModel) {
        return {
          allowed: true,
          reason: null,
          model: config.defaultModel,
          tier: null,
          period: null,
          used: 0,
          limit: 0,
          fallback: false,
          paid: false,
          reservationMade: false,
        };
      }

${anchor}`;
  return replaceRequired(
    source,
    anchor,
    replacement,
    "the free usage reservation",
  );
});

await update("src/paid-worker.js", (source) => {
  let next = source;

  const chatPreparation = `function chatPreparationOptions(env, body = {}) {
  const choices = modelChoices(env);
  const defaultModel = String(env.OPENAI_MODEL || "gpt-5.4");
  const fallbackModel = String(
    env.FREE_PLAN_FALLBACK_MODEL || defaultModel || "gpt-5.4",
  );
  const requestedEffort = String(body?.reasoningEffort || "none")
    .trim()
    .toLowerCase();
  const usesThinking = ["low", "medium", "high", "xhigh", "max"].includes(
    requestedEffort,
  );
  const freeModel = usesThinking
    ? String(env.FREE_PLAN_PRIMARY_MODEL || "gpt-5.6-sol")
    : defaultModel;
  const allowedModels = [...new Set([
    ...choices.map((choice) => choice.id),
    defaultModel,
    freeModel,
    fallbackModel,
  ])];
  return {
    allowedModels,
    defaultModel,
    freeModel,
    fallbackModel,
    paidPeriod: usagePeriod(),
    freePeriod: dailyUsagePeriod(),
    paidLimit: monthlyModelMessageLimit(env),
    freeLimit: freeDailyModelMessageLimit(env),
  };
}

`;
  next = replaceBlock(
    next,
    "function chatPreparationOptions(",
    "function billingNotice(",
    chatPreparation,
    "chat preparation options",
  );

  next = next
    .replace(
      "Checkout was cancelled. Your free GPT-5.6 allowance is unchanged.",
      "Checkout was cancelled. Your free Current thinking allowance is unchanged.",
    )
    .replace(
      "Free accounts use GPT-5.6 Instant automatically, then GPT-5.4 after the daily allowance.",
      "Fastest response uses GPT-5.4. Thinking levels use Current until the daily allowance is reached.",
    );

  const modelChoiceState = `function modelChoiceState(state, choices, defaultModel) {
  const choiceEnvironment = {
    MODEL_CHOICES: choices
      .map((choice) => choice.id + "|" + choice.label)
      .join(","),
    OPENAI_MODEL: defaultModel,
  };
  const paid = state.entitled === true;
  const selected = paid
    ? isAllowedModel(choiceEnvironment, state.selectedModel)
      ? state.selectedModel
      : defaultModel
    : defaultModel;
  const selectedChoice = choices.find((choice) => choice.id === selected);
  const currentLabel = selectedChoice?.label || "GPT-5.4";
  const currentPeriod = paid ? usagePeriod() : dailyUsagePeriod();
  const storedPeriod = paid
    ? state.paidUsagePeriod || state.usagePeriod
    : state.freeUsagePeriod;
  const storedCount = paid
    ? state.paidUsageCount ?? state.usageCount
    : state.freeUsageCount;
  const used =
    storedPeriod === currentPeriod
      ? Math.max(0, Number(storedCount) || 0)
      : 0;
  return { selected, currentLabel, paid, used };
}

`;
  next = replaceBlock(
    next,
    "function modelChoiceState(",
    "function modelOptionsMarkup(",
    modelChoiceState,
    "free model display state",
  );

  const usageCopy = `function modelUsageCopy({ paid, used, freeLimit, paidLimit }) {
  return paid
    ? used +
        " of " +
        paidLimit +
        " subscriber model messages used this UTC month. GPT-5.4 does not count."
    : used +
        " of " +
        freeLimit +
        " free Current thinking messages used today. Fastest response uses GPT-5.4 and does not count. The allowance resets at 00:00 UTC.";
}

`;
  next = replaceBlock(
    next,
    "function modelUsageCopy(",
    "function billingMenuMarkup(",
    usageCopy,
    "free model usage copy",
  );

  next = next.replaceAll(
    " GPT-5.6 Instant messages each day, then GPT-5.4 automatically.</p>",
    " Current thinking messages each day. Fastest response stays on GPT-5.4.</p>",
  );
  next = next.replace(
    `      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +`,
    `      "<p>Fastest response uses GPT-5.4. Choose a thinking level to use Current for up to " +
      freeLimit +
      " messages each UTC day.</p>" +`,
  );
  next = next.replace(
    `      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +`,
    `      "<p>Fastest response uses GPT-5.4. Choose a thinking level to use Current for up to " +
      freeLimit +
      " messages each UTC day.</p>" +`,
  );

  const rootAnchor = `  const stub = billingStub(env, authSession?.accountKey);
  let state = await readBillingState(stub);
`;
  const rootReplacement = `${rootAnchor}  if (authSession) {
    const memoryWarmup = readMemoryContext(
      accountMemoryStub(env, authSession.accountKey),
    );
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(memoryWarmup);
    else void memoryWarmup;
  }
`;
  next = replaceRequired(
    next,
    rootAnchor,
    rootReplacement,
    "the signed-in page memory warmup",
  );

  const handlerStart = `async function paidChatResponse(request, env, ctx) {
  if (request.method !== "POST") return originalWorker.fetch(request, env, ctx);
  const authSession = await readAuthSession(request, env);`;
  const timedHandlerStart = `async function paidChatResponse(request, env, ctx) {
  if (request.method !== "POST") return originalWorker.fetch(request, env, ctx);
  const requestStartedAt = Date.now();
  const authStartedAt = Date.now();
  const authSession = await readAuthSession(request, env);
  const authMs = Date.now() - authStartedAt;`;
  next = replaceRequired(
    next,
    handlerStart,
    timedHandlerStart,
    "signed-in authentication timing",
  );

  const preparationAnchor = `  const memoryStub = body?.privateChat === true
    ? null
    : accountMemoryStub(env, authSession.accountKey);
  const [preparation, memory] = await Promise.all([
    stub.prepareChat(chatPreparationOptions(env)),
    readMemoryContext(memoryStub),
  ]);
`;
  const timedPreparation = `  const memoryStub = body?.privateChat === true
    ? null
    : accountMemoryStub(env, authSession.accountKey);
  const billingStartedAt = Date.now();
  const billingPreparation = stub
    .prepareChat(chatPreparationOptions(env, body))
    .then((value) => ({
      value,
      durationMs: Date.now() - billingStartedAt,
    }));
  const memoryStartedAt = Date.now();
  const memoryPreparation = readMemoryContext(memoryStub).then((value) => ({
    value,
    durationMs: Date.now() - memoryStartedAt,
  }));
  const [billingResult, memoryResult] = await Promise.all([
    billingPreparation,
    memoryPreparation,
  ]);
  const preparation = billingResult.value;
  const memory = memoryResult.value;
  const preparationMs = Date.now() - requestStartedAt;
  console.info(
    JSON.stringify({
      event: "signed_in_chat_prepared",
      authMs,
      billingMs: billingResult.durationMs,
      memoryMs: memoryResult.durationMs,
      preparationMs,
      model: String(preparation?.model || "").slice(0, 128),
      paid: preparation?.paid === true,
      fallback: preparation?.fallback === true,
      privateChat: body?.privateChat === true,
    }),
  );
`;
  next = replaceRequired(
    next,
    preparationAnchor,
    timedPreparation,
    "parallel signed-in preparation timing",
  );

  next = replaceRequired(
    next,
    `  if (preparation.paid !== true) body.reasoningEffort = "none";
  const selectedEnv = modelEnvironment(env, preparation.model);
  const response = await preparedChatResponse(`,
    `  const defaultModel = String(env.OPENAI_MODEL || "gpt-5.4");
  if (preparation.paid !== true && preparation.model === defaultModel) {
    body.reasoningEffort = "none";
  }
  const selectedEnv = modelEnvironment(env, preparation.model);
  let response = await preparedChatResponse(`,
    "free reasoning preservation",
  );

  next = replaceRequired(
    next,
    `    body?.privateChat === true ? emptyMemoryContext() : memory,
  );

  if (
    preparation.reservationMade &&`,
    `    body?.privateChat === true ? emptyMemoryContext() : memory,
  );
  response = responseWithPreparationTiming(response, {
    authMs,
    billingMs: billingResult.durationMs,
    memoryMs: memoryResult.durationMs,
    preparationMs,
    model: preparation.model,
  });

  if (
    preparation.reservationMade &&`,
    "preparation timing response headers",
  );

  const timingHelper = `function responseWithPreparationTiming(
  response,
  { authMs, billingMs, memoryMs, preparationMs, model },
) {
  const headers = new Headers(response.headers);
  const timing = [
    "stabilize-auth;dur=" + Math.max(0, Number(authMs) || 0),
    "stabilize-billing;dur=" + Math.max(0, Number(billingMs) || 0),
    "stabilize-memory;dur=" + Math.max(0, Number(memoryMs) || 0),
    "stabilize-preparation;dur=" + Math.max(0, Number(preparationMs) || 0),
  ].join(", ");
  const existing = String(headers.get("Server-Timing") || "").trim();
  headers.set("Server-Timing", existing ? existing + ", " + timing : timing);
  headers.set(
    "X-Stabilize-Preparation-Ms",
    String(Math.max(0, Number(preparationMs) || 0)),
  );
  headers.set("X-Stabilize-Model-Selected", String(model || ""));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

`;
  if (!next.includes("function responseWithPreparationTiming(")) {
    next = replaceRequired(
      next,
      "function responseWithModelUsage(",
      timingHelper + "function responseWithModelUsage(",
      "preparation timing helper",
    );
  }

  return next;
});

await update("public/billing-client.js", (source) => {
  let next = source;
  next = next.replace(
    `        " free GPT-5.6 Instant messages used today. Stabilize switches to GPT-5.4 after this allowance. The allowance resets at 00:00 UTC.";`,
    `        " free Current thinking messages used today. Fastest response uses GPT-5.4 and does not count. The allowance resets at 00:00 UTC.";`,
  );
  next = next.replace(
    `    " GPT-5.6 Instant messages. Stabilize switched to GPT-5.4 automatically; your message was still sent.";`,
    `    " Current thinking messages. Stabilize used GPT-5.4 for this message; it was still sent.";`,
  );

  const displayHelper = `function updateSelectedModelDisplay(model) {
  const value = String(model || "");
  if (!value) return;
  const label = value === "gpt-5.6-sol"
    ? "5.6"
    : value === "gpt-5.4"
      ? "5.4"
      : compactModelTileLabel(value);
  for (const current of document.querySelectorAll(".composer-model-current")) {
    if (current instanceof HTMLElement) current.textContent = label;
  }
}

`;
  if (!next.includes("function updateSelectedModelDisplay(model)")) {
    next = replaceRequired(
      next,
      "function updateModelUsageDisplay(usage) {",
      displayHelper + "function updateModelUsageDisplay(usage) {",
      "selected model display helper",
    );
  }

  next = replaceRequired(
    next,
    `  if (chatRequestPath(args[0]) === "/api/chat") {
    const usage = modelUsageFromResponse(response);
    if (usage) updateModelUsageDisplay(usage);
  }`,
    `  if (chatRequestPath(args[0]) === "/api/chat") {
    updateSelectedModelDisplay(
      response.headers.get("X-Stabilize-Model-Selected"),
    );
    const usage = modelUsageFromResponse(response);
    if (usage) updateModelUsageDisplay(usage);
  }`,
    "model display update after chat",
  );
  return next;
});

await update("README.md", (source) => {
  let next = source;
  next = next.replace(
    "- automatic signed-in free access to GPT-5.6 Instant for the first 50 completed ordinary messages each UTC day, followed by GPT-5.4",
    "- signed-in fast replies on GPT-5.4 plus 50 free Current thinking messages per UTC day",
  );
  next = next.replace(
    "- **Signed-in free account:** the first **50** completed ordinary messages in each UTC day use `gpt-5.6-sol` with the no-extra-reasoning **Instant** setting. After that allowance is used, chats continue on GPT-5.4. The allowance resets at `00:00 UTC`.",
    "- **Signed-in free account:** **Fastest response** uses GPT-5.4, matching guest speed while retaining account memory. Choosing a thinking level uses **Current** (`gpt-5.6-sol`) for up to **50** completed messages per UTC day; after that allowance, the request continues on GPT-5.4. The allowance resets at `00:00 UTC`.",
  );
  next = next.replace(
    "The public labels intentionally use **GPT-5.6 Instant**, **GPT-5.4**, and **Current**.",
    "The public labels intentionally use **GPT-5.4**, **Current**, and thinking-level names.",
  );
  next = next.replace(
    "`OPENAI_MODEL` is the guest and fallback model. The two `FREE_PLAN_*` values define the automatic signed-in free ladder.",
    "`OPENAI_MODEL` is the guest, signed-in fastest-response, and fallback model. The two `FREE_PLAN_*` values define the signed-in Current thinking allowance and fallback.",
  );
  next = next.replace(
    "The current repository still contains an ordered compatibility/materialization pipeline under `scripts/`. Run the standard npm commands rather than invoking later scripts in isolation; the idempotency suite checks that the complete ordered policy pass is repeatable.",
    "The current repository materializes the production policy through the standard npm commands. Run those commands rather than invoking individual scripts in isolation; the clean-tree guard verifies that generation is repeatable.",
  );
  return next;
});

await update("docs/STRIPE_MODEL_CHOICE_SETUP.md", (source) => {
  let next = source;
  next = next.replace(
    "Stabilize uses an automatic model ladder for signed-in free accounts and an optional Stripe subscription for a larger monthly non-default-model allowance.",
    "Stabilize keeps signed-in fastest responses on GPT-5.4 and provides a free daily Current thinking allowance, plus an optional Stripe subscription for a larger monthly non-default-model allowance.",
  );
  next = next.replace(
    "- signed-in free accounts receive 50 free GPT-5.6 Instant messages per UTC day, then continue on GPT-5.4",
    "- signed-in free accounts use GPT-5.4 for Fastest response and receive 50 free Current thinking messages per UTC day",
  );
  next = next.replace(
    "The automatic free ladder remains available even when Stripe is not configured.",
    "The free Current thinking allowance remains available even when Stripe is not configured.",
  );
  next = replaceRegexRequired(
    next,
    /### Signed-in free account\n\n[\s\S]*?\n\n### Subscriber/,
    `### Signed-in free account

Fastest response uses GPT-5.4 so signing in does not switch the user onto a slower default path. Choosing any supported thinking level uses Current (\`gpt-5.6-sol\`) and consumes one of 50 free Current thinking messages per UTC day. When that allowance is exhausted, the request continues on GPT-5.4 with instant reasoning. The daily counter resets at \`00:00 UTC\`.

The free-account model tile shows GPT-5.4 by default. The separate thinking-level control opts into Current; a saved historical model preference does not override the free route.

### Subscriber`,
    "the signed-in free account guide",
  );
  next = next.replace(
    "Expected signed-in free flow:\n\n1. Sign in with Google.\n2. Open the model control and confirm it explains the automatic GPT-5.6 Instant → GPT-5.4 ladder.\n3. Send an ordinary message and confirm the selected model is GPT-5.6 Instant and the daily count increases.\n4. Reload the page and confirm the count remains.\n5. In a test environment with a reduced free limit, exhaust the allowance and confirm the next ordinary response succeeds on GPT-5.4 with the fallback notice.\n6. Confirm the daily period resets at `00:00 UTC`.",
    "Expected signed-in free flow:\n\n1. Sign in with Google.\n2. Send a Fastest response message and confirm GPT-5.4 is selected without increasing the Current allowance.\n3. Choose a thinking level, send a message, and confirm Current is selected and the daily count increases.\n4. Reload the page and confirm the count remains.\n5. In a test environment with a reduced free limit, exhaust the allowance and confirm the next thinking request succeeds on GPT-5.4 with the fallback notice.\n6. Confirm the daily period resets at `00:00 UTC`.",
  );
  next = next.replace(
    "the account returns to the automatic free ladder",
    "the account returns to the free GPT-5.4 plus Current-thinking policy",
  );
  return next;
});

for (const path of ["public/about.html", "public/sustainability.html"]) {
  await update(path, (source) =>
    source
      .replaceAll(
        "50 automatic GPT-5.6 Instant messages per UTC day for signed-in free accounts before GPT-5.4 takes over",
        "GPT-5.4 fastest responses plus 50 free Current thinking messages per UTC day for signed-in accounts",
      )
      .replaceAll(
        "Signed-in free accounts automatically receive 50 GPT-5.6 Instant\n        messages per UTC day and then continue on GPT-5.4.",
        "Signed-in free accounts use GPT-5.4 for Fastest response and receive 50 Current thinking\n        messages per UTC day.",
      )
      .replaceAll(
        "free GPT-5.6 Instant → GPT-5.4 ladder intact",
        "free GPT-5.4 fastest-response and Current-thinking policy intact",
      )
      .replaceAll(
        "50 GPT-5.6 Instant messages per UTC day",
        "50 Current thinking messages per UTC day",
      ),
  );
}

await update("test/model-limit-fallback.test.mjs", () => `import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(\`../\${path}\`, import.meta.url), "utf8");

test("signed-in fastest response matches the guest model while thinking uses the free Current allowance", async () => {
  const [configText, workerSource, billingSource, clientSource, packageSource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/paid-worker.js"),
      read("src/billing-account.js"),
      read("public/billing-client.js"),
      read("package.json"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "50");
  assert.equal(config.vars.FREE_PLAN_PRIMARY_MODEL, "gpt-5.6-sol");
  assert.equal(config.vars.FREE_PLAN_FALLBACK_MODEL, "gpt-5.4");

  assert.match(workerSource, /function chatPreparationOptions\\(env, body = \\{\\}\\)/);
  assert.match(workerSource, /const usesThinking = \\["low", "medium", "high", "xhigh", "max"\\]/);
  assert.match(workerSource, /stub\\s*\\.prepareChat\\(chatPreparationOptions\\(env, body\\)\\)/);
  assert.match(workerSource, /preparation\\.model === defaultModel/);
  assert.match(workerSource, /ctx\\.waitUntil\\(memoryWarmup\\)/);
  assert.match(workerSource, /event: "signed_in_chat_prepared"/);
  assert.match(workerSource, /Server-Timing/);
  assert.match(workerSource, /X-Stabilize-Preparation-Ms/);

  assert.match(billingSource, /Signed-in instant chats use the unmetered default model/);
  assert.match(billingSource, /config\\.freeModel === config\\.defaultModel/);
  assert.match(billingSource, /tier: null/);
  assert.match(billingSource, /model: config\\.freeModel/);
  assert.match(billingSource, /model: config\\.fallbackModel/);

  assert.match(clientSource, /free Current thinking messages used today/);
  assert.match(clientSource, /function updateSelectedModelDisplay\\(model\\)/);
  assert.match(clientSource, /X-Stabilize-Model-Selected/);

  const packageJson = JSON.parse(packageSource);
  assert.equal(
    packageJson.scripts["apply:prompt-policy"],
    "node scripts/prepare-signed-in-latency.mjs && node scripts/apply-priority-latency.mjs && node scripts/apply-signed-in-latency.mjs",
  );
});
`);

await update("test/model-usage-worker.test.mjs", () => `import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/paid-worker.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

const BASE_ENV = {
  ...env,
  DEMO_MODE: "false",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "gpt-5.4",
  OPENAI_REASONING_EFFORT: "none",
  OPENAI_SERVICE_TIER: "fast",
  MODEL_CHOICES: "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
  FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-sol",
  FREE_PLAN_FALLBACK_MODEL: "gpt-5.4",
  FREE_DAILY_MODEL_MESSAGE_LIMIT: "2",
  PAID_MONTHLY_MESSAGE_LIMIT: "200",
  PUBLIC_ORIGIN: "https://stabilize.info",
  GOOGLE_CLIENT_ID:
    "1234567890-stabilize-model-usage.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  AUTH_SECRET: "test-auth-secret-with-at-least-thirty-two-characters",
};

async function identity(subject) {
  const token = await createAuthSessionTokenForGoogleSubject(subject, BASE_ENV);
  const cookie = \`\${AUTH_COOKIE_NAME}=\${token}\`;
  const session = await readAuthSession(
    new Request("https://stabilize.info/", { headers: { Cookie: cookie } }),
    BASE_ENV,
  );
  assert.ok(session);
  return {
    cookie,
    billing: BASE_ENV.BILLING.getByName(\`google:\${session.accountKey}\`),
  };
}

function responseWithText(text) {
  return Response.json({
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text, annotations: [] },
        ],
      },
    ],
  });
}

function chatRequest(cookie, message, reasoningEffort = "none") {
  return new Request("https://stabilize.info/api/chat", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: "https://stabilize.info",
    },
    body: JSON.stringify({ message, reasoningEffort }),
  });
}

test("signed-in instant is unmetered GPT-5.4 while thinking uses Current then falls back", async () => {
  const user = await identity("fast-signed-in-model-user");
  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    providerRequests.push({ model: body.model, effort: body.reasoning.effort });
    return responseWithText("Use the smallest reversible step.");
  };

  try {
    const instant = await worker.fetch(
      chatRequest(user.cookie, "Give me one quick step."),
      BASE_ENV,
      {},
    );
    assert.equal(instant.status, 200);
    assert.equal(instant.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal(instant.headers.get("X-Stabilize-Model-Usage-Tier"), null);
    assert.match(instant.headers.get("Server-Timing") || "", /stabilize-billing/);
    assert.equal((await instant.json()).reply, "Use the smallest reversible step.");
    assert.equal((await user.billing.readState()).freeUsageCount, 0);

    for (const expectedUsed of [1, 2]) {
      const response = await worker.fetch(
        chatRequest(user.cookie, \`Think through step \${expectedUsed}.\`, "high"),
        BASE_ENV,
        {},
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
      assert.equal(response.headers.get("X-Stabilize-Model-Usage-Used"), String(expectedUsed));
      assert.equal(response.headers.get("X-Stabilize-Model-Usage-Limit"), "2");
      assert.equal((await response.json()).reply, "Use the smallest reversible step.");
    }

    const fallback = await worker.fetch(
      chatRequest(user.cookie, "Think through one more step.", "high"),
      BASE_ENV,
      {},
    );
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal((await fallback.json()).reply, "Use the smallest reversible step.");

    assert.deepEqual(providerRequests, [
      { model: "gpt-5.4", effort: "none" },
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.4", effort: "none" },
    ]);
    const state = await user.billing.readState();
    assert.equal(state.freeUsageCount, 2);
    assert.equal(state.paidUsageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the free homepage presents GPT-5.4 fastest response and the Current thinking allowance", async () => {
  const user = await identity("fast-signed-in-model-page-user");
  const page = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: user.cookie },
    }),
    BASE_ENV,
    {},
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /0 of 2 free Current thinking messages used today/);
  assert.match(html, /Fastest response uses GPT-5.4/);
  assert.match(html, /<span class="composer-model-current">5\\.4<\\/span>/);
  assert.doesNotMatch(html, /id="composer-model-choice" name="model"/);
});
`);

await update("test/paid-worker.test.mjs", (source) => {
  if (
    source.includes(
      'test("a free signed-in user gets GPT-5.4 instantly and Current when thinking"',
    )
  ) {
    return source;
  }
  const replacement = `test("a free signed-in user gets GPT-5.4 instantly and Current when thinking", async () => {
  const user = await identity("free-daily-model-user");
  const limitedEnv = {
    ...TEST_ENV,
    OPENAI_MODEL: "gpt-5.4",
    OPENAI_REASONING_EFFORT: "none",
    OPENAI_SERVICE_TIER: "fast",
    MODEL_CHOICES: "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
    FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-sol",
    FREE_PLAN_FALLBACK_MODEL: "gpt-5.4",
    FREE_DAILY_MODEL_MESSAGE_LIMIT: "2",
  };
  const page = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: user.cookie },
    }),
    limitedEnv,
    {},
  );
  assert.equal(page.status, 200);
  assert.match(await page.text(), /0 of 2 free Current thinking messages used today/);

  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    providerRequests.push({ model: body.model, effort: body.reasoning.effort });
    return responseWithText("Use the smallest reversible step.");
  };

  try {
    const instant = await worker.fetch(
      new Request("https://stabilize.info/api/chat", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: user.cookie,
          Origin: "https://stabilize.info",
        },
        body: JSON.stringify({ message: "Give me a quick step." }),
      }),
      limitedEnv,
      {},
    );
    assert.equal(instant.status, 200);
    assert.equal(instant.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal((await user.billing.readState()).freeUsageCount, 0);

    const thinking = await worker.fetch(
      new Request("https://stabilize.info/api/chat", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: user.cookie,
          Origin: "https://stabilize.info",
        },
        body: JSON.stringify({
          message: "Think through this step.",
          reasoningEffort: "high",
        }),
      }),
      limitedEnv,
      {},
    );
    assert.equal(thinking.status, 200);
    assert.equal(thinking.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
    assert.equal(thinking.headers.get("X-Stabilize-Model-Usage-Used"), "1");
    assert.deepEqual(providerRequests, [
      { model: "gpt-5.4", effort: "none" },
      { model: "gpt-5.6-sol", effort: "high" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

`;
  return replaceRegexRequired(
    source,
    /test\("a free signed-in user automatically gets GPT-5\.6 before GPT-5\.4 fallback"[\s\S]*?\n\}\);\n\n(?=test\("an entitled user)/,
    replacement,
    "the free signed-in routing Worker test",
  );
});

await update("test/paid-model-choice.test.mjs", (source) => {
  let next = source;
  next = next.replace(
    "automatic free model routing and subscriber choice share a resilient left-side picker",
    "fast signed-in routing and subscriber choice share a resilient left-side picker",
  );
  next = next.replace(
    /stub\\\.prepareChat\\\(chatPreparationOptions\\\(env\\\)\\\)/g,
    "stub\\.prepareChat\\(chatPreparationOptions\\(env, body\\)\\)",
  );
  next = next.replace(
    /const \\\\[preparation, memory\\\\] = await Promise\\\\.all/,
    "const \\[billingPreparation, memoryPreparation\\] = await Promise\\.all",
  );
  next = next.replace(
    /freeLimit\[\\s\\S\]\*GPT-5\\\\\.6 Instant messages/,
    "freeLimit[\\s\\S]*Current thinking messages",
  );
  next = next.replace(
    /assert\.match\(accountSource, \/model: config\\\\\.freeModel\/\);/,
    `assert.match(accountSource, /config\\.freeModel === config\\.defaultModel/);\n  assert.match(accountSource, /model: config\\.freeModel/);`,
  );
  next = next.replace(
    `    "node scripts/apply-priority-latency.mjs",`,
    `    "node scripts/prepare-signed-in-latency.mjs && node scripts/apply-priority-latency.mjs && node scripts/apply-signed-in-latency.mjs",`,
  );
  next = next.replace(
    /50 free GPT-5\\\.6 Instant messages per UTC day/,
    "50 free Current thinking messages per UTC day",
  );
  return next;
});

await update("test/domain.test.mjs", (source) => {
  let next = source;
  next = next.replace(
    `    assert.match(description, /GPT-5\\.6 Instant/);`,
    `    assert.match(description, /Current/);`,
  );
  next = next.replace(
    `  assert.match(about, /Signed-in free accounts automatically receive 50 GPT-5\\.6 Instant/);`,
    `  assert.match(about, /Signed-in free accounts use GPT-5\\.4 for Fastest response and receive 50 Current thinking/);`,
  );
  next = next.replace(
    `  assert.match(sustainability, /free GPT-5\\.6 Instant → GPT-5\\.4 ladder intact/);`,
    `  assert.match(sustainability, /free GPT-5\\.4 fastest-response and Current-thinking policy intact/);`,
  );
  next = next.replace(
    `  assert.match(about, /50 GPT-5\\.6 Instant\\s+messages per UTC day/i);`,
    `  assert.match(about, /50 Current thinking\\s+messages per UTC day/i);`,
  );
  return next;
});

await update("test/priority-latency-worker.test.mjs", (source) => {
  if (source.includes("fastDefault")) return source;
  const anchor = `  const free = await stub.prepareChat(options);
`;
  const replacement = `  const fastDefault = await stub.prepareChat({
    ...options,
    freeModel: "gpt-5.4",
  });
  assert.equal(fastDefault.allowed, true);
  assert.equal(fastDefault.model, "gpt-5.4");
  assert.equal(fastDefault.tier, null);
  assert.equal(fastDefault.reservationMade, false);
  assert.equal(fastDefault.used, 0);

${anchor}`;
  return replaceRequired(
    source,
    anchor,
    replacement,
    "the BillingAccount fast-default regression",
  );
});

console.log(
  "Applied signed-in fast-default routing, memory warmup, preparation timing, and Current thinking allowance.",
);

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
  return replaceRequired(
    source,
    anchor,
    `      ${marker}
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

${anchor}`,
    "the free usage reservation",
  );
});

await update("src/paid-worker.js", (source) => {
  let next = source;

  const preparationOptions = `function chatPreparationOptions(env, body = {}) {
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
    preparationOptions,
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
  next = next.replaceAll(
    `      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +`,
    `      "<p>Fastest response uses GPT-5.4. Choose a thinking level to use Current for up to " +
      freeLimit +
      " messages each UTC day.</p>" +`,
  );
  next = next.replaceAll(
    `      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +`,
    `      "<p>Fastest response uses GPT-5.4. Choose a thinking level to use Current for up to " +
      freeLimit +
      " messages each UTC day.</p>" +`,
  );
  next = next.replaceAll(
    `      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +`,
    `      "<p>Fastest response uses GPT-5.4. Choose a thinking level to use Current for up to " +
      freeLimit +
      " messages each UTC day.</p>" +`,
  );
  next = next.replaceAll(
    `      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +`,
    `      "<p>Fastest response uses GPT-5.4. Choose a thinking level to use Current for up to " +
      freeLimit +
      " messages each UTC day.</p>" +`,
  );
  next = next.replaceAll(
    `      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +`,
    `      "<p>Fastest response uses GPT-5.4. Choose a thinking level to use Current for up to " +
      freeLimit +
      " messages each UTC day.</p>" +`,
  );
  next = next.replaceAll(
    `      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +`,
    `      "<p>Fastest response uses GPT-5.4. Choose a thinking level to use Current for up to " +
      freeLimit +
      " messages each UTC day.</p>" +`,
  );
  next = next.replace(
    `    modelPanel =
      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +`,
    `    modelPanel =
      "<p>Fastest response uses GPT-5.4. Choose a thinking level to use Current for up to " +
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
  if (!next.includes("const memoryWarmup = readMemoryContext(")) {
    next = replaceRequired(
      next,
      rootAnchor,
      rootReplacement,
      "the signed-in page memory warmup",
    );
  }

  const oldHandlerStart = `async function paidChatResponse(request, env, ctx) {
  if (request.method !== "POST") return originalWorker.fetch(request, env, ctx);
  const authSession = await readAuthSession(request, env);`;
  const timedHandlerStart = `async function paidChatResponse(request, env, ctx) {
  if (request.method !== "POST") return originalWorker.fetch(request, env, ctx);
  const requestStartedAt = Date.now();
  const authStartedAt = Date.now();
  const authSession = await readAuthSession(request, env);
  const authMs = Date.now() - authStartedAt;`;
  if (!next.includes("const requestStartedAt = Date.now();")) {
    next = replaceRequired(
      next,
      oldHandlerStart,
      timedHandlerStart,
      "signed-in authentication timing",
    );
  }

  const oldPreparation = `  const memoryStub = body?.privateChat === true
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
  if (!next.includes("const billingPreparation = stub")) {
    next = replaceRequired(
      next,
      oldPreparation,
      timedPreparation,
      "parallel signed-in preparation timing",
    );
  }

  const oldReasoning = `  if (preparation.paid !== true) body.reasoningEffort = "none";
  const selectedEnv = modelEnvironment(env, preparation.model);
  const response = await preparedChatResponse(`;
  const newReasoning = `  const defaultModel = String(env.OPENAI_MODEL || "gpt-5.4");
  if (preparation.paid !== true && preparation.model === defaultModel) {
    body.reasoningEffort = "none";
  }
  const selectedEnv = modelEnvironment(env, preparation.model);
  let response = await preparedChatResponse(`;
  if (!next.includes("preparation.model === defaultModel")) {
    next = replaceRequired(
      next,
      oldReasoning,
      newReasoning,
      "free reasoning preservation",
    );
  }

  const oldAfterResponse = `    body?.privateChat === true ? emptyMemoryContext() : memory,
  );

  if (
    preparation.reservationMade &&`;
  const timedAfterResponse = `    body?.privateChat === true ? emptyMemoryContext() : memory,
  );
  response = responseWithPreparationTiming(response, {
    authMs,
    billingMs: billingResult.durationMs,
    memoryMs: memoryResult.durationMs,
    preparationMs,
    model: preparation.model,
  });

  if (
    preparation.reservationMade &&`;
  if (!next.includes("response = responseWithPreparationTiming(response")) {
    next = replaceRequired(
      next,
      oldAfterResponse,
      timedAfterResponse,
      "preparation timing response headers",
    );
  }

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
    " free GPT-5.6 Instant messages used today. Stabilize switches to GPT-5.4 after this allowance. The allowance resets at 00:00 UTC.",
    " free Current thinking messages used today. Fastest response uses GPT-5.4 and does not count. The allowance resets at 00:00 UTC.",
  );
  next = next.replace(
    " GPT-5.6 Instant messages. Stabilize switched to GPT-5.4 automatically; your message was still sent.",
    " Current thinking messages. Stabilize used GPT-5.4 for this message; it was still sent.",
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

  const oldFetch = `  if (chatRequestPath(args[0]) === "/api/chat") {
    const usage = modelUsageFromResponse(response);
    if (usage) updateModelUsageDisplay(usage);
  }`;
  const newFetch = `  if (chatRequestPath(args[0]) === "/api/chat") {
    updateSelectedModelDisplay(
      response.headers.get("X-Stabilize-Model-Selected"),
    );
    const usage = modelUsageFromResponse(response);
    if (usage) updateModelUsageDisplay(usage);
  }`;
  if (!next.includes("response.headers.get(\"X-Stabilize-Model-Selected\")")) {
    next = replaceRequired(
      next,
      oldFetch,
      newFetch,
      "model display update after chat",
    );
  }
  return next;
});

await update("README.md", (source) =>
  source
    .replace(
      "- automatic signed-in free access to GPT-5.6 Instant for the first 50 completed ordinary messages each UTC day, followed by GPT-5.4",
      "- signed-in fast replies on GPT-5.4 plus 50 free Current thinking messages per UTC day",
    )
    .replace(
      "- **Signed-in free account:** the first **50** completed ordinary messages in each UTC day use `gpt-5.6-sol` with the no-extra-reasoning **Instant** setting. After that allowance is used, chats continue on GPT-5.4. The allowance resets at `00:00 UTC`.",
      "- **Signed-in free account:** **Fastest response** uses GPT-5.4, matching guest speed while retaining account memory. Choosing a thinking level uses **Current** (`gpt-5.6-sol`) for up to **50** completed messages per UTC day; after that allowance, the request continues on GPT-5.4. The allowance resets at `00:00 UTC`.",
    )
    .replace(
      "The public labels intentionally use **GPT-5.6 Instant**, **GPT-5.4**, and **Current**. Internal API model IDs remain in configuration and code.",
      "The public labels intentionally use **GPT-5.4**, **Current**, and thinking-level names. Internal API model IDs remain in configuration and code.",
    )
    .replace(
      "The current repository still contains an ordered compatibility/materialization pipeline under `scripts/`. Run the standard npm commands rather than invoking later scripts in isolation; the idempotency suite checks that the complete ordered policy pass is repeatable.",
      "The current repository materializes the production policy through the standard npm commands. Run those commands rather than invoking individual scripts in isolation; the clean-tree guard verifies that generation is repeatable.",
    )
    .replace(
      "`OPENAI_MODEL` is the guest and fallback model. The two `FREE_PLAN_*` values define the automatic signed-in free ladder.",
      "`OPENAI_MODEL` is the guest, signed-in fastest-response, and fallback model. The two `FREE_PLAN_*` values define the signed-in Current thinking allowance and fallback.",
    ),
);

await update("docs/STRIPE_MODEL_CHOICE_SETUP.md", (source) =>
  source
    .replace(
      "Stabilize uses an automatic model ladder for signed-in free accounts and an optional Stripe subscription for a larger monthly non-default-model allowance.",
      "Stabilize keeps signed-in fastest responses on GPT-5.4 and provides a free daily Current thinking allowance, plus an optional Stripe subscription for a larger monthly non-default-model allowance.",
    )
    .replace(
      "- signed-in free accounts receive 50 free GPT-5.6 Instant messages per UTC day, then continue on GPT-5.4",
      "- signed-in free accounts use GPT-5.4 for Fastest response and receive 50 free Current thinking messages per UTC day",
    )
    .replaceAll(
      "50 free GPT-5.6 Instant messages per UTC day",
      "50 free Current thinking messages per UTC day",
    )
    .replace(
      "The automatic free ladder remains available even when Stripe is not configured.",
      "The free Current thinking allowance remains available even when Stripe is not configured.",
    ),
);

for (const path of ["public/about.html", "public/sustainability.html"]) {
  await update(path, (source) =>
    source
      .replaceAll(
        "50 automatic GPT-5.6 Instant messages per UTC day for signed-in free accounts before GPT-5.4 takes over",
        "GPT-5.4 fastest responses plus 50 free Current thinking messages per UTC day for signed-in accounts",
      )
      .replaceAll(
        "50 GPT-5.6 Instant messages per UTC day",
        "50 Current thinking messages per UTC day",
      )
      .replaceAll(
        "free GPT-5.6 Instant → GPT-5.4 ladder intact",
        "free GPT-5.4 fastest-response and Current-thinking policy intact",
      ),
  );
}

console.log(
  "Applied signed-in fast-default routing, memory warmup, preparation timing, and Current thinking allowance.",
);

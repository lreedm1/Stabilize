import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ASSET_VERSION = "20260807-priority-latency-1";

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Priority latency policy could not find ${label}`);
  }
  return source.replace(before, after);
}

function replaceRegexRequired(source, pattern, replacement, label) {
  if (typeof replacement === "string" && source.includes(replacement)) {
    return source;
  }
  if (!pattern.test(source)) {
    throw new Error(`Priority latency policy could not find ${label}`);
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/index.js", (source) => {
  let next = source;

  const serviceTierConstants = `const OPENAI_SERVICE_TIERS = new Set(["default", "priority", "fast"]);
const PROMPT_CACHE_KEY = "stabilize-floor-first-v1";
const ORDINARY_OUTPUT_TOKEN_LIMIT = 360;
const LONG_FORM_OUTPUT_TOKEN_LIMIT = 900;
const LONG_FORM_REQUEST_PATTERN =
  /\\b(?:draft|write|rewrite|compose|email|letter|memo|report|speech|proposal|brief|document|essay|code|script|full version|detailed|comprehensive)\\b/i;
`;
  if (!next.includes('const OPENAI_SERVICE_TIERS = new Set(')) {
    next = replaceRequired(
      next,
      'const OPENAI_ACCOUNT_LIMIT_CODES = new Set([',
      serviceTierConstants + 'const OPENAI_ACCOUNT_LIMIT_CODES = new Set([',
      "OpenAI account-limit constants",
    );
  }

  for (const [before, after] of [
    ["function emptyMemoryContext() {", "export function emptyMemoryContext() {"],
    ["function accountMemoryStub(env, accountKey) {", "export function accountMemoryStub(env, accountKey) {"],
    ["async function readMemoryContext(stub) {", "export async function readMemoryContext(stub) {"],
    ["async function readBoundedJson(request) {", "export async function readBoundedJson(request) {"],
  ]) {
    if (!next.includes(after)) {
      next = replaceRequired(next, before, after, after);
    }
  }

  const interactiveHelpers = `function supportsExplicitPromptCaching(model) {
  const match = /^gpt-(\\d+)\\.(\\d+)/.exec(String(model || ""));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 5 || (major === 5 && minor >= 6);
}

function interactiveOutputTokenLimit(latestText, reasoningEffort) {
  if (reasoningEffort !== "none") return null;
  return LONG_FORM_REQUEST_PATTERN.test(String(latestText || ""))
    ? LONG_FORM_OUTPUT_TOKEN_LIMIT
    : ORDINARY_OUTPUT_TOKEN_LIMIT;
}

function interactivePrompt(model, route, messages) {
  const stableInstructions = COPY.model.systemPrompt;
  const variableInstructions =
    COPY.model.memoryInstruction +
    "\\n\\n" +
    COPY.model.routeInstruction(route);

  if (!supportsExplicitPromptCaching(model)) {
    return {
      instructions: stableInstructions + "\\n\\n" + variableInstructions,
      input: messages,
    };
  }

  return {
    prompt_cache_key: PROMPT_CACHE_KEY,
    prompt_cache_options: { mode: "explicit", ttl: "30m" },
    input: [
      {
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text: stableInstructions,
            prompt_cache_breakpoint: { mode: "explicit" },
          },
          {
            type: "input_text",
            text: "\\n\\n" + variableInstructions,
          },
        ],
      },
      ...messages,
    ],
  };
}

function chatRequestPayload({
  model,
  reasoningEffort,
  serviceTier,
  route,
  messages,
  latestText,
}) {
  const outputLimit = interactiveOutputTokenLimit(
    latestText,
    reasoningEffort,
  );
  return {
    model,
    service_tier: serviceTier,
    reasoning: { effort: reasoningEffort },
    ...(outputLimit ? { max_output_tokens: outputLimit } : {}),
    text: { verbosity: "low" },
    ...interactivePrompt(model, route, messages),
    store: true,
  };
}

function usageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function logInteractiveUsage(result, model, requestedServiceTier) {
  const usage = result?.usage || {};
  const inputDetails = usage.input_tokens_details || {};
  console.info(
    JSON.stringify({
      event: "openai_chat_usage",
      model: String(model || "").slice(0, 128),
      requestedServiceTier,
      actualServiceTier: safeProviderField(result?.serviceTier),
      inputTokens: usageNumber(usage.input_tokens),
      cachedTokens: usageNumber(inputDetails.cached_tokens),
      cacheWriteTokens: usageNumber(inputDetails.cache_write_tokens),
      outputTokens: usageNumber(usage.output_tokens),
    }),
  );
}

`;
  if (!next.includes("function supportsExplicitPromptCaching(model)")) {
    next = replaceRequired(
      next,
      "function openAIConfig(env) {",
      interactiveHelpers + "function openAIConfig(env) {",
      "OpenAI configuration function",
    );
  }

  if (!next.includes('const serviceTier = String(env.OPENAI_SERVICE_TIER || "fast")')) {
    next = replaceRequired(
      next,
      `  const requestedReasoningEffort = String(
    env.OPENAI_REASONING_EFFORT || "none",
  );`,
      `  const requestedReasoningEffort = String(
    env.OPENAI_REASONING_EFFORT || "none",
  );
  const serviceTier = String(env.OPENAI_SERVICE_TIER || "fast")
    .trim()
    .toLowerCase();`,
      "OpenAI service-tier selection",
    );
    next = replaceRequired(
      next,
      `    !/^[A-Za-z0-9._:-]+$/.test(model) ||
    !OPENAI_REASONING_EFFORTS.has(requestedReasoningEffort)`,
      `    !/^[A-Za-z0-9._:-]+$/.test(model) ||
    !OPENAI_REASONING_EFFORTS.has(requestedReasoningEffort) ||
    !OPENAI_SERVICE_TIERS.has(serviceTier)`,
      "OpenAI configuration validation",
    );
    next = replaceRequired(
      next,
      "  return { apiKey, model, reasoningEffort };",
      "  return { apiKey, model, reasoningEffort, serviceTier };",
      "OpenAI configuration return value",
    );
  }

  if (!next.includes("usage: responseBody?.usage || null")) {
    next = replaceRequired(
      next,
      `  return {
    text: responseText(responseBody),
    providerRequestId,
    clientRequestId,
  };`,
      `  return {
    text: responseText(responseBody),
    usage: responseBody?.usage || null,
    serviceTier: safeProviderField(responseBody?.service_tier),
    providerRequestId,
    clientRequestId,
  };`,
      "non-streaming provider response metadata",
    );
  }

  if (!next.includes("usage: null, serviceTier: null")) {
    next = replaceRequired(
      next,
      "  return { response, controller, timeout, providerRequestId, clientRequestId };",
      "  return { response, controller, timeout, providerRequestId, clientRequestId, usage: null, serviceTier: null };",
      "stream provider response metadata",
    );
  }

  if (!next.includes("function streamEventText(event, result)")) {
    next = replaceRequired(
      next,
      "function streamEventText(event) {",
      `function streamEventText(event, result) {
  if (event?.response?.usage) result.usage = event.response.usage;
  const actualTier = safeProviderField(event?.response?.service_tier);
  if (actualTier) result.serviceTier = actualTier;`,
      "stream completion metadata",
    );
    next = replaceRequired(
      next,
      "    const eventText = streamEventText(event);",
      "    const eventText = streamEventText(event, result);",
      "stream event metadata call",
    );
  }

  const fallbackFunction = `async function generateFallbackReply(messages, route, env, latestText) {
  const { apiKey, model, reasoningEffort, serviceTier } = openAIConfig(env);
  const result = await callOpenAI(
    chatRequestPayload({
      model,
      reasoningEffort,
      serviceTier,
      route,
      messages,
      latestText,
    }),
    apiKey,
    60_000,
    "OpenAIFallbackHttpError",
  );
  logInteractiveUsage(result, model, serviceTier);

  const reply = validateModelReply(result.text);
  if (!reply) {
    throw new OpenAIRequestError({
      name: "OpenAIInvalidReplyError",
      failure: "invalid_output",
      status: 502,
      code: "empty_fallback",
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }
  return reply;
}

`;
  if (!next.includes("async function generateFallbackReply(messages, route, env, latestText)")) {
    next = replaceRegexRequired(
      next,
      /async function generateFallbackReply\(messages, route, env\) \{[\s\S]*?\n\}\n\n(?=async function writeReplyDeltas)/,
      fallbackFunction,
      "fallback reply generator",
    );
    next = replaceRequired(
      next,
      "reply = await generateFallbackReply(messages, route, env);",
      "reply = await generateFallbackReply(messages, route, env, latestText);",
      "fallback reply invocation",
    );
  }

  if (!next.includes("chatRequestPayload({\n              model,")) {
    next = replaceRegexRequired(
      next,
      /          const \{ apiKey, model, reasoningEffort \} = openAIConfig\(env\);\n          const turnReasoningEffort = reasoningEffort;\n          const result = await openAIStream\(\n            \{[\s\S]*?\n            \},\n            apiKey,\n            60_000,\n            "OpenAIHttpError",\n          \);/,
      `          const { apiKey, model, reasoningEffort, serviceTier } =
            openAIConfig(env);
          const turnReasoningEffort = reasoningEffort;
          const result = await openAIStream(
            chatRequestPayload({
              model,
              reasoningEffort: turnReasoningEffort,
              serviceTier,
              route,
              messages,
              latestText,
            }),
            apiKey,
            60_000,
            "OpenAIHttpError",
          );`,
      "streaming OpenAI request payload",
    );
    next = replaceRequired(
      next,
      `          for await (const delta of openAITextDeltas(result)) {
            reply += delta;
            await writer.write(streamEvent({ type: "delta", delta }));
          }`,
      `          for await (const delta of openAITextDeltas(result)) {
            reply += delta;
            await writer.write(streamEvent({ type: "delta", delta }));
          }
          logInteractiveUsage(result, model, serviceTier);`,
      "stream usage logging",
    );
  }

  const nonStreamingFunction = `async function generateReply(messages, route, env, latestText) {
  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";
  if (demoMode) return demoReply(route, latestText);

  const { apiKey, model, reasoningEffort, serviceTier } = openAIConfig(env);
  const result = await callOpenAI(
    chatRequestPayload({
      model,
      reasoningEffort,
      serviceTier,
      route,
      messages,
      latestText,
    }),
    apiKey,
    60_000,
    "OpenAIHttpError",
  );
  logInteractiveUsage(result, model, serviceTier);

  const reply = validateModelReply(result.text);
  if (!reply) {
    throw new OpenAIRequestError({
      name: "OpenAIInvalidReplyError",
      failure: "invalid_output",
      status: 502,
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }
  if (
    route === "ORDINARY" &&
    isNeutralGreeting(latestText) &&
    isUnsolicitedSafetyCheck(reply)
  ) {
    return "Hi. What’s happening right now?";
  }
  return reply;
}

`;
  if (!next.includes("const { apiKey, model, reasoningEffort, serviceTier } = openAIConfig(env);\n  const result = await callOpenAI(\n    chatRequestPayload")) {
    next = replaceRegexRequired(
      next,
      /async function generateReply\(messages, route, env, latestText\) \{[\s\S]*?\n\}\n\n(?=function sanitizeSummary)/,
      nonStreamingFunction,
      "non-streaming reply generator",
    );
  }

  const chatErrorHelper = `function chatErrorResponse(error, path) {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.status);
  }

  if (error instanceof OpenAIRequestError) {
    const publicError = publicOpenAIError(error);
    const reference = errorReference(error.clientRequestId);
    console.error(
      JSON.stringify({
        event: "openai_request_failed",
        error: error.name,
        failure: error.failure,
        status: error.status || null,
        code: error.code,
        type: error.type,
        providerRequestId: error.providerRequestId,
        clientRequestId: error.clientRequestId,
        retryAfterSeconds: error.retryAfterSeconds,
        reference,
        path,
      }),
    );
    const headers = publicError.retryAfterSeconds
      ? { "Retry-After": String(publicError.retryAfterSeconds) }
      : {};
    return jsonResponse(
      { error: publicError.message, reference },
      publicError.status,
      headers,
    );
  }

  const clientRequestId = crypto.randomUUID();
  const reference = errorReference(clientRequestId);
  console.error(
    JSON.stringify({
      event: "request_failed",
      error: error instanceof Error ? error.name : "UnknownError",
      clientRequestId,
      reference,
      path,
    }),
  );
  return jsonResponse(
    { error: COPY.api.temporarilyUnavailable, reference },
    503,
  );
}

`;
  if (!next.includes("function chatErrorResponse(error, path)")) {
    next = replaceRequired(
      next,
      "async function callOpenAI(payload, apiKey, timeoutMs, errorName) {",
      chatErrorHelper + "async function callOpenAI(payload, apiKey, timeoutMs, errorName) {",
      "OpenAI call helper",
    );
  }

  const preparedChatFunctions = `export async function handlePreparedChat(
  request,
  env,
  ctx,
  accountKey,
  body,
  preparedMemory = null,
) {
  env = reasoningEnvironment(
    env,
    requestedReasoningEffort(
      body,
      env.OPENAI_MODEL,
      env.OPENAI_REASONING_EFFORT,
    ),
  );
  const privateChat = body?.privateChat === true;
  const latestText = latestUserText(body);
  if (!latestText) throw new HttpError(400, COPY.api.messageRequired);
  if (latestText.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, COPY.api.messageTooLong);
  }

  const stub = privateChat ? null : accountMemoryStub(env, accountKey);
  const clientAwaiting = body?.awaitingSafetyAnswer === true;
  let route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting,
  });
  let fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(stub, route, fixed);
    if (!schedule(ctx, task)) await task;
    return jsonResponse({ route, ...fixed });
  }

  const memory = privateChat
    ? emptyMemoryContext()
    : preparedMemory || (await readMemoryContext(stub));

  route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting || memory.awaitingSafetyAnswer,
  });
  fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(stub, route, fixed);
    if (!schedule(ctx, task)) await task;
    return jsonResponse({ route, ...fixed });
  }

  const messages = privateChat
    ? privateModelInput(body?.messages, latestText)
    : modelInput(memory, latestText);
  if (!messages.length) throw new HttpError(400, COPY.api.invalidConversation);

  const acceptsStreaming = (request.headers.get("accept") || "")
    .toLowerCase()
    .includes("application/x-ndjson");
  if (acceptsStreaming) {
    return streamChatReply(messages, route, env, latestText, stub, ctx);
  }

  const reply = await generateReply(messages, route, env, latestText);
  const result = await recordExchange(stub, {
    user: latestText,
    assistant: reply,
    awaitingSafetyAnswer: false,
  });

  if (result?.shouldCompact && stub && ctx) {
    schedule(ctx, compactSession(stub, env));
  }

  return jsonResponse({
    route,
    reply,
    showEmergency: false,
    awaitingSafetyAnswer: false,
  });
}

async function handleChat(request, env, ctx, accountKey) {
  const body = await readBoundedJson(request);
  return handlePreparedChat(request, env, ctx, accountKey, body);
}

export async function preparedChatResponse(
  request,
  body,
  env,
  ctx,
  accountKey,
  preparedMemory,
) {
  try {
    return await handlePreparedChat(
      request,
      env,
      ctx,
      accountKey,
      body,
      preparedMemory,
    );
  } catch (error) {
    return chatErrorResponse(error, new URL(request.url).pathname);
  }
}

`;
  if (!next.includes("export async function handlePreparedChat(")) {
    next = replaceRegexRequired(
      next,
      /async function handleChat\(request, env, ctx, accountKey\) \{[\s\S]*?\n\}\n\n(?=function authNotice)/,
      preparedChatFunctions,
      "chat request handler",
    );
  }

  return next;
});

await update("src/billing-account.js", (source) => {
  let next = source;

  const prepareNormalizer = `function cleanModelId(value) {
  const model = String(value || "").trim().slice(0, 128);
  return MODEL_ID_PATTERN.test(model) ? model : null;
}

function normalizePrepareOptions(options) {
  const allowedModels = Array.isArray(options?.allowedModels)
    ? [...new Set(options.allowedModels.map(cleanModelId).filter(Boolean))]
    : [];
  const defaultModel = cleanModelId(options?.defaultModel);
  const freeModel = cleanModelId(options?.freeModel);
  const fallbackModel = cleanModelId(options?.fallbackModel);
  const paidPeriod = String(options?.paidPeriod || "").trim();
  const freePeriod = String(options?.freePeriod || "").trim();
  const paidLimit = Number(options?.paidLimit);
  const freeLimit = Number(options?.freeLimit);

  if (
    !defaultModel ||
    !freeModel ||
    !fallbackModel ||
    !allowedModels.includes(defaultModel) ||
    !allowedModels.includes(freeModel) ||
    !allowedModels.includes(fallbackModel) ||
    !MONTHLY_PERIOD_PATTERN.test(paidPeriod) ||
    !DAILY_PERIOD_PATTERN.test(freePeriod) ||
    !Number.isSafeInteger(paidLimit) ||
    paidLimit < 1 ||
    !Number.isSafeInteger(freeLimit) ||
    freeLimit < 1
  ) {
    throw new Error("Invalid chat preparation");
  }

  return {
    allowedModels: new Set(allowedModels),
    defaultModel,
    freeModel,
    fallbackModel,
    paidPeriod,
    freePeriod,
    paidLimit,
    freeLimit,
  };
}

`;
  if (!next.includes("function normalizePrepareOptions(options)")) {
    next = replaceRequired(
      next,
      "export class BillingAccount extends DurableObject {",
      prepareNormalizer + "export class BillingAccount extends DurableObject {",
      "BillingAccount class",
    );
  }

  const usageMethods = `  reserveUsageSync(tier, period, limit) {
    if (tier === "paid") {
      const billing = this.ctx.storage.sql
        .exec(
          \`SELECT subscription_status
           FROM billing_state
           WHERE id = 1\`,
        )
        .toArray()[0];
      if (!billing || !ACTIVE_STATUSES.has(String(billing.subscription_status))) {
        return { allowed: false, reason: "inactive", used: 0, limit };
      }
    }

    const row = this.ctx.storage.sql
      .exec(
        \`SELECT usage_count
         FROM model_usage
         WHERE tier = ? AND period = ?\`,
        tier,
        period,
      )
      .toArray()[0];
    const used = row ? Math.max(0, Number(row.usage_count) || 0) : 0;
    if (used >= limit) {
      return { allowed: false, reason: "limit", used, limit };
    }

    const next = used + 1;
    const now = Date.now();
    this.ctx.storage.sql.exec(
      \`INSERT INTO model_usage (
         tier, period, usage_count, updated_at
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(tier, period) DO UPDATE SET
         usage_count = excluded.usage_count,
         updated_at = excluded.updated_at\`,
      tier,
      period,
      next,
      now,
    );
    this.ctx.storage.sql.exec(
      \`DELETE FROM model_usage
       WHERE tier = ? AND period <> ?\`,
      tier,
      period,
    );
    return { allowed: true, reason: null, used: next, limit };
  }

  async reserveUsage(tierOrPeriod, periodOrLimit, maybeLimit) {
    const { tier, period, limit } = normalizeReservation(
      tierOrPeriod,
      periodOrLimit,
      maybeLimit,
    );
    return this.ctx.storage.transactionSync(() =>
      this.reserveUsageSync(tier, period, limit),
    );
  }

  async prepareChat(options) {
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
      };
    });
  }

`;
  if (!next.includes("async prepareChat(options)")) {
    next = replaceRegexRequired(
      next,
      /  async reserveUsage\(tierOrPeriod, periodOrLimit, maybeLimit\) \{[\s\S]*?\n  \}\n\n(?=  async refundUsage)/,
      usageMethods,
      "usage reservation method",
    );
  }

  return next;
});

await update("src/paid-worker.js", (source) => {
  let next = source;

  const expandedImport = `import originalWorker, {
  SessionMemory,
  accountMemoryStub,
  emptyMemoryContext,
  preparedChatResponse,
  readBoundedJson,
  readMemoryContext,
} from "./index.js";`;
  if (!next.includes("preparedChatResponse,")) {
    next = replaceRegexRequired(
      next,
      /import originalWorker, \{ SessionMemory \} from "\.\/index\.js";/,
      expandedImport,
      "paid-worker core import",
    );
  }

  const preparationHelper = `function chatPreparationOptions(env) {
  const choices = modelChoices(env);
  const defaultModel = String(env.OPENAI_MODEL || "gpt-5.4");
  const fallbackModel = String(
    env.FREE_PLAN_FALLBACK_MODEL || defaultModel || "gpt-5.4",
  );
  const freeModel = String(
    env.FREE_PLAN_PRIMARY_MODEL || "gpt-5.6-sol",
  );
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
  if (!next.includes("function chatPreparationOptions(env)")) {
    next = replaceRequired(
      next,
      "function billingNotice(url, reconciled) {",
      preparationHelper + "function billingNotice(url, reconciled) {",
      "billing notice helper",
    );
  }

  const paidChatFunction = `async function paidChatResponse(request, env, ctx) {
  if (request.method !== "POST") return originalWorker.fetch(request, env, ctx);
  const authSession = await readAuthSession(request, env);
  if (!authSession) return originalWorker.fetch(request, env, ctx);

  const stub = billingStub(env, authSession.accountKey);
  if (!stub || typeof stub.prepareChat !== "function") {
    return originalWorker.fetch(request, env, ctx);
  }

  const fallbackRequest = request.clone();
  let body;
  try {
    body = await readBoundedJson(request);
  } catch {
    return originalWorker.fetch(fallbackRequest, env, ctx);
  }

  const memoryStub = body?.privateChat === true
    ? null
    : accountMemoryStub(env, authSession.accountKey);
  const [preparation, memory] = await Promise.all([
    stub.prepareChat(chatPreparationOptions(env)),
    readMemoryContext(memoryStub),
  ]);

  if (!preparation?.allowed) {
    return jsonResponse(
      {
        error:
          preparation?.reason === "inactive"
            ? "The selected model requires an active subscription."
            : "The monthly subscriber model-message limit has been reached. Choose GPT-5.4 or manage billing.",
      },
      preparation?.reason === "inactive" ? 403 : 429,
    );
  }

  if (preparation.paid !== true) body.reasoningEffort = "none";
  const selectedEnv = modelEnvironment(env, preparation.model);
  const response = await preparedChatResponse(
    request,
    body,
    selectedEnv,
    ctx,
    authSession.accountKey,
    body?.privateChat === true ? emptyMemoryContext() : memory,
  );

  if (
    preparation.reservationMade &&
    (await shouldRefundModelUsage(response))
  ) {
    await stub.refundUsage(preparation.tier, preparation.period);
    return response;
  }

  if (!preparation.tier) return response;
  return responseWithModelUsage(response, {
    tier: preparation.tier,
    used: preparation.used,
    limit: preparation.limit,
    period: preparation.period,
    model: preparation.model,
    fallback: preparation.fallback,
  });
}

`;
  if (!next.includes("stub.prepareChat(chatPreparationOptions(env))")) {
    next = replaceRegexRequired(
      next,
      /async function paidChatResponse\(request, env, ctx\) \{[\s\S]*?\n\}\n\n\n(?=function responseWithModelUsage)/,
      paidChatFunction,
      "paid chat response",
    );
  }

  return next;
});

await update("public/app.js", (source) => {
  let next = source.replaceAll(
    "20260806-static-mobile-background-1",
    ASSET_VERSION,
  );

  const streamingRenderer = `let streamingRenderHandle = 0;
let streamingRenderUsesAnimationFrame = false;
let queuedStreamingArticle = null;
let queuedStreamingContent = "";

function cancelStreamingOutputRender() {
  if (!streamingRenderHandle) return;
  if (
    streamingRenderUsesAnimationFrame &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(streamingRenderHandle);
  } else {
    window.clearTimeout(streamingRenderHandle);
  }
  streamingRenderHandle = 0;
  streamingRenderUsesAnimationFrame = false;
  queuedStreamingArticle = null;
  queuedStreamingContent = "";
}

function flushStreamingOutput() {
  const article = queuedStreamingArticle;
  const content = queuedStreamingContent;
  streamingRenderHandle = 0;
  streamingRenderUsesAnimationFrame = false;
  queuedStreamingArticle = null;

  if (!(article instanceof HTMLElement)) return;
  article.className = "assistant-output streaming-output";
  article.setAttribute("aria-label", "Stabilize");
  let text = article.querySelector(".streaming-text");
  if (!(text instanceof HTMLElement)) {
    text = document.createElement("div");
    text.className = "streaming-text";
    article.replaceChildren(text);
  }
  text.textContent = content || pendingReplyCopy();
  chatLog.hidden = false;
  chatLog.tabIndex = 0;
  conversationSurface.dataset.view = "response";
  scrollConversationToLatest();
}

function renderStreamingOutput(article, content) {
  queuedStreamingArticle = article;
  queuedStreamingContent = String(content || "");
  if (streamingRenderHandle) return;

  if (typeof window.requestAnimationFrame === "function") {
    streamingRenderUsesAnimationFrame = true;
    streamingRenderHandle = window.requestAnimationFrame(flushStreamingOutput);
  } else {
    streamingRenderUsesAnimationFrame = false;
    streamingRenderHandle = window.setTimeout(flushStreamingOutput, 0);
  }
}

`;
  if (!next.includes("let streamingRenderHandle = 0;")) {
    next = replaceRegexRequired(
      next,
      /function renderStreamingOutput\(article, content\) \{[\s\S]*?\n\}\n\n(?=async function readStreamingResponse)/,
      streamingRenderer,
      "streaming response renderer",
    );
  }

  if (!next.includes("cancelStreamingOutputRender();\n  article.className = \"assistant-output\";")) {
    next = replaceRequired(
      next,
      `function finalizeStreamingOutput(article, reply, route, offerOutcomeCheck) {
  article.className = "assistant-output";`,
      `function finalizeStreamingOutput(article, reply, route, offerOutcomeCheck) {
  cancelStreamingOutputRender();
  article.className = "assistant-output";`,
      "stream finalizer",
    );
  }

  if (!next.includes("  } catch (error) {\n    cancelStreamingOutputRender();")) {
    next = replaceRequired(
      next,
      `  } catch (error) {
    rollbackPrivateUser(clean);`,
      `  } catch (error) {
    cancelStreamingOutputRender();
    rollbackPrivateUser(clean);`,
      "stream error cleanup",
    );
  }

  return next;
});

await update("public/styles.css", (source) => {
  if (source.includes(".streaming-text{")) return source;
  return `${source.trimEnd()}\n\n.streaming-text{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}\n`;
});

await update("src/page.js", (source) => {
  let next = source.replaceAll(
    "20260806-static-mobile-background-1",
    ASSET_VERSION,
  );
  next = next.replace(
    'href="/styles.css"',
    `href="/styles.css?v=${ASSET_VERSION}"`,
  );
  return next;
});

await update("wrangler.jsonc", (source) => {
  const config = JSON.parse(source);
  config.vars.OPENAI_SERVICE_TIER = "fast";
  return JSON.stringify(config, null, 2) + "\n";
});

await update("test/streaming-response.test.mjs", (source) => {
  let next = source;
  next = replaceRegexRequired(
    next,
    /  assert\.equal\(\n    \(workerSource\.match\(\/max_output_tokens: 500\/g\) \|\| \[\]\)\.length,\n    2,\n  \);/,
    `  assert.match(workerSource, /ORDINARY_OUTPUT_TOKEN_LIMIT = 360/);
  assert.match(workerSource, /LONG_FORM_OUTPUT_TOKEN_LIMIT = 900/);
  assert.match(workerSource, /service_tier: serviceTier/);
  assert.match(workerSource, /text: \\{ verbosity: "low" \\}/);`,
    "streaming output-token assertion",
  );
  next = replaceRequired(
    next,
    "  assert.match(clientSource, /renderStreamingOutput\\(article, accumulated\\)/);",
    `  assert.match(clientSource, /renderStreamingOutput\\(article, accumulated\\)/);
  assert.match(clientSource, /requestAnimationFrame\\(flushStreamingOutput\\)/);
  assert.match(clientSource, /text\\.textContent = content/);
  assert.doesNotMatch(
    clientSource,
    /function renderStreamingOutput[\\s\\S]*renderMarkdown\\(content/,
  );`,
    "streaming client assertion",
  );
  return next;
});

for (const entry of await readdir("test", { withFileTypes: true })) {
  if (!entry.isFile() || extname(entry.name) !== ".mjs") continue;
  const path = join("test", entry.name);
  await update(path, (source) =>
    source.replaceAll("20260806-static-mobile-background-1", ASSET_VERSION),
  );
}

await update("package.json", (source) => {
  const packageJson = JSON.parse(source);
  const policyScript = "node scripts/apply-priority-latency.mjs";
  if (!packageJson.scripts["apply:prompt-policy"].includes(policyScript)) {
    packageJson.scripts["apply:prompt-policy"] += ` && ${policyScript}`;
  }
  for (const [scriptName, testPath] of [
    ["test:node", "test/priority-latency.test.mjs"],
    ["test:worker", "test/priority-latency-worker.test.mjs"],
  ]) {
    if (!packageJson.scripts[scriptName].includes(testPath)) {
      packageJson.scripts[scriptName] += ` ${testPath}`;
    }
  }
  return JSON.stringify(packageJson, null, 2) + "\n";
});

console.log(
  "Applied Fast mode, explicit prompt caching, parallel chat preparation, bounded output, and frame-throttled streaming.",
);

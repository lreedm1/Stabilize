import { readFile, writeFile } from "node:fs/promises";

const FREE_PRIMARY_MODEL = "gpt-5.6-sol";
const FREE_FALLBACK_MODEL = "gpt-5.4";
const FREE_DAILY_LIMIT = 50;
const BILLING_ASSET_VERSION = "20260807-free-gpt56-first-50-1";

async function update(path, transform, { optional = false } = {}) {
  let before;
  try {
    before = await readFile(path, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return;
    throw error;
  }
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Free GPT-5.6 policy could not find ${label}`);
  }
}

function replaceBlock(value, startMarker, endMarker, replacement, label) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Free GPT-5.6 policy could not replace ${label}`);
  }
  return value.slice(0, start) + replacement + value.slice(end);
}

await update("wrangler.jsonc", (source) => {
  const config = JSON.parse(source);
  config.vars ||= {};
  config.vars.OPENAI_MODEL = FREE_FALLBACK_MODEL;
  config.vars.OPENAI_REASONING_EFFORT = "none";
  config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT = String(FREE_DAILY_LIMIT);
  config.vars.FREE_PLAN_PRIMARY_MODEL = FREE_PRIMARY_MODEL;
  config.vars.FREE_PLAN_FALLBACK_MODEL = FREE_FALLBACK_MODEL;
  return `${JSON.stringify(config, null, 2)}\n`;
});

await update("src/billing.js", (source) => {
  const helper = `export function freeDailyModelMessageLimit(env = {}) {
  const parsed = Number(
    env.FREE_DAILY_MODEL_MESSAGE_LIMIT || ${FREE_DAILY_LIMIT},
  );
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return ${FREE_DAILY_LIMIT};
  }
  return Math.min(parsed, 1_000);
}

`;
  const text = replaceBlock(
    source,
    "export function freeDailyModelMessageLimit(",
    "export function dailyUsagePeriod(",
    helper,
    "the free daily limit helper",
  );
  requireText(
    text,
    `env.FREE_DAILY_MODEL_MESSAGE_LIMIT || ${FREE_DAILY_LIMIT}`,
    "the 50-message default",
  );
  return text;
});

await update("src/paid-worker.js", (source) => {
  let text = source
    .replace(
      /\/billing-client\.js\?v=[A-Za-z0-9._-]+/g,
      `/billing-client.js?v=${BILLING_ASSET_VERSION}`,
    )
    .replace(
      /\/billing\.css\?v=[A-Za-z0-9._-]+/g,
      `/billing.css?v=${BILLING_ASSET_VERSION}`,
    );

  const billingNotice = `function billingNotice(url, reconciled) {
  const state = url.searchParams.get("billing");
  if (state === "success") {
    return reconciled
      ? "Payment confirmed. Your larger model allowance is active."
      : "Payment is being confirmed. Refresh shortly if the larger allowance is not active yet.";
  }
  if (state === "cancelled") {
    return "Checkout was cancelled. Your free GPT-5.6 allowance is unchanged.";
  }
  if (state === "error") {
    return "Billing could not complete that request. Try again from the model menu.";
  }
  if (url.searchParams.get("model") === "automatic") {
    return "Free accounts use GPT-5.6 Instant automatically, then GPT-5.4 after the daily allowance.";
  }
  if (url.searchParams.get("model") === "saved") {
    return "Your AI model choice was saved.";
  }
  if (url.searchParams.get("model") === "limit") {
    return "That subscriber model allowance has been reached. Choose GPT-5.4 or manage billing.";
  }
  return "";
}

`;
  text = replaceBlock(
    text,
    "function billingNotice(",
    "function modelChoiceState(",
    billingNotice,
    "the model notice copy",
  );

  const modelChoiceState = `function modelChoiceState(state, choices, defaultModel) {
  const choiceEnvironment = {
    MODEL_CHOICES: choices
      .map((choice) => choice.id + "|" + choice.label)
      .join(","),
    OPENAI_MODEL: defaultModel,
  };
  const paid = state.entitled === true;
  const automaticFreeModel = choices.some(
    (choice) => choice.id === "${FREE_PRIMARY_MODEL}",
  )
    ? "${FREE_PRIMARY_MODEL}"
    : defaultModel;
  const selected = paid
    ? isAllowedModel(choiceEnvironment, state.selectedModel)
      ? state.selectedModel
      : defaultModel
    : automaticFreeModel;
  const selectedChoice = choices.find((choice) => choice.id === selected);
  const currentLabel = paid
    ? selectedChoice?.label || "Stabilize default"
    : "GPT-5.6 Instant";
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
  text = replaceBlock(
    text,
    "function modelChoiceState(",
    "function modelOptionsMarkup(",
    modelChoiceState,
    "the automatic free-model state",
  );

  const modelUsageCopy = `function modelUsageCopy({ paid, used, freeLimit, paidLimit }) {
  return paid
    ? used +
        " of " +
        paidLimit +
        " subscriber model messages used this UTC month. GPT-5.4 does not count."
    : used +
        " of " +
        freeLimit +
        " free GPT-5.6 Instant messages used today. Stabilize switches to GPT-5.4 after this allowance; it resets at 00:00 UTC.";
}

`;
  text = replaceBlock(
    text,
    "function modelUsageCopy(",
    "function billingMenuMarkup(",
    modelUsageCopy,
    "the model-usage copy",
  );

  const billingMenuMarkup = `function billingMenuMarkup({
  signedIn,
  configured,
  state,
  choices,
  defaultModel,
  freeLimit,
  paidLimit,
}) {
  if (!signedIn) {
    return '<section class="billing-menu" aria-labelledby="billing-heading">' +
      '<h2 id="billing-heading">AI model</h2>' +
      "<p>Sign in for " +
      freeLimit +
      " GPT-5.6 Instant messages each day, then GPT-5.4 automatically.</p>" +
      '<a class="billing-primary billing-link" href="/auth/google">Sign in</a>' +
      "</section>";
  }

  const choice = modelChoiceState(state, choices, defaultModel);
  const usage = modelUsageCopy({
    paid: choice.paid,
    used: choice.used,
    freeLimit,
    paidLimit,
  });
  const upgrade = !choice.paid && configured
    ? '<form action="/billing/checkout" method="post" data-billing-redirect="checkout">' +
        '<button class="billing-secondary" type="submit">Upgrade model allowance</button>' +
        "</form>"
    : "";
  const manage = configured && state.customerId
    ? '<form action="/billing/portal" method="post" data-billing-redirect="portal">' +
        '<button class="billing-secondary" type="submit">Manage billing</button>' +
        "</form>"
    : "";

  if (!choice.paid) {
    return '<section class="billing-menu" aria-labelledby="billing-heading">' +
      '<h2 id="billing-heading">AI model</h2>' +
      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +
      '<p class="billing-usage" data-model-usage="true" aria-live="polite">' +
      escapeHtml(usage) +
      "</p>" +
      upgrade +
      manage +
      "</section>";
  }

  const options = modelOptionsMarkup(choices, choice.selected);
  return '<section class="billing-menu" aria-labelledby="billing-heading">' +
    '<h2 id="billing-heading">AI model</h2>' +
    '<form action="/account/model" method="post" class="model-choice-form">' +
    '<label for="model-choice">Choose model</label>' +
    '<select id="model-choice" name="model">' +
    options +
    "</select>" +
    '<button class="billing-primary" type="submit">Save model</button>' +
    "</form>" +
    '<p class="billing-usage" data-model-usage="true" aria-live="polite">' +
    escapeHtml(usage) +
    "</p>" +
    manage +
    "</section>";
}

`;
  text = replaceBlock(
    text,
    "function billingMenuMarkup(",
    "function compactModelTileLabel(",
    billingMenuMarkup,
    "the free and subscriber model menu",
  );

  const composerModelPickerMarkup = `function composerModelPickerMarkup({
  signedIn,
  configured,
  state,
  choices,
  defaultModel,
  freeLimit,
  paidLimit,
}) {
  const choice = modelChoiceState(state, choices, defaultModel);
  const buttonLabel = compactModelTileLabel(choice.selected);
  let modelPanel = "";

  if (!signedIn) {
    modelPanel =
      "<p>Sign in for " +
      freeLimit +
      " GPT-5.6 Instant messages each day, then GPT-5.4 automatically.</p>" +
      '<a class="billing-primary billing-link" href="/auth/google">Sign in</a>';
  } else if (!choice.paid) {
    const usage = modelUsageCopy({
      paid: false,
      used: choice.used,
      freeLimit,
      paidLimit,
    });
    const upgrade = configured
      ? '<form action="/billing/checkout" method="post" data-billing-redirect="checkout">' +
          '<button class="billing-secondary" type="submit">Upgrade allowance</button>' +
          "</form>"
      : "";
    modelPanel =
      "<p>GPT-5.6 Instant is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>" +
      '<p class="billing-usage" data-model-usage="true" aria-live="polite">' +
      escapeHtml(usage) +
      "</p>" +
      upgrade;
  } else {
    const options = modelOptionsMarkup(choices, choice.selected);
    const usage = modelUsageCopy({
      paid: true,
      used: choice.used,
      freeLimit,
      paidLimit,
    });
    modelPanel =
      '<form action="/account/model" method="post" class="model-choice-form composer-model-form">' +
      '<label for="composer-model-choice">Choose model</label>' +
      '<select id="composer-model-choice" name="model">' +
      options +
      "</select>" +
      '<button class="billing-primary" type="submit">Use model</button>' +
      "</form>" +
      '<p class="billing-usage" data-model-usage="true" aria-live="polite">' +
      escapeHtml(usage) +
      "</p>";
  }

  const newChatNote = signedIn
    ? "Starts a fresh conversation with your optional Stabilize memory available."
    : "Starts a fresh guest conversation.";
  const privateChatNote = signedIn
    ? "Starts fresh without reading or updating your Stabilize memory."
    : "Guest chats already do not use Stabilize account memory.";

  return (
    '<details class="composer-model-picker composer-quick-menu">' +
    '<summary class="composer-model-button" aria-label="Open model and chat controls. Current model: ' +
    escapeHtml(choice.currentLabel) +
    '">' +
    '<span class="composer-model-kicker">Model</span>' +
    '<span class="composer-model-current">' +
    escapeHtml(buttonLabel) +
    "</span>" +
    "</summary>" +
    '<div class="composer-model-panel composer-quick-panel" role="group" aria-label="Model and chat controls">' +
    "<h2>Chat controls</h2>" +
    '<section class="composer-quick-section composer-quick-model" aria-labelledby="composer-quick-model-heading">' +
    '<h3 id="composer-quick-model-heading">Model</h3>' +
    modelPanel +
    "</section>" +
    '<section class="composer-quick-section" aria-labelledby="composer-quick-new-heading">' +
    '<h3 id="composer-quick-new-heading">New chat</h3>' +
    "<p>" +
    escapeHtml(newChatNote) +
    "</p>" +
    '<button class="composer-quick-action" type="button" data-composer-new-chat>New chat</button>' +
    "</section>" +
    '<section class="composer-quick-section" aria-labelledby="composer-quick-private-heading">' +
    '<h3 id="composer-quick-private-heading">New private chat</h3>' +
    "<p>" +
    escapeHtml(privateChatNote) +
    "</p>" +
    '<button class="composer-quick-action composer-quick-private-action" type="button" data-composer-new-private-chat>New private chat</button>' +
    "</section>" +
    '<p class="composer-quick-status" data-composer-quick-status role="status" aria-live="polite" hidden></p>' +
    "</div>" +
    "</details>"
  );
}`;
  text = replaceBlock(
    text,
    "function composerModelPickerMarkup({",
    "\n\nasync function injectBillingPage(",
    composerModelPickerMarkup,
    "the automatic free-model composer menu",
  );

  const modelChoiceResponse = `async function modelChoiceResponse(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!sameOriginOrNonBrowser(request)) {
    return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  }
  const authSession = await readAuthSession(request, env);
  if (!authSession) return redirect("/auth/google", 303);
  const form = await request.formData();
  const model = String(form.get("model") || "").trim();
  if (!isAllowedModel(env, model)) return redirect("/?billing=error", 303);
  const stub = billingStub(env, authSession.accountKey);
  const state = await readBillingState(stub);
  if (!state.entitled) return redirect("/?model=automatic", 303);
  await stub.setSelectedModel(model);
  return redirect("/?model=saved", 303);
}

`;
  text = replaceBlock(
    text,
    "async function modelChoiceResponse(",
    "async function webhookResponse(",
    modelChoiceResponse,
    "the subscriber-only manual model selection route",
  );

  const chatPolicy = `async function shouldRefundModelUsage(response) {
  if (!response.ok) return true;
  const contentType = (response.headers.get("content-type") || "")
    .toLowerCase();
  if (!contentType.includes("application/json")) return false;
  try {
    const result = await response.clone().json();
    return Boolean(fixedReplyForRoute(result?.route));
  } catch {
    return false;
  }
}

function responseWithModelUsage(
  response,
  { tier, used, limit, period, model, fallback = false },
) {
  const headers = new Headers(response.headers);
  headers.set("X-Stabilize-Model-Usage-Tier", tier);
  headers.set("X-Stabilize-Model-Usage-Used", String(used));
  headers.set("X-Stabilize-Model-Usage-Limit", String(limit));
  headers.set("X-Stabilize-Model-Usage-Period", period);
  headers.set("X-Stabilize-Model-Selected", model);
  if (fallback) headers.set("X-Stabilize-Model-Fallback", "daily-limit");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function paidChatResponse(request, env, ctx) {
  if (request.method !== "POST") return originalWorker.fetch(request, env, ctx);
  const authSession = await readAuthSession(request, env);
  if (!authSession) return originalWorker.fetch(request, env, ctx);

  const stub = billingStub(env, authSession.accountKey);
  const state = await readBillingState(stub);
  const defaultModel = String(env.OPENAI_MODEL || "${FREE_FALLBACK_MODEL}");
  const fallbackModel = String(
    env.FREE_PLAN_FALLBACK_MODEL || defaultModel || "${FREE_FALLBACK_MODEL}",
  );
  const freeModel = String(
    env.FREE_PLAN_PRIMARY_MODEL || "${FREE_PRIMARY_MODEL}",
  );

  if (state.entitled === true) {
    const selectedModel = isAllowedModel(env, state.selectedModel)
      ? state.selectedModel
      : defaultModel;
    if (selectedModel === defaultModel) {
      return originalWorker.fetch(request, env, ctx);
    }

    const tier = "paid";
    const period = usagePeriod();
    const limit = monthlyModelMessageLimit(env);
    const reservation = await stub.reserveUsage(tier, period, limit);
    if (!reservation.allowed) {
      return jsonResponse(
        {
          error:
            "The monthly subscriber model-message limit has been reached. Choose GPT-5.4 or manage billing.",
        },
        429,
      );
    }

    const response = await originalWorker.fetch(
      request,
      modelEnvironment(env, selectedModel),
      ctx,
    );
    if (await shouldRefundModelUsage(response)) {
      await stub.refundUsage(tier, period);
      return response;
    }
    return responseWithModelUsage(response, {
      tier,
      used: reservation.used,
      limit,
      period,
      model: selectedModel,
    });
  }

  const tier = "free";
  const period = dailyUsagePeriod();
  const limit = freeDailyModelMessageLimit(env);
  const reservation = await stub.reserveUsage(tier, period, limit);

  if (!reservation.allowed) {
    const response = await originalWorker.fetch(
      request,
      modelEnvironment(env, fallbackModel),
      ctx,
    );
    return responseWithModelUsage(response, {
      tier,
      used: limit,
      limit,
      period,
      model: fallbackModel,
      fallback: true,
    });
  }

  const response = await originalWorker.fetch(
    request,
    modelEnvironment(env, freeModel),
    ctx,
  );
  if (await shouldRefundModelUsage(response)) {
    await stub.refundUsage(tier, period);
    return response;
  }
  return responseWithModelUsage(response, {
    tier,
    used: reservation.used,
    limit,
    period,
    model: freeModel,
  });
}

`;
  text = replaceBlock(
    text,
    "async function paidChatResponse(",
    "const worker =",
    chatPolicy,
    "the free GPT-5.6 to GPT-5.4 chat ladder",
  );

  for (const expected of [
    `FREE_PLAN_PRIMARY_MODEL || "${FREE_PRIMARY_MODEL}"`,
    `FREE_PLAN_FALLBACK_MODEL || defaultModel`,
    "GPT-5.6 Instant is automatic",
    "if (!state.entitled) return redirect(\"/?model=automatic\", 303)",
    'const tier = "free"',
    "X-Stabilize-Model-Fallback",
    `/billing-client.js?v=${BILLING_ASSET_VERSION}`,
  ]) {
    requireText(text, expected, expected);
  }
  return text;
});

console.log(
  "Applied the free GPT-5.6-to-GPT-5.4 routing policy.",
);

import originalWorker, {
  SessionMemory,
  accountMemoryStub,
  emptyMemoryContext,
  preparedChatResponse,
  readBoundedJson,
  readMemoryContext,
} from "./index.js";
import { readAuthSession } from "./auth.js";
import { fixedReplyForRoute } from "./safety.js";
import { BillingAccount } from "./billing-account.js";
import {
  BillingConfigurationError,
  BillingRequestError,
  createCheckoutSession,
  createPortalSession,
  dailyUsagePeriod,
  freeDailyModelMessageLimit,
  isAllowedModel,
  modelChoices,
  monthlyModelMessageLimit,
  readStripeWebhook,
  reconcileCheckoutSession,
  stateFromStripeEvent,
  stripeConfigured,
  usagePeriod,
} from "./billing.js";

export { SessionMemory, BillingAccount };

const ACCOUNT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function apiHeaders(extra = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: apiHeaders(extraHeaders),
  });
}

function redirect(location, status = 303) {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Location: location,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function wantsJson(request) {
  return (request.headers.get("accept") || "")
    .toLowerCase()
    .includes("application/json");
}

function billingNavigationResponse(request, url) {
  return wantsJson(request) ? jsonResponse({ url }) : redirect(url, 303);
}

function signedOutBillingResponse(request) {
  return wantsJson(request)
    ? jsonResponse(
        { error: "Sign in to unlock model choice.", signInUrl: "/auth/google" },
        401,
      )
    : redirect("/auth/google", 303);
}

function sameOriginOrNonBrowser(request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = String(request.headers.get("origin") || "").trim();
  const fetchSite = String(request.headers.get("sec-fetch-site") || "")
    .trim()
    .toLowerCase();

  if (origin && origin !== "null" && origin !== requestOrigin) return false;
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) return false;
  return true;
}

function billingStub(env, accountKey) {
  if (!ACCOUNT_KEY_PATTERN.test(String(accountKey || ""))) return null;
  if (!env?.BILLING || typeof env.BILLING.getByName !== "function") return null;
  return env.BILLING.getByName("google:" + accountKey);
}

function emptyBillingState() {
  return {
    customerId: null,
    subscriptionId: null,
    subscriptionStatus: "none",
    entitled: false,
    selectedModel: null,
    usagePeriod: null,
    usageCount: 0,
    paidUsagePeriod: null,
    paidUsageCount: 0,
    freeUsagePeriod: null,
    freeUsageCount: 0,
    updatedAt: null,
  };
}

async function readBillingState(stub) {
  if (!stub || typeof stub.readState !== "function") return emptyBillingState();
  try {
    return await stub.readState();
  } catch (error) {
    console.error(JSON.stringify({
      event: "billing_state_read_failed",
      error: error instanceof Error ? error.name : "UnknownError",
    }));
    return emptyBillingState();
  }
}

async function updateBillingState(stub, state) {
  if (!stub || typeof stub.updateBilling !== "function" || !state) return null;
  try {
    return await stub.updateBilling(state);
  } catch (error) {
    console.error(JSON.stringify({
      event: "billing_state_write_failed",
      error: error instanceof Error ? error.name : "UnknownError",
    }));
    return null;
  }
}

function modelEnvironment(env, model) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "OPENAI_MODEL") return model;
      return Reflect.get(target, property, receiver);
    },
  });
}

function chatPreparationOptions(env, body = {}) {
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

function billingNotice(url, reconciled) {
  const state = url.searchParams.get("billing");
  if (state === "success") {
    return reconciled
      ? "Payment confirmed. Your larger model allowance is active."
      : "Payment is being confirmed. Refresh shortly if the larger allowance is not active yet.";
  }
  if (state === "cancelled") {
    return "Checkout was cancelled. Your free GPT-5.6 Fast allowance is unchanged.";
  }
  if (state === "error") {
    return "Billing could not complete that request. Try again from the model menu.";
  }
  if (url.searchParams.get("model") === "automatic") {
    return "Guest and signed-in Fastest responses begin on GPT-5.6 Fast. Signed-in accounts switch to GPT-5.4 after the daily allowance.";
  }
  if (url.searchParams.get("model") === "limit") {
    return "That subscriber model allowance has been reached. Choose GPT-5.4 or manage billing.";
  }
  return "";
}

function modelChoiceState(state, choices, defaultModel) {
  const choiceEnvironment = {
    MODEL_CHOICES: choices
      .map((choice) => choice.id + "|" + choice.label)
      .join(","),
    OPENAI_MODEL: defaultModel,
  };
  const paid = state.entitled === true;
  const automaticFreeModel = choices.some(
    (choice) => choice.id === "gpt-5.6-sol",
  )
    ? "gpt-5.6-sol"
    : defaultModel;
  const selected = paid
    ? isAllowedModel(choiceEnvironment, state.selectedModel)
      ? state.selectedModel
      : defaultModel
    : automaticFreeModel;
  const selectedChoice = choices.find((choice) => choice.id === selected);
  const currentLabel = paid
    ? selectedChoice?.label || "GPT-5.4"
    : "GPT-5.6 Fast";
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

function modelOptionsMarkup(choices, selected) {
  return choices
    .map(
      (choice) =>
        '<option value="' +
        escapeHtml(choice.id) +
        '"' +
        (choice.id === selected ? " selected" : "") +
        ">" +
        escapeHtml(choice.label) +
        "</option>",
    )
    .join("");
}

function modelUsageCopy({ paid, used, freeLimit, paidLimit }) {
  return paid
    ? used +
        " of " +
        paidLimit +
        " subscriber model messages used this UTC month. GPT-5.4 does not count."
    : used +
        " of " +
        freeLimit +
        " free GPT-5.6 Fast messages used today. GPT-5.4 takes over after this allowance. The allowance resets at 00:00 UTC.";
}

function billingMenuMarkup({
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
      " GPT-5.6 Fast messages each UTC day before GPT-5.4 fallback. Guest chats also begin on GPT-5.6 Fast.</p>" +
      '<a class="billing-primary billing-link" href="/auth/google">Sign in to choose a model</a>' +
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
      "<p>GPT-5.6 Fast is automatic for the first " +
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

function compactModelTileLabel(model) {
  const value = String(model || "").toLowerCase();
  if (value === "gpt-5-mini") return "5 mini";
  const match = value.match(/^gpt-(\d+(?:\.\d+)?)/);
  return match?.[1] || "5.x";
}

function composerModelPickerMarkup({
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
      " GPT-5.6 Fast messages each UTC day before GPT-5.4 fallback. Guest chats also begin on GPT-5.6 Fast.</p>" +
      '<a class="billing-primary billing-link" href="/auth/google">Sign in to choose a model</a>';
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
      "<p>GPT-5.6 Fast is automatic for the first " +
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
    '<details class="composer-model-picker">' +
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
}

async function injectBillingPage(response, request, env, authSession, state, reconciled) {
  if (request.method === "HEAD" || !response.ok) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const choices = modelChoices(env);
  const defaultModel = String(
    env.OPENAI_MODEL || choices[0]?.id || "gpt-5.4",
  );
  const configured = stripeConfigured(env);
  const freeLimit = freeDailyModelMessageLimit(env);
  const paidLimit = monthlyModelMessageLimit(env);
  const markup = "";
  const composerModelPicker = composerModelPickerMarkup({
    signedIn: Boolean(authSession),
    configured,
    state,
    choices,
    defaultModel,
    freeLimit,
    paidLimit,
  });
  const url = new URL(request.url);
  const notice = billingNotice(url, reconciled);
  let html = await response.text();

  if (!html.includes('href="/billing.css')) {
    html = html.replace(
      "</head>",
      '    <link rel="stylesheet" href="/billing.css?v=20260807-free-gpt56-first-50-1" />\n  </head>',
    );
  } else {
    html = html.replace(
      /href="\/billing\.css(?:\?v=[^"]*)?"/,
      'href="/billing.css?v=20260807-free-gpt56-first-50-1"',
    );
  }
  if (markup) {
    html = html.replace(
      /(<div class="menu-account"[\s\S]*?<\/div>)(\s*<\/div>\s*<\/details>)/,
      `$1${markup}$2`,
    );
  }
  if (composerModelPicker) {
    html = html.replace(
      /<form id="chat-form" class="chat-form">[\s\S]*?<\/form>/,
      (chatForm) =>
        '<div class="composer-entry-row">' +
        composerModelPicker +
        chatForm +
        "</div>",
    );
  }
  if ((markup || composerModelPicker) && !html.includes('src="/billing-client.js')) {
    html = html.replace(
      "</body>",
      '    <script type="module" src="/billing-client.js?v=20260808-gpt56-fast-first-1"></script>\n  </body>',
    );
  }
  if (notice) {
    html = html.replace(
      '<main class="chat-card"',
      `<p class="billing-notice" role="status">${escapeHtml(notice)}</p>\n      <main class="chat-card"`,
    );
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function rootResponse(request, env, ctx) {
  const authSession = await readAuthSession(request, env);
  const stub = billingStub(env, authSession?.accountKey);
  let state = await readBillingState(stub);
  if (authSession) {
    const memoryWarmup = readMemoryContext(
      accountMemoryStub(env, authSession.accountKey),
    );
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(memoryWarmup);
    else void memoryWarmup;
  }
  let reconciled = false;
  const url = new URL(request.url);

  if (
    authSession &&
    stripeConfigured(env) &&
    url.searchParams.get("billing") === "success"
  ) {
    try {
      const update = await reconcileCheckoutSession(
        env,
        url.searchParams.get("session_id"),
        authSession.accountKey,
      );
      if (update) {
        const stored = await updateBillingState(stub, update);
        if (stored) state = stored;
        reconciled = Boolean(stored?.entitled);
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: "billing_checkout_reconcile_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }));
    }
  }

  const response = await originalWorker.fetch(request, env, ctx);
  return injectBillingPage(response, request, env, authSession, state, reconciled);
}

async function checkoutResponse(request, env) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!sameOriginOrNonBrowser(request)) return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  const authSession = await readAuthSession(request, env);
  if (!authSession) return signedOutBillingResponse(request);
  const stub = billingStub(env, authSession.accountKey);
  const state = await readBillingState(stub);
  const url = state.entitled && state.customerId
    ? await createPortalSession(env, state)
    : await createCheckoutSession(env, state, authSession.accountKey);
  return billingNavigationResponse(request, url);
}

async function portalResponse(request, env) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!sameOriginOrNonBrowser(request)) return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  const authSession = await readAuthSession(request, env);
  if (!authSession) return redirect("/auth/google", 303);
  const state = await readBillingState(billingStub(env, authSession.accountKey));
  const url = await createPortalSession(env, state);
  return billingNavigationResponse(request, url);
}

async function modelChoiceResponse(request, env) {
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
  await stub.setSelectedModel(model);
  return redirect("/?model=saved", 303);
}

async function webhookResponse(request, env) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  const event = await readStripeWebhook(request, env);
  const update = stateFromStripeEvent(event);
  if (update) {
    await updateBillingState(billingStub(env, update.accountKey), update);
  }
  return jsonResponse({ received: true });
}

async function shouldRefundModelUsage(response) {
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

async function paidChatResponse(request, env, ctx) {
  if (request.method !== "POST") return originalWorker.fetch(request, env, ctx);
  const requestStartedAt = Date.now();
  const authStartedAt = Date.now();
  const authSession = await readAuthSession(request, env);
  const authMs = Date.now() - authStartedAt;
  if (!authSession) {
    return originalWorker.fetch(
      request,
      modelEnvironment(
        env,
        String(env.FREE_PLAN_PRIMARY_MODEL || "gpt-5.6-sol"),
      ),
      ctx,
    );
  }

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

  const defaultModel = String(env.OPENAI_MODEL || "gpt-5.4");
  if (preparation.paid !== true && preparation.model === defaultModel) {
    body.reasoningEffort = "none";
  }
  const selectedEnv = modelEnvironment(env, preparation.model);
  let response = await preparedChatResponse(
    request,
    body,
    selectedEnv,
    ctx,
    authSession.accountKey,
    body?.privateChat === true ? emptyMemoryContext() : memory,
  );
  response = responseWithPreparationTiming(response, {
    authMs,
    billingMs: billingResult.durationMs,
    memoryMs: memoryResult.durationMs,
    preparationMs,
    model: preparation.model,
  });

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

function responseWithPreparationTiming(
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

async function requestWithReasoningEffort(request, effort) {
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request, {
    headers,
    body: JSON.stringify({ ...body, reasoningEffort: effort }),
  });
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return await rootResponse(request, env, ctx);
      }
      if (url.pathname === "/billing/checkout") {
        return await checkoutResponse(request, env);
      }
      if (url.pathname === "/billing/portal") {
        return await portalResponse(request, env);
      }
      if (url.pathname === "/account/model") {
        return await modelChoiceResponse(request, env);
      }
      if (url.pathname === "/api/stripe/webhook") {
        return await webhookResponse(request, env);
      }
      if (url.pathname === "/api/chat") {
        return await paidChatResponse(request, env, ctx);
      }
      return await originalWorker.fetch(request, env, ctx);
    } catch (error) {
      if (error instanceof BillingConfigurationError) {
        return wantsJson(request)
          ? jsonResponse({ error: "Billing is not configured." }, 503)
          : redirect("/?billing=error", 303);
      }
      if (error instanceof BillingRequestError) {
        if (url.pathname === "/api/stripe/webhook") {
          return jsonResponse({ error: error.message }, error.status || 400);
        }
        return wantsJson(request)
          ? jsonResponse({ error: error.message }, error.status || 502)
          : redirect("/?billing=error", 303);
      }
      const reference = "BIL-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      console.error(JSON.stringify({
        event: "billing_request_failed",
        error: error instanceof Error ? error.name : "UnknownError",
        path: url.pathname,
        reference,
      }));
      return wantsJson(request)
        ? jsonResponse(
            { error: "Billing could not complete that request.", reference },
            503,
          )
        : redirect("/?billing=error", 303);
    }
  },
};

export default worker;

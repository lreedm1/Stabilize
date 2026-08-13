import { readFile, writeFile } from "node:fs/promises";

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Free daily model choice could not find ${label}`);
  }
}

function replaceBlock(value, startMarker, endMarker, replacement, label) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Free daily model choice could not replace ${label}`);
  }
  return value.slice(0, start) + replacement + value.slice(end);
}

const billingPath = "src/billing.js";
const billingBefore = await readFile(billingPath, "utf8");
let billingAfter = billingBefore;

if (!billingAfter.includes("export function freeDailyModelMessageLimit(")) {
  const anchor = "export function usagePeriod(now = new Date()) {";
  requireText(billingAfter, anchor, "the monthly usage-period helper");
  const helpers = `export function freeDailyModelMessageLimit(env = {}) {
  const parsed = Number(env.FREE_DAILY_MODEL_MESSAGE_LIMIT || 20);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 20;
  return Math.min(parsed, 1_000);
}

export function dailyUsagePeriod(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

`;
  billingAfter = billingAfter.replace(anchor, helpers + anchor);
}

requireText(
  billingAfter,
  "export function freeDailyModelMessageLimit(",
  "the free daily limit helper",
);
requireText(
  billingAfter,
  "export function dailyUsagePeriod(",
  "the UTC daily period helper",
);

if (billingAfter !== billingBefore) {
  await writeFile(billingPath, billingAfter);
}

const workerPath = "src/paid-worker.js";
const workerBefore = await readFile(workerPath, "utf8");
let workerAfter = workerBefore;

if (!workerAfter.includes("  dailyUsagePeriod,")) {
  const importAnchor = `  createCheckoutSession,
  createPortalSession,
  isAllowedModel,`;
  requireText(workerAfter, importAnchor, "the billing import anchor");
  workerAfter = workerAfter.replace(
    importAnchor,
    `  createCheckoutSession,
  createPortalSession,
  dailyUsagePeriod,
  freeDailyModelMessageLimit,
  isAllowedModel,`,
  );
}

const emptyState = `function emptyBillingState() {
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

`;
workerAfter = replaceBlock(
  workerAfter,
  "function emptyBillingState() {",
  "async function readBillingState(",
  emptyState,
  "the empty billing state",
);

const billingNotice = `function billingNotice(url, reconciled) {
  const state = url.searchParams.get("billing");
  if (state === "success") {
    return reconciled
      ? "Payment confirmed. Your larger model allowance is active."
      : "Payment is being confirmed. Refresh shortly if the larger allowance is not active yet.";
  }
  if (state === "cancelled") {
    return "Checkout was cancelled. Your free daily model allowance is unchanged.";
  }
  if (state === "error") {
    return "Billing could not complete that request. Try again from the model menu.";
  }
  if (url.searchParams.get("model") === "saved") {
    return "Your AI model choice was saved.";
  }
  if (url.searchParams.get("model") === "limit") {
    return "That model allowance has been reached. Choose the default model or upgrade the allowance.";
  }
  return "";
}

`;
workerAfter = replaceBlock(
  workerAfter,
  "function billingNotice(",
  "function billingMenuMarkup(",
  billingNotice,
  "the billing notice copy",
);

const pickerFunctions = `function modelChoiceState(state, choices, defaultModel) {
  const choiceEnvironment = {
    MODEL_CHOICES: choices
      .map((choice) => choice.id + "|" + choice.label)
      .join(","),
    OPENAI_MODEL: defaultModel,
  };
  const selected = isAllowedModel(choiceEnvironment, state.selectedModel)
    ? state.selectedModel
    : defaultModel;
  const selectedChoice = choices.find((choice) => choice.id === selected);
  const currentLabel = selectedChoice?.label || "Stabilize default";
  const paid = state.entitled === true;
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
        " subscriber model messages used this UTC month. The default model does not count."
    : used +
        " of " +
        freeLimit +
        " free model-select messages used today. The allowance resets at 00:00 UTC, and the default model does not count.";
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
      "<p>Sign in to choose a model and receive 20 free model-select messages each day.</p>" +
      '<a class="billing-primary billing-link" href="/auth/google">Sign in to choose a model</a>' +
      "</section>";
  }

  const choice = modelChoiceState(state, choices, defaultModel);
  const options = modelOptionsMarkup(choices, choice.selected);
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

  return '<section class="billing-menu" aria-labelledby="billing-heading">' +
    '<h2 id="billing-heading">AI model</h2>' +
    '<form action="/account/model" method="post" class="model-choice-form">' +
    '<label for="model-choice">Choose model</label>' +
    '<select id="model-choice" name="model">' +
    options +
    "</select>" +
    '<button class="billing-primary" type="submit">Save model</button>' +
    "</form>" +
    '<p class="billing-usage">' +
    escapeHtml(usage) +
    "</p>" +
    upgrade +
    manage +
    "</section>";
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
  const buttonLabel =
    choice.selected === defaultModel ? "Default" : choice.currentLabel;
  let panel = "";

  if (!signedIn) {
    panel =
      "<p>Sign in to choose a model and receive 20 free model-select messages each day.</p>" +
      '<a class="billing-primary billing-link" href="/auth/google">Sign in</a>';
  } else {
    const options = modelOptionsMarkup(choices, choice.selected);
    const usage = modelUsageCopy({
      paid: choice.paid,
      used: choice.used,
      freeLimit,
      paidLimit,
    });
    const upgrade = !choice.paid && configured
      ? '<form action="/billing/checkout" method="post" data-billing-redirect="checkout">' +
          '<button class="billing-secondary" type="submit">Upgrade allowance</button>' +
          "</form>"
      : "";

    panel =
      '<form action="/account/model" method="post" class="model-choice-form composer-model-form">' +
      '<label for="composer-model-choice">Choose model</label>' +
      '<select id="composer-model-choice" name="model">' +
      options +
      "</select>" +
      '<button class="billing-primary" type="submit">Use model</button>' +
      "</form>" +
      '<p class="billing-usage">' +
      escapeHtml(usage) +
      "</p>" +
      upgrade;
  }

  return (
    '<details class="composer-model-picker">' +
    '<summary class="composer-model-button" aria-label="Choose AI model. Current: ' +
    escapeHtml(choice.currentLabel) +
    '">' +
    '<span class="composer-model-kicker">Model</span>' +
    '<span class="composer-model-current">' +
    escapeHtml(buttonLabel) +
    "</span>" +
    "</summary>" +
    '<div class="composer-model-panel" role="group" aria-label="AI model picker">' +
    "<h2>AI model</h2>" +
    panel +
    "</div>" +
    "</details>"
  );
}

`;
workerAfter = replaceBlock(
  workerAfter,
  "function billingMenuMarkup(",
  "async function injectBillingPage(",
  pickerFunctions,
  "the menu and composer model pickers",
);

const renderStart = "  const choices = modelChoices(env);";
const renderEnd = "  const url = new URL(request.url);";
const renderReplacement = `  const choices = modelChoices(env);
  const defaultModel = String(
    env.OPENAI_MODEL || choices[0]?.id || "gpt-5.6-sol",
  );
  const configured = stripeConfigured(env);
  const freeLimit = freeDailyModelMessageLimit(env);
  const paidLimit = monthlyModelMessageLimit(env);
  const markup = billingMenuMarkup({
    signedIn: Boolean(authSession),
    configured,
    state,
    choices,
    defaultModel,
    freeLimit,
    paidLimit,
  });
  const composerModelPicker = composerModelPickerMarkup({
    signedIn: Boolean(authSession),
    configured,
    state,
    choices,
    defaultModel,
    freeLimit,
    paidLimit,
  });
`;
workerAfter = replaceBlock(
  workerAfter,
  renderStart,
  renderEnd,
  renderReplacement,
  "the model-picker rendering configuration",
);

const lockedSelection = `  const stub = billingStub(env, authSession.accountKey);
  const state = await readBillingState(stub);
  if (!state.entitled) return redirect("/?billing=error", 303);
  await stub.setSelectedModel(model);`;
const freeSelection = `  const stub = billingStub(env, authSession.accountKey);
  await stub.setSelectedModel(model);`;
if (workerAfter.includes(lockedSelection)) {
  workerAfter = workerAfter.replace(lockedSelection, freeSelection);
} else {
  requireText(
    workerAfter,
    freeSelection,
    "the subscription-free model selection path",
  );
}

const paidChatResponse = `async function paidChatResponse(request, env, ctx) {
  if (request.method !== "POST") return originalWorker.fetch(request, env, ctx);
  const authSession = await readAuthSession(request, env);
  if (!authSession) return originalWorker.fetch(request, env, ctx);

  const stub = billingStub(env, authSession.accountKey);
  const state = await readBillingState(stub);
  const defaultModel = String(env.OPENAI_MODEL || "gpt-5.6-sol");
  const selectedModel = isAllowedModel(env, state.selectedModel)
    ? state.selectedModel
    : defaultModel;
  if (selectedModel === defaultModel) {
    return originalWorker.fetch(request, env, ctx);
  }

  const paid = state.entitled === true;
  const tier = paid ? "paid" : "free";
  const period = paid ? usagePeriod() : dailyUsagePeriod();
  const limit = paid
    ? monthlyModelMessageLimit(env)
    : freeDailyModelMessageLimit(env);
  const reservation = await stub.reserveUsage(tier, period, limit);
  if (!reservation.allowed) {
    const error = paid
      ? "The monthly subscriber model-message limit has been reached. Choose the default model or manage billing."
      : "The daily free model-select limit of " +
        limit +
        " messages has been reached. Choose the default model or try again after 00:00 UTC.";
    return jsonResponse({ error }, 429);
  }

  const response = await originalWorker.fetch(
    request,
    modelEnvironment(env, selectedModel),
    ctx,
  );
  let refund = !response.ok;
  if (response.ok) {
    try {
      const result = await response.clone().json();
      refund = Boolean(fixedReplyForRoute(result?.route));
    } catch {
      refund = false;
    }
  }
  if (refund) await stub.refundUsage(tier, period);
  return response;
}

`;
workerAfter = replaceBlock(
  workerAfter,
  "async function paidChatResponse(",
  "const worker =",
  paidChatResponse,
  "the tiered model usage path",
);

for (const expected of [
  "freeDailyModelMessageLimit",
  "dailyUsagePeriod",
  "20 free model-select messages",
  'stub.reserveUsage(tier, period, limit)',
  'stub.refundUsage(tier, period)',
  'await stub.setSelectedModel(model)',
]) {
  requireText(workerAfter, expected, expected);
}
if (workerAfter.includes("if (!state.entitled) return redirect")) {
  throw new Error("Model selection is still locked behind a subscription");
}

if (workerAfter !== workerBefore) {
  await writeFile(workerPath, workerAfter);
}

const wranglerPath = "wrangler.jsonc";
const wranglerBefore = await readFile(wranglerPath, "utf8");
let wranglerAfter = wranglerBefore;
if (!wranglerAfter.includes('"FREE_DAILY_MODEL_MESSAGE_LIMIT"')) {
  const anchor = '    "PAID_MONTHLY_MESSAGE_LIMIT": "200",';
  requireText(wranglerAfter, anchor, "the paid monthly quota variable");
  wranglerAfter = wranglerAfter.replace(
    anchor,
    `${anchor}
    "FREE_DAILY_MODEL_MESSAGE_LIMIT": "20",`,
  );
}
if (wranglerAfter !== wranglerBefore) {
  await writeFile(wranglerPath, wranglerAfter);
}

console.log("Enabled 20 free daily model-select messages for signed-in users.");

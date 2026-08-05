import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_MODEL = "gpt-5-mini";
const ASSET_VERSION = "20260805-live-model-usage-1";
const MODEL_CHOICES = [
  "gpt-5-mini|GPT-5 mini (default)",
  "gpt-5.1|GPT-5.1",
  "gpt-5.6-luna|GPT-5.6 Luna",
  "gpt-5.6-terra|GPT-5.6 Terra",
  "gpt-5.6-sol|GPT-5.6 Sol",
].join(",");

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Live model usage repair could not find ${label}`);
  }
}

const configPath = "wrangler.jsonc";
const configBefore = await readFile(configPath, "utf8");
const config = JSON.parse(configBefore);
config.vars ||= {};
config.vars.OPENAI_MODEL = DEFAULT_MODEL;
config.vars.MODEL_CHOICES = MODEL_CHOICES;
config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT = "20";
const configAfter = `${JSON.stringify(config, null, 2)}\n`;
if (configAfter !== configBefore) await writeFile(configPath, configAfter);

const indexPath = "src/index.js";
const indexBefore = await readFile(indexPath, "utf8");
let indexAfter = indexBefore;
const legacyCompatibility = `  const configuredModel = String(env.OPENAI_MODEL || "gpt-5.2");
  const model =
    configuredModel === "gpt-5.6-sol" ? "gpt-5.2" : configuredModel;`;
const directModel = `  const model = String(env.OPENAI_MODEL || "gpt-5-mini");`;
if (indexAfter.includes(legacyCompatibility)) {
  indexAfter = indexAfter.replace(legacyCompatibility, directModel);
} else {
  indexAfter = indexAfter.replaceAll(
    '  const model = String(env.OPENAI_MODEL || "gpt-5.2");',
    directModel,
  );
}
indexAfter = indexAfter.replaceAll(
  'String(env.OPENAI_MODEL || "gpt-5.2")',
  'String(env.OPENAI_MODEL || "gpt-5-mini")',
);
indexAfter = indexAfter.replaceAll(
  'String(env.OPENAI_MODEL || "gpt-5.6-sol")',
  'String(env.OPENAI_MODEL || "gpt-5-mini")',
);
requireText(indexAfter, directModel, "the direct default model configuration");
if (indexAfter.includes('configuredModel === "gpt-5.6-sol"')) {
  throw new Error("GPT-5.6 Sol is still being redirected to an older model");
}
if (indexAfter !== indexBefore) await writeFile(indexPath, indexAfter);

const workerPath = "src/paid-worker.js";
const workerBefore = await readFile(workerPath, "utf8");
let workerAfter = workerBefore;

for (const previousModel of ["gpt-5.2", "gpt-5.6-sol"]) {
  workerAfter = workerAfter.replaceAll(
    `env.OPENAI_MODEL || choices[0]?.id || "${previousModel}"`,
    'env.OPENAI_MODEL || choices[0]?.id || "gpt-5-mini"',
  );
  workerAfter = workerAfter.replaceAll(
    `env.OPENAI_MODEL || "${previousModel}"`,
    'env.OPENAI_MODEL || "gpt-5-mini"',
  );
}
workerAfter = workerAfter.replaceAll(
  "20260804-composer-model-picker-1",
  ASSET_VERSION,
);
workerAfter = workerAfter.replaceAll(
  `'<p class="billing-usage">' +`,
  `'<p class="billing-usage" data-model-usage="true" aria-live="polite">' +`,
);

if (!workerAfter.includes("X-Stabilize-Model-Usage-Used")) {
  const oldUsageResponse = `  const response = await originalWorker.fetch(
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
  return response;`;
  const liveUsageResponse = `  const response = await originalWorker.fetch(
    request,
    modelEnvironment(env, selectedModel),
    ctx,
  );
  let refund = !response.ok;
  const contentType = (response.headers.get("content-type") || "")
    .toLowerCase();
  if (response.ok && contentType.includes("application/json")) {
    try {
      const result = await response.clone().json();
      refund = Boolean(fixedReplyForRoute(result?.route));
    } catch {
      refund = false;
    }
  }
  if (refund) {
    await stub.refundUsage(tier, period);
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("X-Stabilize-Model-Usage-Tier", tier);
  headers.set("X-Stabilize-Model-Usage-Used", String(reservation.used));
  headers.set("X-Stabilize-Model-Usage-Limit", String(limit));
  headers.set("X-Stabilize-Model-Usage-Period", period);
  headers.set("X-Stabilize-Model-Selected", selectedModel);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });`;
  requireText(workerAfter, oldUsageResponse, "the model usage response block");
  workerAfter = workerAfter.replace(oldUsageResponse, liveUsageResponse);
}

for (const expected of [
  'env.OPENAI_MODEL || "gpt-5-mini"',
  `billing-client.js?v=${ASSET_VERSION}`,
  'data-model-usage="true"',
  "X-Stabilize-Model-Usage-Tier",
  "X-Stabilize-Model-Usage-Used",
  "X-Stabilize-Model-Usage-Limit",
  "X-Stabilize-Model-Usage-Period",
  "X-Stabilize-Model-Selected",
]) {
  requireText(workerAfter, expected, expected);
}
if (workerAfter !== workerBefore) await writeFile(workerPath, workerAfter);

const clientPath = "public/billing-client.js";
const clientBefore = await readFile(clientPath, "utf8");
let clientAfter = clientBefore;

if (!clientAfter.includes("function modelUsageFromResponse(")) {
  clientAfter += `

const stabilizeNativeFetch = globalThis.fetch.bind(globalThis);

function chatRequestPath(input) {
  try {
    const value =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input || "");
    return new URL(value, window.location.href).pathname;
  } catch {
    return "";
  }
}

function modelUsageFromResponse(response) {
  const tier = String(
    response.headers.get("X-Stabilize-Model-Usage-Tier") || "",
  ).toLowerCase();
  const used = Number(response.headers.get("X-Stabilize-Model-Usage-Used"));
  const limit = Number(response.headers.get("X-Stabilize-Model-Usage-Limit"));
  const period = String(
    response.headers.get("X-Stabilize-Model-Usage-Period") || "",
  );
  const selectedModel = String(
    response.headers.get("X-Stabilize-Model-Selected") || "",
  );
  const periodIsValid =
    tier === "free"
      ? /^\\d{4}-\\d{2}-\\d{2}$/.test(period)
      : tier === "paid" && /^\\d{4}-\\d{2}$/.test(period);

  if (
    !periodIsValid ||
    !Number.isSafeInteger(used) ||
    used < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    used > limit
  ) {
    return null;
  }
  return { tier, used, limit, period, selectedModel };
}

function modelUsageCopy(usage) {
  return usage.tier === "paid"
    ? usage.used +
        " of " +
        usage.limit +
        " subscriber model messages used this UTC month. The default model does not count."
    : usage.used +
        " of " +
        usage.limit +
        " free model-select messages used today. The allowance resets at 00:00 UTC, and the default model does not count.";
}

function updateModelUsageDisplay(usage) {
  const message = modelUsageCopy(usage);
  for (const node of document.querySelectorAll(
    '[data-model-usage="true"], .billing-usage',
  )) {
    if (!(node instanceof HTMLElement)) continue;
    node.textContent = message;
    node.dataset.modelUsage = "true";
    node.dataset.modelUsageTier = usage.tier;
    node.dataset.modelUsageUsed = String(usage.used);
    node.dataset.modelUsageLimit = String(usage.limit);
    node.dataset.modelUsagePeriod = usage.period;
  }
}

globalThis.fetch = async (...args) => {
  const response = await stabilizeNativeFetch(...args);
  if (chatRequestPath(args[0]) === "/api/chat") {
    const usage = modelUsageFromResponse(response);
    if (usage) updateModelUsageDisplay(usage);
  }
  return response;
};
`;
}

for (const expected of [
  "function modelUsageFromResponse(",
  "function updateModelUsageDisplay(",
  'chatRequestPath(args[0]) === "/api/chat"',
  "X-Stabilize-Model-Usage-Used",
]) {
  requireText(clientAfter, expected, expected);
}
if (clientAfter !== clientBefore) await writeFile(clientPath, clientAfter);

const pickerTestPath = "test/paid-model-choice.test.mjs";
const pickerTestBefore = await readFile(pickerTestPath, "utf8");
let pickerTestAfter = pickerTestBefore;
const oldAssetAssertion = String.raw`  assert.match(
    workerSource,
    /src="\/billing-client\.js\?v=20260804-composer-model-picker-1"/,
  );`;
const newAssetAssertion = String.raw`  assert.match(
    workerSource,
    /src="\/billing-client\.js\?v=20260805-live-model-usage-1"/,
  );`;
if (pickerTestAfter.includes(oldAssetAssertion)) {
  pickerTestAfter = pickerTestAfter.replace(
    oldAssetAssertion,
    newAssetAssertion,
  );
} else {
  requireText(
    pickerTestAfter,
    newAssetAssertion,
    "the live model-usage asset assertion",
  );
}
if (pickerTestAfter !== pickerTestBefore) {
  await writeFile(pickerTestPath, pickerTestAfter);
}

console.log(
  "Set GPT-5 mini as the default, added GPT-5.6 choices, and enabled live usage counters.",
);

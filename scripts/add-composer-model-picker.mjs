import { readFile, writeFile } from "node:fs/promises";

const path = "src/paid-worker.js";
const before = await readFile(path, "utf8");
let text = before;

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Composer model picker could not find ${label}`);
  }
}

const ASSET_VERSION = "20260804-composer-model-picker-1";
text = text.replaceAll("20260804-paid-model-choice-1", ASSET_VERSION);

const pickerFunction = `function composerModelPickerMarkup({
  signedIn,
  configured,
  state,
  choices,
  defaultModel,
  limit,
}) {
  if (!configured) return "";

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
  const buttonLabel = selected === defaultModel ? "Default" : currentLabel;
  let panel = "";

  if (!signedIn) {
    panel =
      '<p>Sign in to choose an AI model.</p>' +
      '<a class="billing-primary billing-link" href="/auth/google">Sign in</a>';
  } else if (!state.entitled) {
    panel =
      '<p><strong>Stabilize default</strong> is active. Subscribe to choose another model.</p>' +
      '<form action="/billing/checkout" method="post" data-billing-redirect="checkout">' +
      '<button class="billing-primary" type="submit">Unlock model choice</button>' +
      "</form>";
  } else {
    const options = choices
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
    const used =
      state.usagePeriod === usagePeriod()
        ? Math.max(0, Number(state.usageCount) || 0)
        : 0;
    panel =
      '<form action="/account/model" method="post" class="model-choice-form composer-model-form">' +
      '<label for="composer-model-choice">Choose model</label>' +
      '<select id="composer-model-choice" name="model">' +
      options +
      "</select>" +
      '<button class="billing-primary" type="submit">Use model</button>' +
      "</form>" +
      '<p class="billing-usage">' +
      used +
      " of " +
      limit +
      " paid-model messages used this month. The default model does not count.</p>";
  }

  return (
    '<details class="composer-model-picker">' +
    '<summary class="composer-model-button" aria-label="Choose AI model. Current: ' +
    escapeHtml(currentLabel) +
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
}`;

if (!text.includes("function composerModelPickerMarkup(")) {
  const anchor = "\n\nasync function injectBillingPage(";
  requireText(text, anchor, "the billing page injection anchor");
  text = text.replace(
    anchor,
    `\n\n${pickerFunction}\n\nasync function injectBillingPage(`,
  );
}

if (!text.includes("const composerModelPicker = composerModelPickerMarkup(")) {
  const anchor = `  const markup = billingMenuMarkup({
    signedIn: Boolean(authSession),
    configured: stripeConfigured(env),
    state,
    choices,
    defaultModel,
    limit: monthlyModelMessageLimit(env),
  });
  const url = new URL(request.url);`;
  requireText(text, anchor, "the billing menu configuration block");
  text = text.replace(
    anchor,
    `  const markup = billingMenuMarkup({
    signedIn: Boolean(authSession),
    configured: stripeConfigured(env),
    state,
    choices,
    defaultModel,
    limit: monthlyModelMessageLimit(env),
  });
  const composerModelPicker = composerModelPickerMarkup({
    signedIn: Boolean(authSession),
    configured: stripeConfigured(env),
    state,
    choices,
    defaultModel,
    limit: monthlyModelMessageLimit(env),
  });
  const url = new URL(request.url);`,
  );
}

if (!text.includes('class="composer-entry-row"')) {
  const anchor = `  if (markup && !html.includes('src="/billing-client.js')) {`;
  requireText(text, anchor, "the billing client injection anchor");
  text = text.replace(
    anchor,
    `  if (composerModelPicker) {
    html = html.replace(
      /<form id="chat-form" class="chat-form">[\\s\\S]*?<\\/form>/,
      (chatForm) =>
        '<div class="composer-entry-row">' +
        composerModelPicker +
        chatForm +
        "</div>",
    );
  }
  if ((markup || composerModelPicker) && !html.includes('src="/billing-client.js')) {`,
  );
}

requireText(
  text,
  `href="/billing.css?v=${ASSET_VERSION}"`,
  "the cache-busted billing stylesheet",
);
requireText(
  text,
  `src="/billing-client.js?v=${ASSET_VERSION}"`,
  "the cache-busted billing client",
);
requireText(text, "function composerModelPickerMarkup(", "the picker markup helper");
requireText(text, 'class="composer-model-button"', "the left model button");
requireText(text, 'id="composer-model-choice"', "the picker select");
requireText(text, 'class="composer-entry-row"', "the composer row wrapper");
requireText(
  text,
  "const composerModelPicker = composerModelPickerMarkup(",
  "the picker rendering call",
);

if (text !== before) await writeFile(path, text);
console.log("Added the left-side composer model picker.");

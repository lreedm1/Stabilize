import { readFile, writeFile } from "node:fs/promises";

const path = "src/paid-worker.js";
const before = await readFile(path, "utf8");
let text = before;

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Paid model-choice repair could not find ${label}`);
  }
}

const oldOriginCheck = `function sameOriginOrNonBrowser(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}`;
const repairedOriginCheck = `function wantsJson(request) {
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
}`;

if (text.includes(oldOriginCheck)) {
  text = text.replace(oldOriginCheck, repairedOriginCheck);
} else {
  requireText(text, "function wantsJson(request)", "the JSON response helper");
  requireText(
    text,
    'origin !== "null"',
    "the opaque-origin billing compatibility check",
  );
}

text = text.replaceAll(
  '<form action="/billing/checkout" method="post">',
  '<form action="/billing/checkout" method="post" data-billing-redirect="checkout">',
);
text = text.replaceAll(
  '<form action="/billing/portal" method="post">',
  '<form action="/billing/portal" method="post" data-billing-redirect="portal">',
);

const oldBillingCss = `  if (!html.includes('href="/billing.css"')) {
    html = html.replace(
      "</head>",
      '    <link rel="stylesheet" href="/billing.css" />\\n  </head>',
    );
  }`;
const versionedBillingCss = `  if (!html.includes('href="/billing.css')) {
    html = html.replace(
      "</head>",
      '    <link rel="stylesheet" href="/billing.css?v=20260804-composer-model-picker-1" />\\n  </head>',
    );
  } else {
    html = html.replace(
      /href="\\/billing\\.css(?:\\?v=[^"]*)?"/,
      'href="/billing.css?v=20260804-composer-model-picker-1"',
    );
  }`;
if (text.includes(oldBillingCss)) {
  text = text.replace(oldBillingCss, versionedBillingCss);
} else {
  requireText(
    text,
    "/billing.css?v=20260804-composer-model-picker-1",
    "the versioned billing stylesheet",
  );
}

if (!text.includes('src="/billing-client.js?v=20260804-composer-model-picker-1"')) {
  const anchor = `  if (notice) {
    html = html.replace(`;
  requireText(text, anchor, "the billing notice injection");
  text = text.replace(
    anchor,
    `  if (markup && !html.includes('src="/billing-client.js')) {
    html = html.replace(
      "</body>",
      '    <script type="module" src="/billing-client.js?v=20260804-composer-model-picker-1"></script>\\n  </body>',
    );
  }
  if (notice) {
    html = html.replace(`,
  );
}

const oldCheckoutAuth = `  const authSession = await readAuthSession(request, env);
  if (!authSession) return redirect("/auth/google", 303);
  const stub = billingStub(env, authSession.accountKey);`;
const newCheckoutAuth = `  const authSession = await readAuthSession(request, env);
  if (!authSession) return signedOutBillingResponse(request);
  const stub = billingStub(env, authSession.accountKey);`;
text = text.replaceAll(oldCheckoutAuth, newCheckoutAuth);

text = text.replace(
  `  return redirect(url, 303);
}

async function portalResponse`,
  `  return billingNavigationResponse(request, url);
}

async function portalResponse`,
);
text = text.replace(
  `  const state = await readBillingState(billingStub(env, authSession.accountKey));
  return redirect(await createPortalSession(env, state), 303);
}`,
  `  const state = await readBillingState(billingStub(env, authSession.accountKey));
  const url = await createPortalSession(env, state);
  return billingNavigationResponse(request, url);
}`,
);

const oldConfigurationError = `      if (error instanceof BillingConfigurationError) {
        return redirect("/?billing=error", 303);
      }`;
const newConfigurationError = `      if (error instanceof BillingConfigurationError) {
        return wantsJson(request)
          ? jsonResponse({ error: "Billing is not configured." }, 503)
          : redirect("/?billing=error", 303);
      }`;
if (text.includes(oldConfigurationError)) {
  text = text.replace(oldConfigurationError, newConfigurationError);
}

const oldRequestError = `        return redirect("/?billing=error", 303);
      }
      const reference =`;
const newRequestError = `        return wantsJson(request)
          ? jsonResponse({ error: error.message }, error.status || 502)
          : redirect("/?billing=error", 303);
      }
      const reference =`;
if (text.includes(oldRequestError)) {
  text = text.replace(oldRequestError, newRequestError);
}

const oldUnknownError = `      return jsonResponse({ error: "Billing could not complete that request.", reference }, 503);`;
const newUnknownError = `      return wantsJson(request)
        ? jsonResponse(
            { error: "Billing could not complete that request.", reference },
            503,
          )
        : redirect("/?billing=error", 303);`;
if (text.includes(oldUnknownError)) {
  text = text.replace(oldUnknownError, newUnknownError);
}

requireText(text, 'data-billing-redirect="checkout"', "the checkout action hook");
requireText(text, 'data-billing-redirect="portal"', "the portal action hook");
requireText(text, "billingNavigationResponse(request, url)", "the JSON checkout response");
requireText(text, "signedOutBillingResponse(request)", "the signed-out JSON response");
requireText(
  text,
  'src="/billing-client.js?v=20260804-composer-model-picker-1"',
  "the billing client script",
);
requireText(text, 'origin !== "null"', "opaque-origin compatibility");
requireText(text, 'fetchSite && !["same-origin", "none"].includes(fetchSite)', "cross-site rejection");

if (text !== before) await writeFile(path, text);
console.log("Repaired paid model choice and resilient Stripe navigation.");

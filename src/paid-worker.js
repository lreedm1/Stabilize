import originalWorker, { SessionMemory } from "./index.js";
import { readAuthSession } from "./auth.js";
import { fixedReplyForRoute } from "./safety.js";
import { BillingAccount } from "./billing-account.js";
import {
  BillingConfigurationError,
  BillingRequestError,
  createCheckoutSession,
  createPortalSession,
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

function sameOriginOrNonBrowser(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
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

function billingNotice(url, reconciled) {
  const state = url.searchParams.get("billing");
  if (state === "success") {
    return reconciled
      ? "Payment confirmed. Model choice is active."
      : "Payment is being confirmed. Refresh shortly if model choice is not active yet.";
  }
  if (state === "cancelled") return "Checkout was cancelled. No subscription was started.";
  if (state === "error") return "Billing could not complete that request. Try again from the menu.";
  if (url.searchParams.get("model") === "saved") return "Your AI model choice was saved.";
  if (url.searchParams.get("model") === "limit") {
    return "That model's monthly message limit has been reached. Choose the default model or manage billing.";
  }
  return "";
}

function billingMenuMarkup({ signedIn, configured, state, choices, defaultModel, limit }) {
  if (!configured) return "";
  if (!signedIn) {
    return `<section class="billing-menu" aria-labelledby="billing-heading">
      <h2 id="billing-heading">AI model</h2>
      <p>Sign in to unlock paid model choice.</p>
    </section>`;
  }

  if (!state.entitled) {
    return `<section class="billing-menu" aria-labelledby="billing-heading">
      <h2 id="billing-heading">AI model</h2>
      <p>Use the standard model free, or subscribe to choose from additional models.</p>
      <form action="/billing/checkout" method="post">
        <button class="billing-primary" type="submit">Unlock model choice</button>
      </form>
      ${state.customerId ? `<form action="/billing/portal" method="post">
        <button class="billing-secondary" type="submit">Manage billing</button>
      </form>` : ""}
      <p class="billing-fine-print">Stripe shows the price before purchase. Subscription renews until cancelled.</p>
    </section>`;
  }

  const selected = isAllowedModel({ MODEL_CHOICES: choices.map((choice) => `${choice.id}|${choice.label}`).join(","), OPENAI_MODEL: defaultModel }, state.selectedModel)
    ? state.selectedModel
    : defaultModel;
  const options = choices.map((choice) =>
    `<option value="${escapeHtml(choice.id)}"${choice.id === selected ? " selected" : ""}>${escapeHtml(choice.label)}</option>`,
  ).join("");
  const used = state.usagePeriod === usagePeriod()
    ? Math.max(0, Number(state.usageCount) || 0)
    : 0;

  return `<section class="billing-menu" aria-labelledby="billing-heading">
    <h2 id="billing-heading">AI model</h2>
    <form action="/account/model" method="post" class="model-choice-form">
      <label for="model-choice">Choose model</label>
      <select id="model-choice" name="model">${options}</select>
      <button class="billing-primary" type="submit">Save model</button>
    </form>
    <p class="billing-usage">${used} of ${limit} paid-model messages used this month. The default model does not count toward this limit.</p>
    <form action="/billing/portal" method="post">
      <button class="billing-secondary" type="submit">Manage billing</button>
    </form>
  </section>`;
}

async function injectBillingPage(response, request, env, authSession, state, reconciled) {
  if (request.method === "HEAD" || !response.ok) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const choices = modelChoices(env);
  const defaultModel = String(env.OPENAI_MODEL || choices[0]?.id || "gpt-5.6-sol");
  const markup = billingMenuMarkup({
    signedIn: Boolean(authSession),
    configured: stripeConfigured(env),
    state,
    choices,
    defaultModel,
    limit: monthlyModelMessageLimit(env),
  });
  const url = new URL(request.url);
  const notice = billingNotice(url, reconciled);
  let html = await response.text();

  if (!html.includes('href="/billing.css"')) {
    html = html.replace(
      "</head>",
      '    <link rel="stylesheet" href="/billing.css" />\n  </head>',
    );
  }
  if (markup) {
    html = html.replace(
      /(<div class="menu-account"[\s\S]*?<\/div>)(\s*<\/div>\s*<\/details>)/,
      `$1${markup}$2`,
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
  if (!authSession) return redirect("/auth/google", 303);
  const stub = billingStub(env, authSession.accountKey);
  const state = await readBillingState(stub);
  const url = state.entitled && state.customerId
    ? await createPortalSession(env, state)
    : await createCheckoutSession(env, state, authSession.accountKey);
  return redirect(url, 303);
}

async function portalResponse(request, env) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!sameOriginOrNonBrowser(request)) return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  const authSession = await readAuthSession(request, env);
  if (!authSession) return redirect("/auth/google", 303);
  const state = await readBillingState(billingStub(env, authSession.accountKey));
  return redirect(await createPortalSession(env, state), 303);
}

async function modelChoiceResponse(request, env) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!sameOriginOrNonBrowser(request)) return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  const authSession = await readAuthSession(request, env);
  if (!authSession) return redirect("/auth/google", 303);
  const form = await request.formData();
  const model = String(form.get("model") || "").trim();
  if (!isAllowedModel(env, model)) return redirect("/?billing=error", 303);
  const stub = billingStub(env, authSession.accountKey);
  const state = await readBillingState(stub);
  if (!state.entitled) return redirect("/?billing=error", 303);
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

async function paidChatResponse(request, env, ctx) {
  if (request.method !== "POST") return originalWorker.fetch(request, env, ctx);
  const authSession = await readAuthSession(request, env);
  if (!authSession) return originalWorker.fetch(request, env, ctx);
  const stub = billingStub(env, authSession.accountKey);
  const state = await readBillingState(stub);
  const defaultModel = String(env.OPENAI_MODEL || "gpt-5.6-sol");
  const selectedModel = state.entitled && isAllowedModel(env, state.selectedModel)
    ? state.selectedModel
    : defaultModel;
  if (selectedModel === defaultModel) {
    return originalWorker.fetch(request, env, ctx);
  }

  const period = usagePeriod();
  const reservation = await stub.reserveUsage(
    period,
    monthlyModelMessageLimit(env),
  );
  if (!reservation.allowed) {
    return jsonResponse(
      { error: "The monthly paid-model message limit has been reached. Choose the default model or manage billing." },
      429,
    );
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
  if (refund) await stub.refundUsage(period);
  return response;
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
        return redirect("/?billing=error", 303);
      }
      if (error instanceof BillingRequestError) {
        if (url.pathname === "/api/stripe/webhook") {
          return jsonResponse({ error: error.message }, error.status || 400);
        }
        return redirect("/?billing=error", 303);
      }
      const reference = "BIL-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      console.error(JSON.stringify({
        event: "billing_request_failed",
        error: error instanceof Error ? error.name : "UnknownError",
        path: url.pathname,
        reference,
      }));
      return jsonResponse({ error: "Billing could not complete that request.", reference }, 503);
    }
  },
};

export default worker;

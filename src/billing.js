const STRIPE_API_BASE = "https://api.stripe.com/v1";
const MAX_STRIPE_BODY_BYTES = 256_000;
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;
const ACCOUNT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]{8,}$/;
const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]{8,}$/;
const CHECKOUT_SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9]{8,}$/;
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{8,}$/;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export const MANAGED_PAYMENTS_STRIPE_VERSION = "2026-02-25.preview";

export class BillingConfigurationError extends Error {
  constructor(message = "Billing is not configured") {
    super(message);
    this.name = "BillingConfigurationError";
  }
}

export class BillingRequestError extends Error {
  constructor(message = "Billing request failed", status = 502) {
    super(message);
    this.name = "BillingRequestError";
    this.status = status;
  }
}

function boundedText(value, limit = 256) {
  return String(value || "").trim().slice(0, limit);
}

function validOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function modelChoices(env = {}) {
  const fallbackModel = boundedText(env.OPENAI_MODEL || "gpt-5.6-sol", 128);
  const configured = String(env.MODEL_CHOICES || "").trim();
  const source = configured || [
    `${fallbackModel}|Stabilize default`,
    "gpt-5.1|GPT-5.1",
    "gpt-5-mini|GPT-5 mini",
  ].join(",");

  const seen = new Set();
  const choices = [];
  for (const item of source.split(",")) {
    const [rawId, rawLabel] = item.split("|");
    const id = boundedText(rawId, 128);
    if (!MODEL_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    choices.push({
      id,
      label: boundedText(rawLabel || id, 64) || id,
    });
  }

  if (!seen.has(fallbackModel) && MODEL_ID_PATTERN.test(fallbackModel)) {
    choices.unshift({ id: fallbackModel, label: "Stabilize default" });
  }
  return choices.slice(0, 8);
}

export function isAllowedModel(env, model) {
  const id = boundedText(model, 128);
  return modelChoices(env).some((choice) => choice.id === id);
}

export function monthlyModelMessageLimit(env = {}) {
  const parsed = Number(env.PAID_MONTHLY_MESSAGE_LIMIT || 200);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 200;
  return Math.min(parsed, 10_000);
}

export function usagePeriod(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function subscriptionHasAccess(status) {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(boundedText(status, 32));
}

export function stripeConfigured(env = {}) {
  const secretKey = String(env.STRIPE_SECRET_KEY || "").trim();
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  const priceId = String(env.STRIPE_MODEL_CHOICE_PRICE_ID || "").trim();
  return (
    /^sk_(?:test|live)_[A-Za-z0-9_]{16,}$/.test(secretKey) &&
    /^whsec_[A-Za-z0-9]{16,}$/.test(webhookSecret) &&
    PRICE_ID_PATTERN.test(priceId) &&
    Boolean(validOrigin(env.PUBLIC_ORIGIN))
  );
}

function stripeConfig(env = {}) {
  if (!stripeConfigured(env)) throw new BillingConfigurationError();
  return {
    secretKey: String(env.STRIPE_SECRET_KEY).trim(),
    webhookSecret: String(env.STRIPE_WEBHOOK_SECRET).trim(),
    priceId: String(env.STRIPE_MODEL_CHOICE_PRICE_ID).trim(),
    origin: validOrigin(env.PUBLIC_ORIGIN),
  };
}

function customerId(value) {
  const id = boundedText(typeof value === "string" ? value : value?.id, 128);
  return CUSTOMER_ID_PATTERN.test(id) ? id : null;
}

function subscriptionId(value) {
  const id = boundedText(typeof value === "string" ? value : value?.id, 128);
  return SUBSCRIPTION_ID_PATTERN.test(id) ? id : null;
}

function accountKey(value) {
  const key = boundedText(value, 128);
  return ACCOUNT_KEY_PATTERN.test(key) ? key : null;
}

async function stripeRequest(env, path, options = {}) {
  const { secretKey } = stripeConfig(env);
  const method = options.method || "POST";
  const params = options.params instanceof URLSearchParams
    ? options.params
    : new URLSearchParams();
  const url = new URL(STRIPE_API_BASE + path);
  let body;
  if (method === "GET") {
    url.search = params.toString();
  } else {
    body = params.toString();
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`,
    ...(method === "GET"
      ? {}
      : { "Content-Type": "application/x-www-form-urlencoded" }),
    ...(options.stripeVersion
      ? { "Stripe-Version": String(options.stripeVersion) }
      : {}),
  };
  if (method !== "GET") {
    headers["Idempotency-Key"] = options.idempotencyKey || crypto.randomUUID();
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const type = boundedText(result?.error?.type, 80);
    const code = boundedText(result?.error?.code, 80);
    console.error(JSON.stringify({
      event: "stripe_request_failed",
      status: response.status,
      type: type || null,
      code: code || null,
      requestId: response.headers.get("request-id") || null,
    }));
    throw new BillingRequestError("Stripe could not complete that request.", 502);
  }
  return result;
}

export async function createCheckoutSession(env, state, accountAlias) {
  const config = stripeConfig(env);
  const key = accountKey(accountAlias);
  if (!key) throw new BillingRequestError("A signed-in account is required.", 401);

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("managed_payments[enabled]", "true");
  params.set("line_items[0][price]", config.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("client_reference_id", key);
  params.set("metadata[account_key]", key);
  params.set("subscription_data[metadata][account_key]", key);
  params.set(
    "success_url",
    `${config.origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
  );
  params.set("cancel_url", `${config.origin}/?billing=cancelled`);
  params.set("allow_promotion_codes", "true");
  const existingCustomer = customerId(state?.customerId);
  if (existingCustomer) params.set("customer", existingCustomer);

  const session = await stripeRequest(env, "/checkout/sessions", {
    params,
    stripeVersion: MANAGED_PAYMENTS_STRIPE_VERSION,
    idempotencyKey: `checkout-${key}-${crypto.randomUUID()}`,
  });
  const url = boundedText(session?.url, 2_048);
  if (!url.startsWith("https://checkout.stripe.com/")) {
    throw new BillingRequestError("Stripe did not return a checkout link.");
  }
  return url;
}

export async function createPortalSession(env, state) {
  const config = stripeConfig(env);
  const existingCustomer = customerId(state?.customerId);
  if (!existingCustomer) {
    throw new BillingRequestError("No billing account exists yet.", 409);
  }
  const params = new URLSearchParams({
    customer: existingCustomer,
    return_url: config.origin,
  });
  const session = await stripeRequest(env, "/billing_portal/sessions", { params });
  const url = boundedText(session?.url, 2_048);
  if (!url.startsWith("https://billing.stripe.com/")) {
    throw new BillingRequestError("Stripe did not return a billing portal link.");
  }
  return url;
}

export function stateFromSubscription(subscription, fallbackAccountKey = null) {
  if (!subscription || typeof subscription !== "object") return null;
  const key = accountKey(subscription?.metadata?.account_key || fallbackAccountKey);
  if (!key) return null;
  return {
    accountKey: key,
    customerId: customerId(subscription.customer),
    subscriptionId: subscriptionId(subscription),
    subscriptionStatus: boundedText(subscription.status || "none", 32) || "none",
    updatedAt: Date.now(),
  };
}

export function stateFromStripeEvent(event) {
  const type = boundedText(event?.type, 128);
  const object = event?.data?.object;
  if (!type || !object || typeof object !== "object") return null;

  if (type === "checkout.session.completed") {
    const key = accountKey(
      object.client_reference_id || object?.metadata?.account_key,
    );
    if (!key || object.mode !== "subscription") return null;
    const paid = ["paid", "no_payment_required"].includes(object.payment_status);
    return {
      accountKey: key,
      customerId: customerId(object.customer),
      subscriptionId: subscriptionId(object.subscription),
      subscriptionStatus: paid ? "active" : "incomplete",
      updatedAt: Date.now(),
    };
  }

  if (
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated" ||
    type === "customer.subscription.deleted" ||
    type === "customer.subscription.paused" ||
    type === "customer.subscription.resumed"
  ) {
    return stateFromSubscription(object);
  }

  return null;
}

export async function reconcileCheckoutSession(env, sessionIdValue, accountAlias) {
  const sessionId = boundedText(sessionIdValue, 256);
  const expectedAccount = accountKey(accountAlias);
  if (!CHECKOUT_SESSION_ID_PATTERN.test(sessionId) || !expectedAccount) return null;

  const params = new URLSearchParams();
  params.append("expand[]", "subscription");
  const session = await stripeRequest(
    env,
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { method: "GET", params },
  );
  const returnedAccount = accountKey(
    session.client_reference_id || session?.metadata?.account_key,
  );
  if (returnedAccount !== expectedAccount || session.mode !== "subscription") {
    return null;
  }

  if (session.subscription && typeof session.subscription === "object") {
    return stateFromSubscription(session.subscription, expectedAccount);
  }

  const paid = ["paid", "no_payment_required"].includes(session.payment_status);
  return {
    accountKey: expectedAccount,
    customerId: customerId(session.customer),
    subscriptionId: subscriptionId(session.subscription),
    subscriptionStatus: paid ? "active" : "incomplete",
    updatedAt: Date.now(),
  };
}

function parseStripeSignature(header) {
  const timestamps = [];
  const signatures = [];
  for (const item of String(header || "").split(",")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name === "t" && /^\d{10,}$/.test(value)) timestamps.push(Number(value));
    if (name === "v1" && /^[a-f0-9]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  return { timestamp: timestamps.at(-1), signatures };
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function constantTimeTextEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

export async function verifyStripeSignature(
  payload,
  signatureHeader,
  webhookSecret,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!Number.isSafeInteger(timestamp) || !signatures.length) return false;
  if (Math.abs(nowSeconds - timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const secret = String(webhookSecret || "");
  if (!/^whsec_[A-Za-z0-9]{16,}$/.test(secret)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = bytesToHex(digest);
  return signatures.some((signature) => constantTimeTextEqual(signature, expected));
}

export async function readStripeWebhook(request, env) {
  const { webhookSecret } = stripeConfig(env);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_STRIPE_BODY_BYTES
  ) {
    throw new BillingRequestError("Webhook body is too large.", 413);
  }
  const payload = await request.text();
  if (new TextEncoder().encode(payload).byteLength > MAX_STRIPE_BODY_BYTES) {
    throw new BillingRequestError("Webhook body is too large.", 413);
  }
  const valid = await verifyStripeSignature(
    payload,
    request.headers.get("stripe-signature"),
    webhookSecret,
  );
  if (!valid) throw new BillingRequestError("Invalid Stripe signature.", 400);
  try {
    const event = JSON.parse(payload);
    return event && typeof event === "object" ? event : null;
  } catch {
    throw new BillingRequestError("Invalid Stripe payload.", 400);
  }
}

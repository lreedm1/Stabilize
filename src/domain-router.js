import worker, {
  BillingAccount,
  FeedbackGate,
  FeedbackInbox,
  GuestSessionMemory,
  SessionMemory,
} from "./memory-prompt-worker.js";
import { captureRequestStartedAt } from "./request-timing.js";
import { ACCOUNT_STATE_HEADER } from "./account-session.js";

export {
  BillingAccount,
  FeedbackGate,
  FeedbackInbox,
  GuestSessionMemory,
  SessionMemory,
};

const CANONICAL_ORIGIN = "https://stabilize.info";
const HSTS_VALUE = "max-age=31536000; includeSubDomains";
const REDIRECT_HOSTS = new Set([
  "reedlokken.com",
  "www.reedlokken.com",
  "www.stabilize.info",
]);

function redirectToCanonical(request) {
  const incoming = new URL(request.url);
  const canonical = new URL(CANONICAL_ORIGIN);
  canonical.pathname = incoming.pathname;
  canonical.search = incoming.search;
  canonical.hash = incoming.hash;

  return new Response(null, {
    status: 308,
    headers: {
      "Cache-Control": "public, max-age=3600",
      Location: canonical.toString(),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function withStrictTransportSecurity(response) {
  const headers = new Headers(response.headers);
  headers.delete(ACCOUNT_STATE_HEADER);
  headers.set("Strict-Transport-Security", HSTS_VALUE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function canonicalEnvironment(env) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "PUBLIC_ORIGIN") return CANONICAL_ORIGIN;
      return Reflect.get(target, property, receiver);
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    captureRequestStartedAt(request);
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || REDIRECT_HOSTS.has(hostname)) {
      return redirectToCanonical(request);
    }

    const canonicalEnv = canonicalEnvironment(env);
    const response = await worker.fetch(request, canonicalEnv, ctx);

    return withStrictTransportSecurity(response);
  },
};

import worker, {
  BillingAccount,
  FeedbackGate,
  FeedbackInbox,
  SessionMemory,
} from "./feedback-worker.js";
import { signOut } from "./auth.js";

export { BillingAccount, FeedbackGate, FeedbackInbox, SessionMemory };

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
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || REDIRECT_HOSTS.has(hostname)) {
      return redirectToCanonical(request);
    }

    const canonicalEnv = canonicalEnvironment(env);
    // Logout only expires cookies in the current browser. Handle it before the
    // inner same-origin check because iOS and embedded browsers can submit an
    // opaque Origin header (`Origin: null`).
    const response =
      url.pathname === "/auth/logout" && request.method === "POST"
        ? await signOut(request, canonicalEnv)
        : await worker.fetch(request, canonicalEnv, ctx);

    return withStrictTransportSecurity(response);
  },
};

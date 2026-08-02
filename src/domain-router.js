import worker, { BillingAccount, SessionMemory } from "./paid-worker.js";
import { signOut } from "./auth.js";

export { BillingAccount, SessionMemory };

const CANONICAL_ORIGIN = "https://stabilize.info";
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

function canonicalEnvironment(env) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "PUBLIC_ORIGIN") return CANONICAL_ORIGIN;
      return Reflect.get(target, property, receiver);
    },
  });
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    if (REDIRECT_HOSTS.has(hostname)) return redirectToCanonical(request);

    const canonicalEnv = canonicalEnvironment(env);
    // Logout only expires cookies in the current browser. Handle it before the
    // inner same-origin check because iOS and embedded browsers can submit an
    // opaque Origin header (`Origin: null`).
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      return signOut(request, canonicalEnv);
    }

    return worker.fetch(request, canonicalEnv, ctx);
  },
};

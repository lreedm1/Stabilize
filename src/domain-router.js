import worker, { BillingAccount, SessionMemory } from "./paid-worker.js";

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

export default {
  fetch(request, env, ctx) {
    const hostname = new URL(request.url).hostname.toLowerCase();
    if (REDIRECT_HOSTS.has(hostname)) return redirectToCanonical(request);
    return worker.fetch(request, env, ctx);
  },
};

import worker, {
  BillingAccount,
  FeedbackGate,
  FeedbackInbox,
  ImpactAnalytics,
  SessionMemory,
} from "./impact-worker.js";
import { signOut } from "./auth.js";
import {
  MOBILE_VIDEO_ROUTE,
  serveMobileVideo,
} from "./mobile-video-response.js";
import {
  isMobileBackgroundAssetRoute,
  serveMobileBackgroundAsset,
} from "./mobile-background-response.js";

export {
  BillingAccount,
  FeedbackGate,
  FeedbackInbox,
  ImpactAnalytics,
  SessionMemory,
};

const CANONICAL_ORIGIN = "https://stabilize.info";
const CANONICAL_HOST = "stabilize.info";
const HSTS_VALUE = "max-age=31536000; includeSubDomains";
const REDIRECT_HOSTS = new Set([
  "www.stabilize.info",
  "reedlokken.com",
  "www.reedlokken.com",
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

function unknownHostResponse() {
  return new Response("Not found.", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
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
    if (hostname !== CANONICAL_HOST && !REDIRECT_HOSTS.has(hostname)) {
      return unknownHostResponse();
    }
    if (url.protocol !== "https:" || REDIRECT_HOSTS.has(hostname)) {
      return redirectToCanonical(request);
    }

    const canonicalEnv = canonicalEnvironment(env);
    // Keep MP4 delivery inside the Worker so Safari receives a strong ETag,
    // an uncached response, and exact single-range handling rather than a
    // potentially transformed CDN cache response.
    if (url.pathname === MOBILE_VIDEO_ROUTE) {
      return withStrictTransportSecurity(
        await serveMobileVideo(request, canonicalEnv),
      );
    }

    if (isMobileBackgroundAssetRoute(url.pathname)) {
      return withStrictTransportSecurity(
        serveMobileBackgroundAsset(request),
      );
    }

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

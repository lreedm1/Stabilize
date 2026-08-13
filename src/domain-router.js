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
import {
  CHAT_UW_MADISON_HOST,
  uwMadisonChatResponse,
} from "./uw-madison-chat.js";

export {
  BillingAccount,
  FeedbackGate,
  FeedbackInbox,
  ImpactAnalytics,
  SessionMemory,
};

const CANONICAL_ORIGIN = "https://stabilize.info";
const CANONICAL_HOST = "stabilize.info";
const UW_MADISON_HOST = "uwmadison.stabilize.info";
const UW_MADISON_CHAT_URL = `https://${CHAT_UW_MADISON_HOST}/`;
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

function redirectToHttps(request) {
  const secure = new URL(request.url);
  secure.protocol = "https:";

  return new Response(null, {
    status: 308,
    headers: {
      "Cache-Control": "public, max-age=3600",
      Location: secure.toString(),
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

function methodNotAllowedResponse() {
  return new Response("Method not allowed.", {
    status: 405,
    headers: {
      Allow: "GET, HEAD",
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

async function serveUwMadisonAsset(request, env, pathname) {
  const assetUrl = new URL(pathname, CANONICAL_ORIGIN);
  const assetRequest = new Request(assetUrl, {
    method: request.method,
    headers: request.headers,
  });
  const response = await env.ASSETS.fetch(assetRequest);
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", "default-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");

  return withStrictTransportSecurity(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
}

function redirectToUwMadisonChat() {
  return withStrictTransportSecurity(
    new Response(null, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
        Location: UW_MADISON_CHAT_URL,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    }),
  );
}

async function uwMadisonResponse(request, env) {
  const url = new URL(request.url);

  if (url.protocol !== "https:") {
    return redirectToHttps(request);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return withStrictTransportSecurity(methodNotAllowedResponse());
  }

  if (url.pathname === "/chat") {
    return redirectToUwMadisonChat();
  }

  const assetPath = new Map([
    ["/", "/uwmadison.html"],
    ["/index.html", "/uwmadison.html"],
    ["/uwmadison.html", "/uwmadison.html"],
    ["/robots.txt", "/uwmadison-robots.txt"],
    ["/sitemap.xml", "/uwmadison-sitemap.xml"],
  ]).get(url.pathname);

  if (!assetPath) {
    return withStrictTransportSecurity(unknownHostResponse());
  }

  return serveUwMadisonAsset(request, env, assetPath);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    const canonicalEnv = canonicalEnvironment(env);

    if (hostname === UW_MADISON_HOST) {
      return uwMadisonResponse(request, env);
    }

    if (hostname === CHAT_UW_MADISON_HOST) {
      if (url.protocol !== "https:") {
        return redirectToHttps(request);
      }
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
      return withStrictTransportSecurity(
        await uwMadisonChatResponse(request, canonicalEnv, ctx),
      );
    }

    if (hostname !== CANONICAL_HOST && !REDIRECT_HOSTS.has(hostname)) {
      return unknownHostResponse();
    }
    if (url.protocol !== "https:" || REDIRECT_HOSTS.has(hostname)) {
      return redirectToCanonical(request);
    }

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

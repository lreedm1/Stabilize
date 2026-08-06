import worker, {
  BillingAccount,
  FeedbackGate,
  FeedbackInbox,
  SessionMemory,
} from "./memory-prompt-worker.js";
import { ImpactAnalytics } from "./impact-analytics.js";
import {
  chatResponse,
  enhanceHomePage,
  enhancePrivacyPage,
  impactEventResponse,
} from "./impact-events.js";
import { jsonResponse, pageHeaders } from "./impact-shards.js";
import {
  adminImpactResponse,
  adminLoginResponse,
  adminLogoutResponse,
} from "./impact-dashboard.js";

export {
  BillingAccount,
  FeedbackGate,
  FeedbackInbox,
  ImpactAnalytics,
  SessionMemory,
};

const impactWorker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/impact-event") {
        return await impactEventResponse(request, env);
      }
      if (url.pathname === "/admin/impact/login") {
        return await adminLoginResponse(request, env);
      }
      if (url.pathname === "/admin/impact/logout") {
        return await adminLogoutResponse(request);
      }
      if (url.pathname === "/admin/impact") {
        return await adminImpactResponse(request, env);
      }
      if (url.pathname === "/api/chat") {
        return await chatResponse(request, env, ctx);
      }

      const response = await worker.fetch(request, env, ctx);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return enhanceHomePage(response, request);
      }
      if (url.pathname === "/privacy.html") {
        return enhancePrivacyPage(response, request);
      }
      return response;
    } catch (error) {
      if (error instanceof Response) return error;
      const reference =
        "IMP-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      console.error(
        JSON.stringify({
          event: "impact_request_failed",
          error: error instanceof Error ? error.name : "UnknownError",
          path: url.pathname,
          reference,
        }),
      );
      if (url.pathname.startsWith("/admin/impact")) {
        return new Response(`Impact dashboard unavailable. Reference: ${reference}`, {
          status: 503,
          headers: pageHeaders("text/plain; charset=utf-8"),
        });
      }
      return jsonResponse(
        { error: "Impact measurement is temporarily unavailable.", reference },
        503,
      );
    }
  },
};

export default impactWorker;

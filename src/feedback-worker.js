import paidWorker, { BillingAccount, SessionMemory } from "./paid-worker.js";
import { readAuthSession } from "./auth.js";
import { FeedbackGate } from "./feedback-gate.js";
import { FeedbackInbox } from "./feedback-inbox.js";
import {
  FeedbackConfigurationError,
  FeedbackRequestError,
  createFeedbackRecord,
  feedbackConfigured,
  normalizeFeedback,
} from "./feedback.js";

export { BillingAccount, FeedbackGate, FeedbackInbox, SessionMemory };

const MAX_FORM_BYTES = 8_192;
const ACCOUNT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function redirect(location, status = 303, extraHeaders = {}) {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Location: location,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "Content-Type": "application/json; charset=utf-8",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders,
    },
  });
}

function sameOriginRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function feedbackAvailable(env) {
  return (
    feedbackConfigured(env) &&
    env?.FEEDBACK_LIMITS &&
    typeof env.FEEDBACK_LIMITS.getByName === "function" &&
    env?.FEEDBACK_INBOX &&
    typeof env.FEEDBACK_INBOX.getByName === "function"
  );
}

function feedbackGate(env, accountKey) {
  const key = String(accountKey || "");
  if (!ACCOUNT_KEY_PATTERN.test(key)) return null;
  if (!env?.FEEDBACK_LIMITS || typeof env.FEEDBACK_LIMITS.getByName !== "function") {
    return null;
  }
  return env.FEEDBACK_LIMITS.getByName("google:" + key);
}

function feedbackInbox(env) {
  if (!env?.FEEDBACK_INBOX || typeof env.FEEDBACK_INBOX.getByName !== "function") {
    return null;
  }
  return env.FEEDBACK_INBOX.getByName("git-feedback-inbox");
}

async function readBoundedForm(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    throw new FeedbackRequestError("Unsupported feedback form encoding.", 415);
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FORM_BYTES) {
    throw new FeedbackRequestError("Feedback form is too large.", 413);
  }
  if (!request.body) return new URLSearchParams();

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FORM_BYTES) {
        await reader.cancel("Feedback form is too large.");
        throw new FeedbackRequestError("Feedback form is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

function feedbackMarkup({ signedIn, configured }) {
  if (!configured) return "";
  if (!signedIn) {
    return `<section class="feedback-menu" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading">Feedback</h2>
      <p>Sign in to send feedback about Stabilize.</p>
      <a class="feedback-sign-in" href="/auth/google">Sign in to give feedback</a>
    </section>`;
  }

  return `<section class="feedback-menu" aria-labelledby="feedback-heading">
    <h2 id="feedback-heading">Feedback</h2>
    <p>What should Stabilize improve?</p>
    <form action="/api/feedback" method="post" class="feedback-form">
      <label for="feedback-category">Type</label>
      <select id="feedback-category" name="category">
        <option value="idea">Idea</option>
        <option value="bug">Bug</option>
        <option value="experience">Experience</option>
        <option value="other">Other</option>
      </select>
      <label for="feedback-message">Feedback</label>
      <textarea
        id="feedback-message"
        name="message"
        rows="4"
        minlength="10"
        maxlength="2000"
        placeholder="Describe what happened or what would help."
        required
      ></textarea>
      <label class="feedback-public-warning">
        <input type="checkbox" name="public_ack" value="yes" required />
        <span>I understand this is saved in a public GitHub repository and may be reviewed by automated AI tooling. I will not include private or identifying information.</span>
      </label>
      <button class="feedback-submit" type="submit">Send feedback</button>
    </form>
  </section>`;
}

function feedbackNotice(url) {
  const state = url.searchParams.get("feedback");
  if (state === "thanks") return "Thanks—your feedback was saved to the Git feedback inbox.";
  if (state === "rate") return "Feedback is limited to prevent spam. Please try again later.";
  if (state === "invalid") return "Please enter at least 10 characters and confirm the public-storage notice.";
  if (state === "error") return "Feedback could not be saved. Please try again later.";
  return "";
}

async function injectFeedbackPage(response, request, env, authSession) {
  if (request.method === "HEAD" || !response.ok) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const configured = feedbackAvailable(env);
  const markup = feedbackMarkup({
    signedIn: Boolean(authSession),
    configured,
  });
  const notice = feedbackNotice(new URL(request.url));
  let html = await response.text();

  if (!html.includes('href="/feedback.css"')) {
    html = html.replace(
      "</head>",
      '    <link rel="stylesheet" href="/feedback.css" />\n  </head>',
    );
  }
  if (markup) {
    html = html.replace(
      /(<div class="menu-panel">[\s\S]*?)(\s*<\/div>\s*<\/details>)/,
      `$1${markup}$2`,
    );
  }
  if (notice) {
    html = html.replace(
      '<main class="chat-card"',
      `<p class="feedback-notice" role="status">${escapeHtml(notice)}</p>\n      <main class="chat-card"`,
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
  const response = await paidWorker.fetch(request, env, ctx);
  return injectFeedbackPage(response, request, env, authSession);
}

async function feedbackResponse(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!sameOriginRequest(request)) {
    return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  }
  if (!feedbackAvailable(env)) {
    throw new FeedbackConfigurationError();
  }

  const authSession = await readAuthSession(request, env);
  if (!authSession) return redirect("/auth/google");

  const form = await readBoundedForm(request);
  if (form.get("public_ack") !== "yes") {
    return redirect("/?feedback=invalid");
  }

  let feedback;
  try {
    feedback = normalizeFeedback({
      category: String(form.get("category") || "other"),
      message: String(form.get("message") || ""),
    });
  } catch (error) {
    if (error instanceof FeedbackRequestError && error.status === 400) {
      return redirect("/?feedback=invalid");
    }
    throw error;
  }

  const gate = feedbackGate(env, authSession.accountKey);
  const inbox = feedbackInbox(env);
  if (
    !gate ||
    typeof gate.reserve !== "function" ||
    !inbox ||
    typeof inbox.save !== "function"
  ) {
    throw new FeedbackConfigurationError();
  }

  const reservation = await gate.reserve(Date.now());
  if (!reservation?.allowed) {
    return redirect("/?feedback=rate", 303, {
      "Retry-After": String(Math.max(1, Number(reservation?.retryAfterSeconds) || 600)),
    });
  }

  const record = createFeedbackRecord(feedback);
  try {
    await inbox.save(record);
  } catch (error) {
    if (typeof gate.refund === "function") {
      await gate.refund(reservation.reservationId).catch(() => false);
    }
    throw error;
  }

  return redirect("/?feedback=thanks");
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return await rootResponse(request, env, ctx);
      }
      if (url.pathname === "/api/feedback") {
        return await feedbackResponse(request, env);
      }
      return await paidWorker.fetch(request, env, ctx);
    } catch (error) {
      if (error instanceof FeedbackConfigurationError) {
        return redirect("/?feedback=error");
      }
      if (error instanceof FeedbackRequestError) {
        const retryAfter = error.status === 429 ? { "Retry-After": "600" } : {};
        return jsonResponse({ error: error.message }, error.status || 400, retryAfter);
      }

      const reference =
        "FDB-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      console.error(JSON.stringify({
        event: "feedback_request_failed",
        error: error instanceof Error ? error.name : "UnknownError",
        path: url.pathname,
        reference,
      }));
      return jsonResponse(
        { error: "Feedback could not be saved.", reference },
        503,
      );
    }
  },
};

export default worker;

import worker, {
  BillingAccount,
  FeedbackGate,
  FeedbackInbox,
  SessionMemory,
} from "./feedback-worker.js";
import { googleAuthConfigured, readAuthSession } from "./auth.js";

export { BillingAccount, FeedbackGate, FeedbackInbox, SessionMemory };

const MOBILE_QUALITY_LEGACY = "/mobile-quality.js?v=20260802-6";
const MOBILE_QUALITY_CURRENT = "/mobile-quality.js?v=20260802-7";
const ABOUT_LINK = '<a href="/about.html">About</a>';

const PROMPT_MARKUP = `<aside
  id="guest-memory-prompt"
  class="guest-memory-prompt"
  role="dialog"
  aria-modal="false"
  aria-labelledby="guest-memory-prompt-title"
  aria-describedby="guest-memory-prompt-description"
  hidden
>
  <button
    id="guest-memory-prompt-close"
    class="guest-memory-prompt-close"
    type="button"
    aria-label="Keep chatting as a guest"
  >×</button>
  <h2 id="guest-memory-prompt-title">Remember this conversation?</h2>
  <p id="guest-memory-prompt-description">
    Stabilize only remembers chat context between visits when you sign in. You can keep chatting as a guest, but this conversation will not carry over.
  </p>
  <div class="guest-memory-prompt-actions">
    <a class="guest-memory-prompt-sign-in" href="/auth/google">Sign in to remember</a>
    <button id="guest-memory-prompt-dismiss" type="button">Keep chatting as a guest</button>
  </div>
</aside>`;

async function enhanceHomePage(response, request, env) {
  if (request.method === "HEAD" || !response.ok) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  html = html.replace(MOBILE_QUALITY_LEGACY, MOBILE_QUALITY_CURRENT);
  if (!html.includes('href="/about.html"')) {
    html = html.replace(
      '<a href="/how-it-works.html">How it works</a>',
      `${ABOUT_LINK}\n                <a href="/how-it-works.html">How it works</a>`,
    );
  }

  const authSession = await readAuthSession(request, env);
  if (!authSession && googleAuthConfigured(env)) {
    if (!html.includes('href="/guest-memory-prompt.css')) {
      html = html.replace(
        "</head>",
        '    <link rel="stylesheet" href="/guest-memory-prompt.css?v=20260802-1" />\n  </head>',
      );
    }
    if (!html.includes('id="guest-memory-prompt"')) {
      html = html.replace(
        "</body>",
        `    ${PROMPT_MARKUP}\n    <script type="module" src="/guest-memory-prompt.js?v=20260802-1"></script>\n  </body>`,
      );
    }
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

export default {
  async fetch(request, env, ctx) {
    const response = await worker.fetch(request, env, ctx);
    const path = new URL(request.url).pathname;
    if (path !== "/" && path !== "/index.html") return response;
    return enhanceHomePage(response, request, env);
  },
};

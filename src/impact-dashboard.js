import {
  base64UrlEncode,
  boundedNumber,
  hmac,
  impactSummary,
  pageHeaders,
  readBoundedRequestText,
  readCookie,
  sameOriginRequest,
  timingSafeTextEqual,
} from "./impact-shards.js";

const ADMIN_COOKIE = "stabilize_impact_admin";
const ADMIN_COOKIE_SECONDS = 7 * 24 * 60 * 60;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const textEncoder = new TextEncoder();

async function readBoundedAdminForm(request) {
  const text = await readBoundedRequestText(
    request,
    2_048,
    "Login form is too large.",
  );
  return new URLSearchParams(text);
}

function adminPasswordHash(env) {
  const hash = String(env?.IMPACT_ADMIN_PASSWORD_SHA256 || "")
    .trim()
    .toLowerCase()
    .replaceAll(":", "")
    .replaceAll("-", "");
  return SHA256_HEX_PATTERN.test(hash) ? hash : "";
}

function legacyAdminSecret(env) {
  const secret = String(env?.IMPACT_ADMIN_SECRET || "");
  return secret.length >= 24 ? secret : "";
}

function adminSigningSecret(env) {
  const secret = String(env?.AUTH_SECRET || "");
  return secret.length >= 32 ? secret : "";
}

function adminConfigured(env) {
  return Boolean(
    adminSigningSecret(env) &&
      (adminPasswordHash(env) || legacyAdminSecret(env)),
  );
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(String(value || "")),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function adminCredentialFingerprint(env) {
  const configuredHash = adminPasswordHash(env);
  if (configuredHash) return configuredHash;
  const legacySecret = legacyAdminSecret(env);
  return legacySecret ? sha256Hex(legacySecret) : "";
}

async function adminPasswordAccepted(env, password) {
  const supplied = String(password || "");
  if (!supplied) return false;

  const configuredHash = adminPasswordHash(env);
  if (configuredHash) {
    return timingSafeTextEqual(configuredHash, await sha256Hex(supplied));
  }

  const legacySecret = legacyAdminSecret(env);
  return Boolean(
    legacySecret && (await timingSafeTextEqual(legacySecret, supplied)),
  );
}

async function adminCookieValue(env) {
  const signingSecret = adminSigningSecret(env);
  const credentialFingerprint = await adminCredentialFingerprint(env);
  if (!signingSecret || !credentialFingerprint) return "";
  return base64UrlEncode(
    await hmac(
      signingSecret,
      "impact-admin-cookie",
      credentialFingerprint,
    ),
  );
}

async function adminAuthorized(request, env) {
  const expected = await adminCookieValue(env);
  const received = readCookie(request, ADMIN_COOKIE);
  return Boolean(
    expected && received && (await timingSafeTextEqual(expected, received)),
  );
}

function adminCookie(request, value, maxAge = ADMIN_COOKIE_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${value}; Path=/admin/impact; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, maxAge)}${secure}`;
}

function redirect(location, cookie = "") {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: location,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number(value) || 0,
  );
}

function formatPercent(value) {
  return value === null || value === undefined
    ? "Not enough data"
    : new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(value);
}

function formatMoneyFromMicros(value) {
  if (value === null || value === undefined || Number(value) <= 0) {
    return "Not configured";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) / 1_000_000);
}

function selfFundingRatio(finance) {
  return finance.costCents > 0
    ? `${(finance.revenueCents / finance.costCents).toFixed(2)}×`
    : "Not configured";
}

function formatDurationMs(value) {
  if (value === null || value === undefined) return "Not enough data";
  const milliseconds = Number(value) || 0;
  return milliseconds < 1_000
    ? `${formatInteger(milliseconds)} ms`
    : `${(milliseconds / 1_000).toFixed(1)} s`;
}

function dailyUsageRows(summary, days = 14) {
  const byDate = new Map(
    (summary.dailyUsage || []).map((day) => [String(day.date), day]),
  );
  const rows = [];
  const end = new Date(summary.now);
  end.setUTCHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(end.getTime() - offset * 24 * 60 * 60 * 1_000);
    const key = date.toISOString().slice(0, 10);
    const usage = byDate.get(key) || { users: 0, messages: 0 };
    rows.push({
      date: key,
      users: Number(usage.users || 0),
      messages: Number(usage.messages || 0),
    });
  }
  return rows;
}

function dailyUsageTable(summary) {
  return dailyUsageRows(summary)
    .map(
      (day) => `<tr><th scope="row">${escapeHtml(day.date)}</th><td>${formatInteger(day.users)}</td><td>${formatInteger(day.messages)}</td></tr>`,
    )
    .join("");
}

const FEEDBACK_REASON_LABELS = {
  clear_answer: "Clear answer",
  useful_next_step: "Useful next step",
  felt_relevant: "Felt relevant",
  helped_me_decide: "Helped me decide",
  helped_me_feel_steadier: "Helped me feel steadier",
  did_not_answer: "Didn’t answer",
  misunderstood_me: "Misunderstood me",
  too_generic: "Too generic",
  too_long: "Too long",
  inaccurate: "Inaccurate",
  repetitive: "Repetitive",
  unsafe_or_concerning: "Unsafe or concerning",
  technical_problem: "Technical problem",
  other: "Other",
};

function feedbackReasonList(summary) {
  const rows = Object.entries(summary.feedbackReasons || {})
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, 8);
  if (!rows.length) return "<li>No reason tags submitted yet.</li>";
  return rows
    .map(
      ([reason, count]) => `<li><span>${escapeHtml(FEEDBACK_REASON_LABELS[reason] || reason)}</span><strong>${formatInteger(count)}</strong></li>`,
    )
    .join("");
}

function feedbackCommentList(summary) {
  const rows = (summary.recentFeedbackComments || []).slice(0, 20);
  if (!rows.length) return "<p>No written feedback submitted yet.</p>";
  return rows
    .map((entry) => {
      const rating = entry.rating === "up" ? "Helpful" : "Not helpful";
      const reason = FEEDBACK_REASON_LABELS[entry.reason] || entry.reason || "No reason tag";
      const date = new Date(Number(entry.occurredAt) || 0)
        .toISOString()
        .replace("T", " ")
        .slice(0, 16) + " UTC";
      return `<article class="feedback-comment"><div><strong>${escapeHtml(rating)}</strong><span>${escapeHtml(date)} · ${escapeHtml(reason)}</span></div><p>${escapeHtml(entry.comment)}</p></article>`;
    })
    .join("");
}

function weeklyDecision(summary, finance) {
  if (
    summary.conversationPrompts >= 30 &&
    summary.conversationResponses < 10
  ) {
    return "Keep the new-conversation outcome prompt visible but unobtrusive before judging whole-chat quality.";
  }
  if (
    summary.conversationResponses >= 20 &&
    summary.conversationHelpRate !== null &&
    summary.conversationHelpRate < 0.7
  ) {
    return "Review conversations marked No, then test one focused change to whole-chat usefulness.";
  }
  if (summary.feedbackShown >= 30 && summary.feedbackResponses < 10) {
    return "Make the response feedback control easier to notice before judging answer quality.";
  }
  if (
    summary.feedbackResponses >= 20 &&
    summary.helpfulResponseRate !== null &&
    summary.helpfulResponseRate < 0.7
  ) {
    return "Review the top negative reason and written comments, then test one focused response-quality change.";
  }
  if (summary.prompts < 30) {
    return "Hold product changes until 30 eligible checks have been shown; verify collection and privacy instead.";
  }
  if (summary.responses < 20) {
    return "Improve the placement or wording of the single question before judging response quality.";
  }
  if (
    summary.chatCompletionRate !== null &&
    summary.chatCompletionRate < 0.98
  ) {
    return "Fix response reliability before changing model cost, routing, or revenue.";
  }
  if (
    summary.reportedResolutionRate !== null &&
    summary.reportedResolutionRate < 0.7
  ) {
    return "Improve response usefulness before reducing model quality or compute.";
  }
  if (summary.estimatedCostMicros <= 0 || finance.costCents <= 0) {
    return "Enter real per-chat and recurring costs before changing model routing.";
  }
  if (finance.revenueCents / finance.costCents < 1) {
    return "Improve recurring revenue while preserving the free core and current safety guardrails.";
  }
  return "Hold routing steady for one week; make no product change unless a guardrail fails.";
}

function adminLoginPage(configured, error = false) {
  const message = configured
    ? error
      ? "That dashboard password was not accepted."
      : "Enter the private impact-dashboard password."
    : "Dashboard access is not configured.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Stabilize impact dashboard</title><link rel="stylesheet" href="/guides.css?v=20260806-unified-site-theme-1" /><style>
:root{color-scheme:dark}body{display:grid;min-height:100vh;min-height:100dvh;place-items:center}.card{width:min(420px,calc(100% - 32px));margin:0;border:var(--stabilize-reading-border);border-radius:18px;background:var(--stabilize-reading-surface);box-shadow:var(--stabilize-reading-shadow);color:var(--stabilize-reading-text);padding:24px;-webkit-backdrop-filter:var(--stabilize-reading-filter);backdrop-filter:var(--stabilize-reading-filter)}h1{font-size:1.35rem;margin-top:0}p{line-height:1.5}label{display:block;color:var(--stabilize-reading-text);font-weight:700;margin-bottom:7px;text-shadow:var(--stabilize-reading-text-shadow)}input{box-sizing:border-box;width:100%;border:var(--stabilize-reading-border);border-radius:10px;background:var(--stabilize-reading-surface);box-shadow:0 7px 22px rgba(4,13,10,.18);color:var(--stabilize-reading-text);font:inherit;padding:12px;-webkit-backdrop-filter:var(--stabilize-reading-filter);backdrop-filter:var(--stabilize-reading-filter)}button{margin-top:12px;border:1px solid rgba(255,254,248,.78);border-radius:10px;background:#1f6f54;color:var(--stabilize-reading-text);cursor:pointer;font:inherit;font-weight:700;padding:11px 16px}.error{color:var(--stabilize-reading-text);font-weight:700}
</style></head><body><main class="card"><h1>Stabilize impact dashboard</h1><p class="${error ? "error" : ""}">${escapeHtml(message)}</p>${configured ? `<form action="/admin/impact/login" method="post"><label for="password">Dashboard password</label><input id="password" name="password" type="password" autocomplete="current-password" required /><button type="submit">Open dashboard</button></form>` : ""}</main></body></html>`;
}

function dashboardPage(summary, finance) {
  const decision = weeklyDecision(summary, finance);
  const financeConfigured =
    finance.costCents > 0 && summary.estimatedCostMicros > 0;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Stabilize impact dashboard</title><link rel="stylesheet" href="/guides.css?v=20260806-unified-site-theme-1" /><style>
:root{color-scheme:dark}*{box-sizing:border-box}.shell{width:min(1040px,calc(100% - 32px));margin:32px auto 56px;border:var(--stabilize-reading-border);background:var(--stabilize-reading-surface);box-shadow:var(--stabilize-reading-shadow);color:var(--stabilize-reading-text);-webkit-backdrop-filter:var(--stabilize-reading-filter);backdrop-filter:var(--stabilize-reading-filter)}.top{display:flex;gap:20px;align-items:flex-start;justify-content:space-between}.top h1{margin:0 0 6px;font-size:clamp(1.7rem,3vw,2.5rem)}.top p{margin:0;color:var(--stabilize-reading-text)}.logout button{border:var(--stabilize-reading-border);border-radius:9px;background:var(--stabilize-reading-surface);box-shadow:0 7px 22px rgba(4,13,10,.18);color:var(--stabilize-reading-text);cursor:pointer;font:inherit;padding:8px 11px;-webkit-backdrop-filter:var(--stabilize-reading-filter);backdrop-filter:var(--stabilize-reading-filter)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.tile,.panel,.note{border:var(--stabilize-reading-border);background:var(--stabilize-reading-surface);box-shadow:var(--stabilize-reading-shadow);color:var(--stabilize-reading-text);-webkit-backdrop-filter:var(--stabilize-reading-filter);backdrop-filter:var(--stabilize-reading-filter)}.tile,.panel{border-radius:16px}.tile{padding:18px}.tile span{display:block;margin-bottom:7px;color:var(--stabilize-reading-text);font-size:.82rem}.tile strong{display:block;color:var(--stabilize-reading-text);font-size:1.45rem;line-height:1.2}.decision{width:100%;min-width:0;max-width:none;margin:0;padding:19px;border-left:0;text-align:left;justify-self:stretch}.decision h2,.guardrails h2,.usage h2,.feedback-reasons h2,.feedback-comments h2{font-size:1.05rem;margin:0 0 10px}.usage,.feedback-reasons,.feedback-comments{margin-bottom:14px;padding:19px}.usage-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.usage-heading p,.feedback-reasons p,.feedback-comments-note{margin:0;line-height:1.45}.usage-today{display:grid;gap:3px;text-align:right;white-space:nowrap}.usage-today span{font-size:.78rem;opacity:.8}.usage-today strong{font-size:.95rem}.usage-table-wrap{overflow-x:auto;margin-top:16px}table{width:100%;border-collapse:collapse}th,td{border-top:1px solid #dce6df;padding:9px 10px;text-align:right}th:first-child,td:first-child{text-align:left}thead th{border-top:0;font-size:.78rem}tbody th{font-weight:600}.feedback-reasons ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;list-style:none;padding:0;margin:0 0 14px}.feedback-reasons li{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid #e4ebe6;padding:7px 0}.feedback-comments>div{display:grid;gap:10px;margin-top:14px}.feedback-comment{border:1px solid #dce6df;border-radius:12px;padding:12px}.feedback-comment div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}.feedback-comment span{font-size:.78rem;color:#607b6f}.feedback-comment p{white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0 0;line-height:1.45}.decision p{font-size:1.1rem;line-height:1.55;margin:0}.guardrails{margin-top:14px;padding:19px}.guardrails ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 22px;margin:0;padding-left:20px}.guardrails li{line-height:1.45}.note{margin-top:16px;border-radius:12px;padding:14px;line-height:1.5}.meta{margin-top:14px;color:var(--stabilize-reading-text);font-size:.85rem;text-shadow:var(--stabilize-reading-text-shadow)}@media(max-width:760px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.guardrails ul{grid-template-columns:1fr}}@media(max-width:620px){.usage-heading{display:block}.usage-today{margin-top:12px;text-align:left}.feedback-reasons ul{grid-template-columns:1fr}}@media(max-width:520px){.shell{width:min(100% - 20px,1040px);margin-top:18px;padding:24px 20px}.top{display:block}.logout{margin-top:12px}.grid{grid-template-columns:1fr}.tile strong{font-size:1.3rem}}
</style></head><body><main class="shell"><header class="top"><div><h1>Orderly impact</h1><p>Engagement, response quality, outcomes, reliability, and cost.</p></div><form class="logout" action="/admin/impact/logout" method="post"><button type="submit">Sign out</button></form></header>
<section class="grid" aria-label="Primary engagement and quality metrics">
<div class="tile"><span>Eligible checks shown</span><strong>${formatInteger(summary.prompts)}</strong></div>
<div class="tile"><span>Reports received</span><strong>${formatInteger(summary.responses)}</strong></div>
<div class="tile"><span>Response rate</span><strong>${formatPercent(summary.responseRate)}</strong></div>
<div class="tile"><span>Reported next-step rate</span><strong>${formatPercent(summary.reportedResolutionRate)}</strong></div>
<div class="tile"><span>Est. cost / reported next step</span><strong>${formatMoneyFromMicros(summary.estimatedCostPerResolutionMicros)}</strong></div>
<div class="tile"><span>Self-funding ratio</span><strong>${escapeHtml(selfFundingRatio(finance))}</strong></div>
<div class="tile"><span>Conversations started</span><strong>${formatInteger(summary.conversations)}</strong></div>
<div class="tile"><span>Second-message rate</span><strong>${formatPercent(summary.secondMessageRate)}</strong></div>
<div class="tile"><span>Helpful response rate</span><strong>${formatPercent(summary.helpfulResponseRate)}</strong></div>
<div class="tile"><span>Feedback response rate</span><strong>${formatPercent(summary.feedbackResponseRate)}</strong></div>
<div class="tile"><span>Failed responses</span><strong>${formatInteger(summary.failedChats)}</strong></div>
<div class="tile"><span>Average response time</span><strong>${formatDurationMs(summary.averageResponseMs)}</strong></div>
<div class="tile"><span>Returning-browser rate</span><strong>${formatPercent(summary.returningBrowserRate)}</strong></div>
<div class="tile"><span>Est. cost / helpful response</span><strong>${formatMoneyFromMicros(summary.estimatedCostPerHelpfulMicros)}</strong></div>
<div class="tile"><span>Written comments</span><strong>${formatInteger(summary.feedbackComments)}</strong></div>
<div class="tile"><span>Conversation help rate</span><strong>${formatPercent(summary.conversationHelpRate)}</strong></div>
<div class="tile"><span>Conversation feedback rate</span><strong>${formatPercent(summary.conversationResponseRate)}</strong></div>
</section>
<section class="panel usage"><div class="usage-heading"><div><h2>Daily usage</h2><p>Unique browsers and submitted chat messages by UTC day.</p></div><div class="usage-today"><span>Today</span><strong>${formatInteger(dailyUsageRows(summary, 1)[0]?.users || 0)} users</strong><strong>${formatInteger(dailyUsageRows(summary, 1)[0]?.messages || 0)} messages</strong></div></div><div class="usage-table-wrap"><table><thead><tr><th>Date</th><th>Users</th><th>Messages</th></tr></thead><tbody>${dailyUsageTable(summary)}</tbody></table></div></section>
<section class="panel feedback-reasons"><h2>Top feedback reasons</h2><ul>${feedbackReasonList(summary)}</ul><p>${formatInteger(summary.helpfulResponses)} helpful · ${formatInteger(summary.unhelpfulResponses)} not helpful · ${formatInteger(summary.feedbackComments)} written comments</p></section>
<section class="panel feedback-comments"><h2>Recent written feedback</h2><p class="feedback-comments-note">Private, retention-limited comments. No chat text or user identifier is shown.</p><div>${feedbackCommentList(summary)}</div></section>
<section class="panel decision"><h2>One decision this week</h2><p>${escapeHtml(decision)}</p></section>
<section class="panel guardrails"><h2>Guardrails that cannot be traded away</h2><ul><li><strong>Safety:</strong> the ordinary check is excluded from immediate-danger, medical-emergency, and safety-unclear routes.</li><li><strong>Privacy:</strong> impact analytics never store chat text; optional written feedback is private and retention-limited.</li><li><strong>Trust:</strong> all feedback controls are optional and never block the conversation.</li><li><strong>Reliability:</strong> production checks verify the outcome asset, privacy disclosure, and protected dashboard route after every main deployment.</li></ul></section>
<p class="note">A reported next step means the user selected “Yes.” “Partly” and “No” remain visible in the response count but are not counted as resolved. Nonresponses remain unknown rather than being labeled failures. ${financeConfigured ? "Operating-cost inputs are configured." : "Cost metrics stay marked as not configured until real operating inputs are entered."}</p>
<p class="meta">Window: ${new Date(summary.since).toISOString().slice(0, 10)} through ${new Date(summary.now).toISOString().slice(0, 10)}.</p>
</main></body></html>`;
}

export async function adminLoginResponse(request, env) {
  if (request.method !== "POST") return redirect("/admin/impact");
  if (!sameOriginRequest(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!adminConfigured(env)) {
    return new Response(adminLoginPage(false), { headers: pageHeaders() });
  }
  const form = await readBoundedAdminForm(request);
  const password = String(form.get("password") || "").slice(0, 512);
  if (!(await adminPasswordAccepted(env, password))) {
    return new Response(adminLoginPage(true, true), {
      status: 401,
      headers: pageHeaders(),
    });
  }
  return redirect(
    "/admin/impact",
    adminCookie(request, await adminCookieValue(env)),
  );
}

export async function adminLogoutResponse(request) {
  if (request.method !== "POST" || !sameOriginRequest(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  return redirect("/admin/impact", adminCookie(request, "", 0));
}

export async function adminImpactResponse(request, env) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method not allowed", { status: 405 });
  }
  const configured = adminConfigured(env);
  if (!configured || !(await adminAuthorized(request, env))) {
    return new Response(
      request.method === "HEAD" ? null : adminLoginPage(configured),
      {
        status: configured ? 401 : 503,
        headers: pageHeaders(),
      },
    );
  }

  const now = Date.now();
  const summary = await impactSummary(env, {
    since: now - 30 * 24 * 60 * 60 * 1_000,
    now,
  });
  if (!summary) {
    return new Response("Impact measurement is unavailable.", { status: 503 });
  }

  const finance = {
    revenueCents: boundedNumber(
      env?.IMPACT_MONTHLY_RECURRING_REVENUE_CENTS,
      0,
      1_000_000_000,
      0,
    ),
    costCents: boundedNumber(
      env?.IMPACT_MONTHLY_RECURRING_COST_CENTS,
      0,
      1_000_000_000,
      0,
    ),
  };
  return new Response(
    request.method === "HEAD" ? null : dashboardPage(summary, finance),
    { headers: pageHeaders() },
  );
}

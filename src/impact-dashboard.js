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

async function readBoundedAdminForm(request) {
  const text = await readBoundedRequestText(
    request,
    2_048,
    "Login form is too large.",
  );
  return new URLSearchParams(text);
}

function adminSecret(env) {
  const secret = String(env?.IMPACT_ADMIN_SECRET || "");
  return secret.length >= 24 ? secret : "";
}

async function adminCookieValue(env) {
  const secret = adminSecret(env);
  if (!secret) return "";
  return base64UrlEncode(await hmac(secret, "impact-admin-cookie", "authorized"));
}

async function adminAuthorized(request, env) {
  const expected = await adminCookieValue(env);
  const received = readCookie(request, ADMIN_COOKIE);
  return Boolean(expected && received && (await timingSafeTextEqual(expected, received)));
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

function formatDuration(value) {
  if (value === null || value === undefined) return "Not enough data";
  const milliseconds = Number(value) || 0;
  if (milliseconds < 1_000) return `${formatInteger(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

function tableRows(entries, emptyMessage = "Not enough data yet.") {
  if (!entries.length) {
    return `<tr><td colspan="2" class="empty">${escapeHtml(emptyMessage)}</td></tr>`;
  }
  return entries
    .map(
      ([label, value]) =>
        `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("");
}

function adminLoginPage(configured, error = false) {
  const message = configured
    ? error
      ? "That dashboard password was not accepted."
      : "Enter the private impact-dashboard password."
    : "Set the IMPACT_ADMIN_SECRET Worker secret before using this dashboard.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Stabilize impact dashboard</title><style>
body{font-family:system-ui,sans-serif;background:#eef3ef;color:#173f31;margin:0;display:grid;min-height:100vh;place-items:center}.card{width:min(420px,calc(100% - 32px));background:#fff;border:1px solid #cad8cf;border-radius:18px;padding:24px;box-shadow:0 12px 32px rgba(20,55,43,.12)}h1{font-size:1.35rem;margin-top:0}p{line-height:1.5}label{display:block;font-weight:700;margin-bottom:7px}input{box-sizing:border-box;width:100%;font:inherit;padding:12px;border:1px solid #9eb4a7;border-radius:10px}button{font:inherit;font-weight:700;margin-top:12px;padding:11px 16px;border:0;border-radius:10px;background:#1f6f54;color:#fff;cursor:pointer}.error{color:#8a2d2d}
</style></head><body><main class="card"><h1>Stabilize impact dashboard</h1><p class="${error ? "error" : ""}">${escapeHtml(message)}</p>${configured ? `<form action="/admin/impact/login" method="post"><label for="password">Dashboard password</label><input id="password" name="password" type="password" autocomplete="current-password" required /><button type="submit">Open dashboard</button></form>` : ""}</main></body></html>`;
}

function dashboardPage(summary, finance) {
  const outcomeLabels = {
    answer: "The answer needed",
    action: "Something to do",
    contact: "Someone to contact",
    pause: "A decision to pause",
    information_only: "Information without resolution",
  };
  const clarityRows = Object.entries(summary.clarity || {}).map(([key, count]) => [
    key === "yes" ? "Yes" : key === "partly" ? "Partly" : "No",
    formatInteger(count),
  ]);
  const outcomeRows = Object.entries(summary.outcomes || {}).map(([key, count]) => [
    outcomeLabels[key] || key,
    formatInteger(count),
  ]);
  const routeRows = (summary.routes || []).map((row) => [
    row.route.replaceAll("_", " "),
    formatInteger(row.count),
  ]);
  const revisionRows = Object.entries(summary.revisions || {}).map(([key, count]) => [
    key.replaceAll("_", " "),
    formatInteger(count),
  ]);
  const trendRows = (summary.trend || []).map((row) => [
    row.date,
    `${formatInteger(row.resolved)} resolved / ${formatInteger(row.prompts)} eligible (${formatPercent(row.lowerBound)})`,
  ]);
  const selfFunding = finance.costCents > 0
    ? `${(finance.revenueCents / finance.costCents).toFixed(2)}×`
    : "Not configured";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Stabilize impact dashboard</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#edf3ef;color:#173f31;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(1180px,calc(100% - 32px));margin:32px auto 56px}.top{display:flex;gap:20px;align-items:flex-start;justify-content:space-between}.top h1{margin:0 0 6px;font-size:clamp(1.7rem,3vw,2.5rem)}.top p{margin:0;color:#49675a}.logout button{border:1px solid #9eb4a7;background:#fff;color:#173f31;border-radius:9px;padding:8px 11px;font:inherit;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:24px 0}.tile,.panel{background:#fff;border:1px solid #cad8cf;border-radius:16px;box-shadow:0 9px 24px rgba(20,55,43,.07)}.tile{padding:17px}.tile span{display:block;color:#607b6f;font-size:.82rem;margin-bottom:7px}.tile strong{font-size:1.45rem}.panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.panel{padding:18px}.panel h2{font-size:1.05rem;margin:0 0 12px}.wide{grid-column:1/-1}table{width:100%;border-collapse:collapse}th,td{padding:9px 0;border-top:1px solid #e2eae5;text-align:left;vertical-align:top}th{font-weight:600;text-transform:capitalize}td{text-align:right;color:#3d5f50}.empty{text-align:left;color:#6b7f76}.note{margin-top:18px;padding:14px;border-radius:12px;background:#f7faf8;color:#4d675b;line-height:1.5}.meta{margin-top:16px;color:#6b7f76;font-size:.85rem}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.panels{grid-template-columns:1fr}.wide{grid-column:auto}}@media(max-width:520px){.shell{width:min(100% - 20px,1180px);margin-top:18px}.top{display:block}.logout{margin-top:12px}.grid{grid-template-columns:1fr}.tile strong{font-size:1.3rem}}
</style></head><body><main class="shell"><header class="top"><div><h1>Orderly impact</h1><p>Useful resolutions, trust, reach, and operating sustainability over the last 30 days.</p></div><form class="logout" action="/admin/impact/logout" method="post"><button type="submit">Sign out</button></form></header>
<section class="grid" aria-label="Primary metrics">
<div class="tile"><span>Resolved outcomes</span><strong>${formatInteger(summary.resolved)}</strong></div>
<div class="tile"><span>Reported resolution</span><strong>${formatPercent(summary.reportedResolutionRate)}</strong></div>
<div class="tile"><span>Resolution lower bound</span><strong>${formatPercent(summary.resolutionLowerBound)}</strong></div>
<div class="tile"><span>Est. cost per resolution</span><strong>${formatMoneyFromMicros(summary.estimatedCostPerResolutionMicros)}</strong></div>
<div class="tile"><span>Self-funding ratio</span><strong>${escapeHtml(selfFunding)}</strong></div>
<div class="tile"><span>Prompt response</span><strong>${formatPercent(summary.promptResponseRate)}</strong></div>
<div class="tile"><span>Reported clarity</span><strong>${formatPercent(summary.reportedClarityRate)}</strong></div>
<div class="tile"><span>Unique sessions</span><strong>${formatInteger(summary.sessions)}</strong></div>
<div class="tile"><span>Unique browsers</span><strong>${formatInteger(summary.browsers)}</strong></div>
<div class="tile"><span>Chat completion</span><strong>${formatPercent(summary.chatCompletionRate)}</strong></div>
</section>
<section class="panels">
<article class="panel"><h2>Clarity responses</h2><table>${tableRows(clarityRows)}</table></article>
<article class="panel"><h2>What users left with</h2><table>${tableRows(outcomeRows)}</table></article>
<article class="panel"><h2>Response routes</h2><table>${tableRows(routeRows)}</table></article>
<article class="panel"><h2>Requested revisions</h2><table>${tableRows(revisionRows)}</table></article>
<article class="panel"><h2>Latency</h2><table>${tableRows([
    ["Approx. first token p50", formatDuration(summary.latency?.firstTokenP50Ms)],
    ["Approx. first token p95", formatDuration(summary.latency?.firstTokenP95Ms)],
    ["Approx. total p50", formatDuration(summary.latency?.totalP50Ms)],
    ["Approx. total p95", formatDuration(summary.latency?.totalP95Ms)],
    ["Measured responses", formatInteger(summary.latency?.samples)],
  ])}</table></article>
<article class="panel"><h2>Proportional response</h2><table>${tableRows([
    ["About right", formatInteger(summary.proportionality?.about_right)],
    ["Too intense", formatInteger(summary.proportionality?.too_intense)],
    ["Not enough", formatInteger(summary.proportionality?.not_enough)],
    ["About-right rate", formatPercent(summary.proportionalResponseRate)],
  ])}</table></article>
<article class="panel wide"><h2>Recent daily lower bound</h2><table>${tableRows(trendRows)}</table></article>
</section>
<p class="note">Nonresponses remain unknown rather than being counted as failures. Analytics contain random identifier hashes and structured selections only—never user messages or assistant replies. Estimated cost metrics remain blank until IMPACT_ESTIMATED_CHAT_COST_MICROS is configured.</p>
<p class="meta">Window: ${new Date(summary.since).toISOString().slice(0,10)} through ${new Date(summary.now).toISOString().slice(0,10)} · Revenue configured: ${(finance.revenueCents / 100).toFixed(2)} USD · Recurring cost configured: ${(finance.costCents / 100).toFixed(2)} USD</p>
</main></body></html>`;
}

export async function adminLoginResponse(request, env) {
  if (request.method !== "POST") return redirect("/admin/impact");
  if (!sameOriginRequest(request)) return new Response("Forbidden", { status: 403 });
  const secret = adminSecret(env);
  if (!secret) return new Response(adminLoginPage(false), { headers: pageHeaders() });
  const form = await readBoundedAdminForm(request);
  const password = String(form.get("password") || "").slice(0, 512);
  if (!(await timingSafeTextEqual(secret, password))) {
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
  const configured = Boolean(adminSecret(env));
  if (!configured || !(await adminAuthorized(request, env))) {
    return new Response(request.method === "HEAD" ? null : adminLoginPage(configured), {
      status: configured ? 401 : 503,
      headers: pageHeaders(),
    });
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
  return new Response(request.method === "HEAD" ? null : dashboardPage(summary, finance), {
    headers: pageHeaders(),
  });
}

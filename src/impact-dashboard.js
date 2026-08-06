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
  return base64UrlEncode(
    await hmac(secret, "impact-admin-cookie", "authorized"),
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

function weeklyDecision(summary, finance) {
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
    : "Set the IMPACT_ADMIN_SECRET Worker secret before using this dashboard.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Stabilize impact dashboard</title><style>
body{font-family:system-ui,sans-serif;background:#eef3ef;color:#173f31;margin:0;display:grid;min-height:100vh;place-items:center}.card{width:min(420px,calc(100% - 32px));background:#fff;border:1px solid #cad8cf;border-radius:18px;padding:24px;box-shadow:0 12px 32px rgba(20,55,43,.12)}h1{font-size:1.35rem;margin-top:0}p{line-height:1.5}label{display:block;font-weight:700;margin-bottom:7px}input{box-sizing:border-box;width:100%;font:inherit;padding:12px;border:1px solid #9eb4a7;border-radius:10px}button{font:inherit;font-weight:700;margin-top:12px;padding:11px 16px;border:0;border-radius:10px;background:#1f6f54;color:#fff;cursor:pointer}.error{color:#8a2d2d}
</style></head><body><main class="card"><h1>Stabilize impact dashboard</h1><p class="${error ? "error" : ""}">${escapeHtml(message)}</p>${configured ? `<form action="/admin/impact/login" method="post"><label for="password">Dashboard password</label><input id="password" name="password" type="password" autocomplete="current-password" required /><button type="submit">Open dashboard</button></form>` : ""}</main></body></html>`;
}

function dashboardPage(summary, finance) {
  const decision = weeklyDecision(summary, finance);
  const financeConfigured =
    finance.costCents > 0 && summary.estimatedCostMicros > 0;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Stabilize impact dashboard</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#edf3ef;color:#173f31;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(1040px,calc(100% - 32px));margin:32px auto 56px}.top{display:flex;gap:20px;align-items:flex-start;justify-content:space-between}.top h1{margin:0 0 6px;font-size:clamp(1.7rem,3vw,2.5rem)}.top p{margin:0;color:#49675a}.logout button{border:1px solid #9eb4a7;background:#fff;color:#173f31;border-radius:9px;padding:8px 11px;font:inherit;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.tile,.panel{background:#fff;border:1px solid #cad8cf;border-radius:16px;box-shadow:0 9px 24px rgba(20,55,43,.07)}.tile{padding:18px}.tile span{display:block;color:#607b6f;font-size:.82rem;margin-bottom:7px}.tile strong{display:block;font-size:1.45rem;line-height:1.2}.decision{padding:22px;border-left:5px solid #2c7a5d}.decision h2,.guardrails h2{font-size:1.05rem;margin:0 0 10px}.decision p{font-size:1.1rem;line-height:1.55;margin:0}.guardrails{margin-top:14px;padding:19px}.guardrails ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 22px;margin:0;padding-left:20px}.guardrails li{line-height:1.45}.note{margin-top:16px;padding:14px;border-radius:12px;background:#f7faf8;color:#4d675b;line-height:1.5}.meta{margin-top:14px;color:#6b7f76;font-size:.85rem}@media(max-width:760px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.guardrails ul{grid-template-columns:1fr}}@media(max-width:520px){.shell{width:min(100% - 20px,1040px);margin-top:18px}.top{display:block}.logout{margin-top:12px}.grid{grid-template-columns:1fr}.tile strong{font-size:1.3rem}}
</style></head><body><main class="shell"><header class="top"><div><h1>Orderly impact</h1><p>One question. Six numbers. One decision each week.</p></div><form class="logout" action="/admin/impact/logout" method="post"><button type="submit">Sign out</button></form></header>
<section class="grid" aria-label="Six primary metrics">
<div class="tile"><span>Eligible checks shown</span><strong>${formatInteger(summary.prompts)}</strong></div>
<div class="tile"><span>Reports received</span><strong>${formatInteger(summary.responses)}</strong></div>
<div class="tile"><span>Response rate</span><strong>${formatPercent(summary.responseRate)}</strong></div>
<div class="tile"><span>Reported next-step rate</span><strong>${formatPercent(summary.reportedResolutionRate)}</strong></div>
<div class="tile"><span>Est. cost / reported next step</span><strong>${formatMoneyFromMicros(summary.estimatedCostPerResolutionMicros)}</strong></div>
<div class="tile"><span>Self-funding ratio</span><strong>${escapeHtml(selfFundingRatio(finance))}</strong></div>
</section>
<section class="panel decision"><h2>One decision this week</h2><p>${escapeHtml(decision)}</p></section>
<section class="panel guardrails"><h2>Guardrails that cannot be traded away</h2><ul><li><strong>Safety:</strong> the ordinary check is excluded from immediate-danger, medical-emergency, and safety-unclear routes.</li><li><strong>Privacy:</strong> impact analytics store one structured state, never chat text.</li><li><strong>Trust:</strong> the question is optional and always skippable.</li><li><strong>Reliability:</strong> production checks verify the outcome asset, privacy disclosure, and protected dashboard route after every main deployment.</li></ul></section>
<p class="note">A reported next step means the user selected “Yes.” “Partly” and “No” remain visible in the response count but are not counted as resolved. Nonresponses remain unknown rather than being labeled failures. ${financeConfigured ? "Operating-cost inputs are configured." : "Cost metrics stay marked as not configured until real operating inputs are entered."}</p>
<p class="meta">Window: ${new Date(summary.since).toISOString().slice(0, 10)} through ${new Date(summary.now).toISOString().slice(0, 10)}.</p>
</main></body></html>`;
}

export async function adminLoginResponse(request, env) {
  if (request.method !== "POST") return redirect("/admin/impact");
  if (!sameOriginRequest(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  const secret = adminSecret(env);
  if (!secret) {
    return new Response(adminLoginPage(false), { headers: pageHeaders() });
  }
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

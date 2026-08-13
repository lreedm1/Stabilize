import { COPY } from "./copy.js";
import { renderPage } from "./page.js";
import { classifyInput } from "./safety.js";

export const CHAT_UW_MADISON_HOST = "chat.uwmadison.stabilize.info";
export const CHAT_UW_MADISON_ORIGIN = `https://${CHAT_UW_MADISON_HOST}`;

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_BODY_BYTES = 2_000_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_MESSAGES = 12;
const OUTPUT_TOKEN_LIMIT = 650;
const ALLOWED_SERVICE_TIERS = new Set(["default", "priority", "fast"]);

export const UW_MADISON_RESOURCES = Object.freeze([
  Object.freeze({
    id: "emergency",
    name: "Emergency help",
    match: "Immediate physical danger, a life-threatening emergency, overdose, serious injury, or inability to stay safe.",
    action: "Call 911 or go to the nearest emergency department.",
    phone: "911",
    url: "tel:911",
    officialUrl: "https://uhs.wisc.edu/call-for-help/",
    type: "emergency",
  }),
  Object.freeze({
    id: "uhs-crisis",
    name: "UHS 24/7 Mental Health Crisis Support",
    match: "Suicidal thoughts, an urgent mental-health concern, or concern about another UW–Madison student.",
    action: "Call 608-265-5600 and choose option 9. The line is available 24/7.",
    phone: "608-265-5600",
    option: "9",
    url: "tel:+16082655600",
    officialUrl: "https://uhs.wisc.edu/call-for-help/",
    type: "crisis",
  }),
  Object.freeze({
    id: "988",
    name: "988 Suicide & Crisis Lifeline",
    match: "National call or text support for suicide, mental-health, or substance-use crisis.",
    action: "Call or text 988.",
    phone: "988",
    url: "tel:988",
    type: "crisis",
  }),
  Object.freeze({
    id: "uhs-medical",
    name: "UHS 24/7 Medical Advice",
    match: "A non-emergency medical concern or uncertainty about where to get care.",
    action: "Call 608-265-5600 and choose option 1.",
    phone: "608-265-5600",
    option: "1",
    url: "tel:+16082655600",
    officialUrl: "https://uhs.wisc.edu/call-for-help/",
    type: "medical",
  }),
  Object.freeze({
    id: "uhs-access",
    name: "UHS Mental Health Access Appointment",
    match: "Counseling, psychiatry, eating concerns, substance-use concerns, or help finding an appropriate mental-health service.",
    action: "Call 608-265-5600 and choose option 2. An Access Appointment is a 20–25 minute phone call with a mental-health provider.",
    phone: "608-265-5600",
    option: "2",
    url: "tel:+16082655600",
    officialUrl: "https://www.uhs.wisc.edu/mental-health/appointment/",
    type: "mental-health",
  }),
  Object.freeze({
    id: "basic-needs",
    name: "Basic Needs Student Support",
    match: "Food, housing, health insurance, clothing, technology, child or family care, employment, transportation, or emergency-funding needs.",
    action: "Open the Basic Needs site, email basic.needs@finaid.wisc.edu, or submit the Basic Needs Request.",
    email: "basic.needs@finaid.wisc.edu",
    url: "https://basicneeds.students.wisc.edu/",
    requestUrl: "https://basicneeds.students.wisc.edu/basic-needs-request/",
    type: "basic-needs",
  }),
  Object.freeze({
    id: "open-seat",
    name: "The Open Seat Food Pantry",
    match: "Free groceries, fresh produce, shelf-stable food, snacks, or hygiene products for a UW–Madison student.",
    action: "Any UW–Madison student is eligible. Check the official page for current hours and make an appointment before visiting the pantry at 333 East Campus Mall, 3rd floor, Room 3136.",
    address: "333 East Campus Mall, 3rd floor, Room 3136",
    url: "https://basicneeds.students.wisc.edu/the-open-seat/",
    type: "food",
  }),
  Object.freeze({
    id: "food-resources",
    name: "UW–Madison Food Resources",
    match: "Finding campus or Madison-area food options, FoodShare guidance, BadgerFare, or other food-access support.",
    action: "Use the official food-resources page for current options and eligibility details.",
    url: "https://basicneeds.students.wisc.edu/food-resources/",
    type: "food",
  }),
  Object.freeze({
    id: "osas",
    name: "Office of Student Assistance and Support (OSAS)",
    match: "Uncertainty about where to start; personal, academic, attendance, health, safety, conduct, reporting, or practical concerns.",
    action: "Call 608-263-5700, email osas@studentaffairs.wisc.edu, or visit 70 Bascom Hall. Check the official page for current drop-in hours.",
    phone: "608-263-5700",
    email: "osas@studentaffairs.wisc.edu",
    address: "70 Bascom Hall, 500 Lincoln Drive",
    url: "https://osas.wisc.edu/contact-us/",
    type: "navigation",
  }),
  Object.freeze({
    id: "uwpd-non-emergency",
    name: "UW–Madison Police Department non-emergency line",
    match: "A police or campus-safety concern that is not an immediate emergency.",
    action: "Call 608-264-2677. Call 911 instead for an emergency or immediate danger.",
    phone: "608-264-2677",
    url: "tel:+16082642677",
    officialUrl: "https://osas.wisc.edu/contact-us/",
    type: "safety",
  }),
  Object.freeze({
    id: "survivor-services",
    name: "UHS Survivor Services",
    match: "Sexual assault, dating or domestic violence, stalking, or a need for confidential survivor support and options.",
    action: "Open UHS Survivor Services. For campus survivor support call 608-265-6389; for 24-hour RCC support call or text 608-251-7273; for 24/7 DAIS support call 608-251-4445.",
    phone: "608-265-6389",
    url: "https://www.uhs.wisc.edu/survivor-services/",
    type: "survivor-support",
  }),
]);

function resourceDirectoryText() {
  return UW_MADISON_RESOURCES.map((resource) => {
    const details = [
      `RESOURCE: ${resource.name}`,
      `USE WHEN: ${resource.match}`,
      `ACTION: ${resource.action}`,
      resource.url?.startsWith("http") ? `OFFICIAL URL: ${resource.url}` : null,
      resource.officialUrl ? `OFFICIAL URL: ${resource.officialUrl}` : null,
      resource.requestUrl ? `REQUEST URL: ${resource.requestUrl}` : null,
      resource.email ? `EMAIL: ${resource.email}` : null,
      resource.address ? `LOCATION: ${resource.address}` : null,
    ].filter(Boolean);
    return details.join("\n");
  }).join("\n\n");
}

export const UW_MADISON_RESOURCE_CONTEXT = `UW–MADISON RESOURCE-AWARE MODE

You are serving chat.uwmadison.stabilize.info, an independent Stabilize experience for the UW–Madison community. This project is not affiliated with, operated by, or endorsed by the University of Wisconsin–Madison.

The directory below is trusted application-supplied routing information, verified against official UW–Madison pages on August 13, 2026. Use it whenever the user's need matches a listed resource. Give the exact resource name, phone option, email, and official link that materially helps. Do not invent services, hours, eligibility, wait times, or outcomes. Details such as pantry hours and appointment availability can change; direct the user to the official page to confirm them. Never claim that you contacted a resource or that UW–Madison can see this conversation. Distinguish UW resources from national or community resources. The useful outcome is often leaving chat for food, care, a safe person, a campus office, or another real-world next step.

${resourceDirectoryText()}`;

const CAMPUS_SYSTEM_PROMPT = `${COPY.model.systemPrompt}\n\n${UW_MADISON_RESOURCE_CONTEXT}`;

const CAMPUS_FIXED_ROUTES = Object.freeze({
  MEDICAL_EMERGENCY: Object.freeze({
    reply:
      "Call 911 or go to the nearest emergency department now. Do not wait for this chat. If someone is nearby, tell them what happened and stay with them. For a non-emergency medical concern, UHS provides 24/7 medical advice at 608-265-5600, option 1.",
    showEmergency: true,
    awaitingSafetyAnswer: false,
  }),
  IMMEDIATE_DANGER: Object.freeze({
    reply:
      "Move toward a safe person or staffed place now. Call 911 if an attempt, overdose, serious injury, or immediate danger may be happening. UW–Madison UHS has 24/7 mental-health crisis support at 608-265-5600, option 9. You can also call or text 988. Tell someone nearby: “I may not be safe alone right now. Please stay with me.”",
    showEmergency: true,
    awaitingSafetyAnswer: false,
  }),
  SAFETY_UNCLEAR: Object.freeze({
    reply:
      "I want to check one thing before we do anything else: might you hurt yourself in the next few hours? Reply yes, no, or unsure. If danger is immediate, call 911. UW–Madison UHS crisis support is available 24/7 at 608-265-5600, option 9, and you can call or text 988.",
    showEmergency: false,
    awaitingSafetyAnswer: true,
  }),
  UNSAFE_SHELTER: Object.freeze({
    reply:
      "Move toward a safe, staffed place now—a trusted person, shelter, emergency department, fire station, or another public place with staff. Call 911 if someone is threatening or hurting you. For UW–Madison housing and basic-needs navigation, use Basic Needs Student Support at https://basicneeds.students.wisc.edu/ or OSAS at 608-263-5700; check their official pages for current availability.",
    showEmergency: true,
    awaitingSafetyAnswer: false,
  }),
  MEDICATION_CHANGE: Object.freeze({
    reply:
      "I can’t make a personalized medication-change plan. Follow the label or your clinician’s instructions and contact your pharmacist or prescriber before changing the dose. UW–Madison students can call UHS 24/7 medical advice at 608-265-5600, option 1. If there may be an overdose, severe reaction, severe withdrawal, breathing trouble, unconsciousness, or rapid worsening, call 911 or seek urgent medical care.",
    showEmergency: false,
    awaitingSafetyAnswer: false,
  }),
  MEDICATION_ACCESS: Object.freeze({
    reply:
      "This is a medication-access problem, not a willpower problem. Contact your pharmacy, prescriber, clinic, or support staff and say what medication you need, when the last dose was, and whether symptoms are worsening. UW–Madison students can call UHS 24/7 medical advice at 608-265-5600, option 1. Don’t double or improvise a dose unless the label or a clinician tells you to.",
    showEmergency: false,
    awaitingSafetyAnswer: false,
  }),
});

class CampusRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "CampusRequestError";
    this.status = status;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function apiHeaders(extra = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

function pageHeaders(contentType = "text/html; charset=utf-8") {
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self' blob:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: apiHeaders(extraHeaders),
  });
}

function textResponse(body, contentType, status = 200) {
  return new Response(body, {
    status,
    headers: pageHeaders(contentType),
  });
}

function methodNotAllowed(allow) {
  const headers = pageHeaders("text/plain; charset=utf-8");
  headers.set("Allow", allow);
  return new Response("Method not allowed.", {
    status: 405,
    headers,
  });
}

function sameOriginOrNonBrowser(request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = String(request.headers.get("origin") || "").trim();
  const fetchSite = String(request.headers.get("sec-fetch-site") || "")
    .trim()
    .toLowerCase();
  if (origin && origin !== "null" && origin !== requestOrigin) return false;
  return !fetchSite || ["same-origin", "none"].includes(fetchSite);
}

async function readBoundedJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new CampusRequestError(413, "Request body is too large.");
  }
  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel("Request body is too large.");
        throw new CampusRequestError(413, "Request body is too large.");
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

  try {
    return JSON.parse(new TextDecoder().decode(bytes) || "{}");
  } catch {
    throw new CampusRequestError(400, "Invalid JSON.");
  }
}

function latestUserText(body) {
  const direct = String(body?.message || "").trim();
  if (direct) return direct;
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const latest = [...messages]
    .reverse()
    .find((message) => message?.role === "user");
  return String(latest?.content || "").trim();
}

function modelMessages(body, latestText) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const normalized = messages
    .filter((message) => message && ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "")
        .trim()
        .slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.content)
    .slice(-MAX_MESSAGES);

  const latest = normalized.at(-1);
  if (latest?.role !== "user" || latest.content !== latestText) {
    normalized.push({ role: "user", content: latestText });
  }
  return normalized.slice(-MAX_MESSAGES);
}

function routeInstruction(route) {
  return `${COPY.model.memoryInstruction}\n\n${COPY.model.routeInstruction(route)}\n\nFor a matching UW–Madison need, include one primary resource and at most one backup unless safety requires more. Give the direct contact or official URL, not a generic suggestion to search.`;
}

function responseText(body) {
  const output = Array.isArray(body?.output) ? body.output : [];
  return output
    .filter((item) => item?.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter(
      (block) =>
        block?.type === "output_text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function validateReply(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const unsafeMedication =
    /\b(?:stop taking|double (?:your|the) dose|take \d+(?:\.\d+)? ?mg|increase (?:your|the) dose|reduce (?:your|the) dose)\b/i;
  const falseAssurance =
    /\b(?:i can keep you safe|you are definitely safe|you don't need human help)\b/i;
  return unsafeMedication.test(text) || falseAssurance.test(text) ? null : text;
}

function openAIConfig(env) {
  const apiKey = String(env.OPENAI_API_KEY || "");
  if (!apiKey) {
    throw new CampusRequestError(503, "The UW–Madison chat is temporarily unavailable.");
  }
  const model = String(
    env.FREE_PLAN_PRIMARY_MODEL || env.OPENAI_MODEL || "gpt-5.4",
  ).trim();
  if (!/^[A-Za-z0-9._:-]+$/.test(model)) {
    throw new CampusRequestError(503, "The UW–Madison chat is temporarily unavailable.");
  }
  const requestedTier = String(env.OPENAI_SERVICE_TIER || "fast")
    .trim()
    .toLowerCase();
  const serviceTier = ALLOWED_SERVICE_TIERS.has(requestedTier)
    ? requestedTier
    : "default";
  return { apiKey, model, serviceTier };
}

async function generateCampusReply(messages, route, env) {
  const { apiKey, model, serviceTier } = openAIConfig(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const clientRequestId = crypto.randomUUID();

  let response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Client-Request-Id": clientRequestId,
      },
      body: JSON.stringify({
        model,
        service_tier: serviceTier,
        reasoning: { effort: "none" },
        max_output_tokens: OUTPUT_TOKEN_LIMIT,
        text: { verbosity: "low" },
        instructions: `${CAMPUS_SYSTEM_PROMPT}\n\n${routeInstruction(route)}`,
        input: messages,
        store: true,
      }),
      signal: controller.signal,
    });
  } catch {
    throw new CampusRequestError(
      controller.signal.aborted ? 504 : 503,
      controller.signal.aborted
        ? "The UW–Madison chat took too long to reply. Try again."
        : "The UW–Madison chat could not reach the AI service. Try again.",
    );
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const status = response.status === 429 ? 429 : 503;
    const error = new CampusRequestError(
      status,
      status === 429
        ? "The UW–Madison chat is busy. Try again shortly."
        : "The UW–Madison chat could not complete that request. Try again.",
    );
    error.retryAfter = retryAfter;
    throw error;
  }

  const reply = validateReply(responseText(body));
  if (!reply) {
    throw new CampusRequestError(
      502,
      "The UW–Madison chat could not complete a reliable reply. Try again.",
    );
  }
  return { reply, model };
}

function resourceCardsMarkup() {
  const cards = [
    {
      label: "UHS crisis · option 9",
      href: "tel:+16082655600",
      detail: "608-265-5600 · 24/7",
    },
    {
      label: "Basic Needs",
      href: "https://basicneeds.students.wisc.edu/",
      detail: "Food, housing, essentials",
    },
    {
      label: "OSAS",
      href: "https://osas.wisc.edu/contact-us/",
      detail: "Not sure where to start",
    },
    {
      label: "UHS Access · option 2",
      href: "https://www.uhs.wisc.edu/mental-health/appointment/",
      detail: "Mental-health care",
    },
  ];
  return cards
    .map(
      ({ label, href, detail }) => `<a class="uw-resource-card" href="${escapeHtml(href)}"${
        href.startsWith("http") ? ' rel="noreferrer"' : ""
      }><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></a>`,
    )
    .join("");
}

function campusPage() {
  let html = renderPage({
    signedIn: false,
    googleSignInAvailable: false,
    authNotice: "",
  });

  const title = "Stabilize for UW–Madison — Resource-Aware Chat";
  const description =
    "An independent Stabilize chat that routes UW–Madison students toward verified campus and crisis resources.";
  const banner = `<section class="uw-chat-banner" aria-labelledby="uw-chat-banner-heading">
    <div class="uw-chat-banner-copy">
      <p class="uw-chat-kicker">Independent UW–Madison resource-aware chat</p>
      <h2 id="uw-chat-banner-heading">Campus help is built into the conversation.</h2>
      <p>Stabilize can match food, housing, health, academic, safety, and other practical needs to a verified UW–Madison doorway. It is not affiliated with, operated by, or endorsed by UW–Madison.</p>
    </div>
    <div class="uw-emergency-links" aria-label="Urgent support">
      <a href="tel:911"><strong>911</strong><span>Emergency</span></a>
      <a href="tel:+16082655600"><strong>UHS option 9</strong><span>24/7 crisis</span></a>
      <a href="tel:988"><strong>988</strong><span>Call or text</span></a>
    </div>
    <details class="uw-resource-disclosure">
      <summary>Open quick UW resources</summary>
      <div class="uw-resource-cards">${resourceCardsMarkup()}</div>
      <div class="uw-resource-prompts" aria-label="Start with a common need">
        <button type="button" data-example-message="I need food today. Help me choose the best UW–Madison resource and the first step.">I need food today</button>
        <button type="button" data-example-message="I may not have stable housing. Help me find the right UW–Madison resource and one immediate step.">I need housing help</button>
        <button type="button" data-example-message="I need mental-health support at UW–Madison. Help me choose between urgent and nonurgent options.">I need mental-health support</button>
        <button type="button" data-example-message="I am a UW–Madison student and I am not sure where to start. Help me choose one campus doorway.">I’m not sure where to start</button>
      </div>
      <p class="uw-resource-update-note">Hours, appointment availability, and program details can change. Confirm them on the linked official UW pages.</p>
    </details>
  </section>`;

  html = html
    .replace(
      '<html lang="en" data-signed-in="false">',
      '<html lang="en" data-signed-in="false" data-campus-chat="uwmadison">',
    )
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      '<link rel="canonical" href="https://stabilize.info/" />',
      `<link rel="canonical" href="${CHAT_UW_MADISON_ORIGIN}/" />`,
    )
    .replace(
      '<meta property="og:title" content="Stabilize — One Safe, Practical Next Step" />',
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*" \/>/,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      '<meta property="og:url" content="https://stabilize.info/" />',
      `<meta property="og:url" content="${CHAT_UW_MADISON_ORIGIN}/" />`,
    )
    .replace(
      '"url":"https://stabilize.info/"',
      `"url":"${CHAT_UW_MADISON_ORIGIN}/"`,
    )
    .replace(
      '<meta name="twitter:title" content="Stabilize — One Safe, Practical Next Step" />',
      `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*" \/>/,
      `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      "</head>",
      '    <link rel="stylesheet" href="/uwmadison-chat.css?v=20260813-1" />\n  </head>',
    )
    .replace(
      /<nav class="menu-links" aria-label="Site pages">[\s\S]*?<\/nav>/,
      `<nav class="menu-links" aria-label="Site pages">
        <a href="https://uwmadison.stabilize.info/">UW–Madison home</a>
        <a href="https://uwmadison.stabilize.info/#campus-resources">UW resources</a>
        <a href="https://stabilize.info/how-it-works.html">How it works</a>
        <a href="https://stabilize.info/safety.html">Safety and limits</a>
        <a href="https://stabilize.info/privacy.html">Privacy</a>
      </nav>`,
    )
    .replace(
      '<a class="menu-admin-link" href="/admin/impact" aria-label="Open admin dashboard" rel="nofollow">Admin</a>',
      '<a class="menu-admin-link" href="https://uwmadison.stabilize.info/">UW resource page</a>',
    )
    .replace(
      '<main class="chat-card" aria-label="Stabilize AI check-in">',
      `${banner}\n      <main class="chat-card" aria-label="UW–Madison resource-aware Stabilize chat">`,
    )
    .replace(
      '<h1 id="seo-heading">Get unstuck.</h1>',
      '<h1 id="seo-heading">UW–Madison support, one step at a time.</h1>',
    )
    .replace(
      /<p class="product-promise">[\s\S]*?<\/p>/,
      '<p class="product-promise">Tell me what is blocking the next step. I’ll help make it smaller and point to the most relevant UW–Madison resource when one fits.</p>',
    )
    .replace(
      'placeholder="What is happening?"',
      'placeholder="What is happening at UW–Madison?"',
    );

  return html;
}

function robotsText() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${CHAT_UW_MADISON_ORIGIN}/sitemap.xml\n`;
}

function sitemapText() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${CHAT_UW_MADISON_ORIGIN}/</loc>\n    <lastmod>2026-08-13</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`;
}

async function chatResponse(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, {
      Allow: "POST",
    });
  }
  if (!sameOriginOrNonBrowser(request)) {
    return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  }

  const body = await readBoundedJson(request);
  const latestText = latestUserText(body);
  if (!latestText) throw new CampusRequestError(400, "Please enter a message.");
  if (latestText.length > MAX_MESSAGE_CHARS) {
    throw new CampusRequestError(
      400,
      "Please keep your message to 4,000 characters or fewer.",
    );
  }

  const route = classifyInput(latestText, {
    awaitingSafetyAnswer: body?.awaitingSafetyAnswer === true,
  });
  const fixed = CAMPUS_FIXED_ROUTES[route];
  if (fixed) return jsonResponse({ route, ...fixed });

  const messages = modelMessages(body, latestText);
  const generated = await generateCampusReply(messages, route, env);
  return jsonResponse(
    {
      route,
      reply: generated.reply,
      showEmergency: false,
      awaitingSafetyAnswer: false,
    },
    200,
    {
      "X-Stabilize-Campus": "uwmadison",
      "X-Stabilize-Model-Selected": generated.model,
    },
  );
}

async function staticAssetResponse(request, env) {
  const incoming = new URL(request.url);
  const assetUrl = new URL(incoming.pathname + incoming.search, "https://stabilize.info");
  const headers = new Headers(request.headers);
  headers.delete("host");
  return env.ASSETS.fetch(
    new Request(assetUrl, {
      method: request.method,
      headers,
    }),
  );
}

export async function uwMadisonChatResponse(request, env, _ctx) {
  const url = new URL(request.url);
  try {
    if (url.protocol !== "https:") {
      const secure = new URL(request.url);
      secure.protocol = "https:";
      return new Response(null, {
        status: 308,
        headers: { Location: secure.toString() },
      });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (!["GET", "HEAD"].includes(request.method)) {
        return methodNotAllowed("GET, HEAD");
      }
      return new Response(request.method === "HEAD" ? null : campusPage(), {
        status: 200,
        headers: pageHeaders(),
      });
    }

    if (url.pathname === "/api/chat") {
      return await chatResponse(request, env);
    }

    if (url.pathname === "/api/conversation/new") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed." }, 405, {
          Allow: "POST",
        });
      }
      if (!sameOriginOrNonBrowser(request)) {
        return jsonResponse({ error: "Cross-origin request rejected." }, 403);
      }
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed." }, 405, {
          Allow: "GET",
        });
      }
      const configured = Boolean(String(env.OPENAI_API_KEY || ""));
      return jsonResponse(
        {
          ok: configured,
          experience: "uwmadison-resource-aware-chat",
          resourceDirectory: "hardcoded-server-side",
          resourceVerifiedDate: "2026-08-13",
          resourceCount: UW_MADISON_RESOURCES.length,
        },
        configured ? 200 : 503,
      );
    }

    if (url.pathname === "/robots.txt") {
      if (!["GET", "HEAD"].includes(request.method)) {
        return methodNotAllowed("GET, HEAD");
      }
      return textResponse(
        request.method === "HEAD" ? null : robotsText(),
        "text/plain; charset=utf-8",
      );
    }

    if (url.pathname === "/sitemap.xml") {
      if (!["GET", "HEAD"].includes(request.method)) {
        return methodNotAllowed("GET, HEAD");
      }
      return textResponse(
        request.method === "HEAD" ? null : sitemapText(),
        "application/xml; charset=utf-8",
      );
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Not found." }, 404);
    }

    return await staticAssetResponse(request, env);
  } catch (error) {
    if (error instanceof CampusRequestError) {
      const headers = error.retryAfter
        ? { "Retry-After": String(error.retryAfter) }
        : {};
      return jsonResponse({ error: error.message }, error.status, headers);
    }

    const reference =
      "UWM-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    console.error(
      JSON.stringify({
        event: "uw_madison_chat_failed",
        error: error instanceof Error ? error.name : "UnknownError",
        path: url.pathname,
        reference,
      }),
    );
    return jsonResponse(
      {
        error: "The UW–Madison chat is temporarily unavailable.",
        reference,
      },
      503,
    );
  }
}

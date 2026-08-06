import worker from "./memory-prompt-worker.js";
import { readAuthSession } from "./auth.js";
import {
  boundedNumber,
  hashIdentifier,
  impactStub,
  jsonResponse,
  readBoundedJson,
  readBoundedResponseText,
  safeToken,
  sameOriginRequest,
  schedule,
} from "./impact-shards.js";

const IMPACT_ASSET_VERSION = "20260806-feedback-4";
const IMPACT_PROMPT_VERSION = "next-step-v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_SCHEMAS = {
  next_step_reported: {
    promptVersion: "next-step-v1",
    values: new Set(["shown", "yes", "partly", "no"]),
  },
  conversation_help_reported: {
    promptVersion: "conversation-help-v1",
    values: new Set(["shown", "yes", "partly", "no"]),
  },
};

function cleanEventPayload(body) {
  const eventId = String(body?.eventId || "");
  const sessionId = String(body?.sessionId || "");
  const browserId = String(body?.browserId || "");
  const turnId = String(body?.turnId || "");
  const eventType = String(body?.event || "");
  const eventValue = String(body?.value || "");
  const promptVersion = String(body?.promptVersion || "");
  const schema = EVENT_SCHEMAS[eventType];

  if (
    !UUID_PATTERN.test(eventId) ||
    !UUID_PATTERN.test(sessionId) ||
    !UUID_PATTERN.test(browserId) ||
    !UUID_PATTERN.test(turnId) ||
    !schema ||
    !schema.values.has(eventValue) ||
    promptVersion !== schema.promptVersion
  ) {
    return null;
  }

  return {
    eventId,
    sessionId,
    browserId,
    turnId,
    eventType,
    eventValue,
    promptVersion,
  };
}

export async function impactEventResponse(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!sameOriginRequest(request)) {
    return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  }

  const body = cleanEventPayload(await readBoundedJson(request));
  if (!body) return jsonResponse({ error: "Invalid impact event." }, 400);

  const [sessionHash, browserHash] = await Promise.all([
    hashIdentifier(env, "impact-session", body.sessionId),
    hashIdentifier(env, "impact-browser", body.browserId),
  ]);
  if (!sessionHash || !browserHash) {
    return jsonResponse({ error: "Impact measurement is unavailable." }, 503);
  }

  const store = impactStub(env, browserHash);
  if (!store || typeof store.recordEvent !== "function") {
    return jsonResponse({ error: "Impact measurement is unavailable." }, 503);
  }

  const result = await store.recordEvent({
    eventId: body.eventId,
    occurredAt: Date.now(),
    sessionHash,
    browserHash,
    turnId: body.turnId,
    eventType: body.eventType,
    eventValue: body.eventValue,
    promptVersion: body.promptVersion,
  });

  if (!result?.accepted) {
    const status = result?.reason === "rate" ? 429 : 409;
    return jsonResponse({ accepted: false }, status);
  }
  return jsonResponse({ accepted: true }, 202);
}

function parseNdjson(text) {
  let route = "UNKNOWN";
  let status = "completed";
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.route) route = safeToken(event.route, 64) || route;
      if (event?.type === "error") status = "error";
    } catch {
      status = "error";
    }
  }
  return { route, status };
}

async function parseChatResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/x-ndjson")) {
    return parseNdjson(
      await readBoundedResponseText(
        response,
        256_000,
        "Chat response exceeded the analytics limit.",
      ),
    );
  }
  if (contentType.includes("application/json")) {
    const text = await readBoundedResponseText(
      response,
      256_000,
      "Chat response exceeded the analytics limit.",
    );
    try {
      const body = JSON.parse(text || "{}");
      return {
        route: safeToken(body?.route, 64) || "UNKNOWN",
        status: response.ok && !body?.error ? "completed" : "error",
      };
    } catch {
      return { route: "UNKNOWN", status: "error" };
    }
  }
  return { route: "UNKNOWN", status: response.ok ? "completed" : "error" };
}

export async function chatResponse(request, env, ctx) {
  const startedAt = Date.now();
  const turnId = crypto.randomUUID();
  const sessionId = request.headers.get("x-stabilize-session-id") || "";
  const browserId = request.headers.get("x-stabilize-browser-id") || "";
  const conversationId =
    request.headers.get("x-stabilize-conversation-id") || "";
  const [sessionHash, browserHash, conversationHash, authSession] =
    await Promise.all([
      hashIdentifier(env, "impact-session", sessionId),
      hashIdentifier(env, "impact-browser", browserId),
      hashIdentifier(env, "impact-conversation", conversationId),
      readAuthSession(request, env),
    ]);

  const response = await worker.fetch(request, env, ctx);
  const store = impactStub(env, browserHash);

  if (
    store &&
    sessionHash &&
    browserHash &&
    typeof store.startChat === "function" &&
    typeof store.finishChat === "function"
  ) {
    const analyticsCopy = response.clone();
    const task = (async () => {
      await store.startChat({
        turnId,
        occurredAt: startedAt,
        sessionHash,
        browserHash,
        conversationHash,
        accountType: authSession ? "signed_in" : "guest",
        model: safeToken(env?.OPENAI_MODEL, 128) || "unknown",
        estimatedCostMicros: boundedNumber(
          env?.IMPACT_ESTIMATED_CHAT_COST_MICROS,
          0,
          100_000_000,
          0,
        ),
      });
      let result;
      try {
        result = await parseChatResponse(analyticsCopy);
      } catch {
        result = { route: "UNKNOWN", status: "error" };
      }
      await store.finishChat({
        turnId,
        route: result.route,
        status: result.status,
        httpStatus: response.status,
        totalResponseMs: Date.now() - startedAt,
      });
    })();
    schedule(ctx, task);
  }

  const headers = new Headers(response.headers);
  headers.set("X-Stabilize-Turn-Id", turnId);
  headers.set("X-Stabilize-Impact-Version", IMPACT_PROMPT_VERSION);
  headers.delete("content-length");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function enhanceHomePage(response, request) {
  if (request.method === "HEAD" || !response.ok) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await readBoundedResponseText(
    response,
    2_000_000,
    "Home page exceeded the enhancement limit.",
  );
  if (!html.includes('href="/impact.css')) {
    html = html.replace(
      "</head>",
      `    <link rel="stylesheet" href="/impact.css?v=${IMPACT_ASSET_VERSION}" />\n  </head>`,
    );
  }
  if (!html.includes('href="/message-feedback.css')) {
    html = html.replace(
      "</head>",
      `    <link rel="stylesheet" href="/message-feedback.css?v=${IMPACT_ASSET_VERSION}" />\n  </head>`,
    );
  }
  if (!html.includes('src="/impact.js')) {
    html = html.replace(
      "</body>",
      `    <script type="module" src="/impact.js?v=${IMPACT_ASSET_VERSION}"></script>\n  </body>`,
    );
  }
  if (!html.includes('src="/message-feedback.js')) {
    html = html.replace(
      "</body>",
      `    <script type="module" src="/message-feedback.js?v=${IMPACT_ASSET_VERSION}"></script>\n  </body>`,
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

export async function enhancePrivacyPage(response, request) {
  if (request.method === "HEAD" || !response.ok) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await readBoundedResponseText(
    response,
    2_000_000,
    "Privacy page exceeded the enhancement limit.",
  );
  if (!html.includes('id="outcome-measurement"')) {
    const section = `<h2 id="outcome-measurement">Outcome and response measurement</h2>
      <p>
        On the web, Stabilize may ask optional structured questions after a response.
        The outcome check asks “Did you choose a next step?” and records only shown,
        yes, partly, or no. After New conversation is selected, a separate non-blocking
        check may ask whether the prior conversation helped the user move forward and
        records the same four structured states. The response-quality control records
        whether a response was shown, marked helpful, or marked not helpful, plus an
        optional reason code. A user may also submit up to 500 characters of optional
        details; those details are stored privately and may be reviewed to improve
        Stabilize. Do not include private or identifying information.
      </p>
      <p>
        The impact store also keeps broad route, completion, configured cost, and timing
        metadata, plus one-way hashes of random browser, tab, and conversation identifiers.
        It does not place the user's message or the assistant's reply in impact analytics.
        The browser identifier rotates after 30 days, the tab identifier ends with the tab,
        and the conversation identifier rotates after New conversation succeeds. Impact
        and response-feedback records are designed to expire after 180 days. The private
        dashboard is for aggregate product and sustainability review, not individual monitoring.
      </p>

      `;
    html = html.replace(
      '<h2>Public feedback</h2>',
      `${section}<h2>Public feedback</h2>`,
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

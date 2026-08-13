import {
  hashIdentifier,
  impactStub,
  jsonResponse,
  readBoundedJson,
  sameOriginRequest,
  safeToken,
} from "./impact-shards.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATINGS = new Set(["shown", "up", "down"]);
const REASONS = new Set([
  "clear_answer",
  "useful_next_step",
  "felt_relevant",
  "helped_me_decide",
  "helped_me_feel_steadier",
  "did_not_answer",
  "misunderstood_me",
  "too_generic",
  "too_long",
  "inaccurate",
  "repetitive",
  "unsafe_or_concerning",
  "technical_problem",
  "other",
]);
const MAX_COMMENT_CHARS = 500;

function cleanComment(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_COMMENT_CHARS);
}

function cleanPayload(body) {
  const eventId = String(body?.eventId || "");
  const sessionId = String(body?.sessionId || "");
  const browserId = String(body?.browserId || "");
  const turnId = String(body?.turnId || "");
  const rating = safeToken(body?.rating, 16);
  const reason = safeToken(body?.reason, 64);
  const comment = cleanComment(body?.comment);

  if (
    !UUID_PATTERN.test(eventId) ||
    !UUID_PATTERN.test(sessionId) ||
    !UUID_PATTERN.test(browserId) ||
    !UUID_PATTERN.test(turnId) ||
    !RATINGS.has(rating) ||
    (reason && !REASONS.has(reason)) ||
    (rating === "shown" && (reason || comment))
  ) {
    return null;
  }

  return {
    eventId,
    sessionId,
    browserId,
    turnId,
    rating,
    reason,
    comment,
  };
}

export async function messageFeedbackResponse(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!sameOriginRequest(request)) {
    return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  }

  const body = cleanPayload(await readBoundedJson(request));
  if (!body) return jsonResponse({ error: "Invalid message feedback." }, 400);

  const [sessionHash, browserHash] = await Promise.all([
    hashIdentifier(env, "impact-session", body.sessionId),
    hashIdentifier(env, "impact-browser", body.browserId),
  ]);
  if (!sessionHash || !browserHash) {
    return jsonResponse({ error: "Message feedback is unavailable." }, 503);
  }

  const store = impactStub(env, browserHash);
  if (!store || typeof store.recordMessageFeedback !== "function") {
    return jsonResponse({ error: "Message feedback is unavailable." }, 503);
  }

  const result = await store.recordMessageFeedback({
    eventId: body.eventId,
    occurredAt: Date.now(),
    sessionHash,
    browserHash,
    turnId: body.turnId,
    rating: body.rating,
    reason: body.reason || null,
    comment: body.comment || null,
  });

  if (!result?.accepted) {
    if (result?.reason === "rate") {
      return jsonResponse({ accepted: false }, 429, { "Retry-After": "3600" });
    }
    if (result?.reason === "turn") {
      return jsonResponse({ accepted: false }, 409);
    }
    return jsonResponse({ accepted: false }, 400);
  }

  return jsonResponse(
    {
      accepted: true,
      updated: Boolean(result.updated),
      duplicate: Boolean(result.duplicate),
    },
    202,
  );
}

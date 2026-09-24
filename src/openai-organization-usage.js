import { usageTokens } from "./openai-budget-policy.js";

const USAGE_URL = "https://api.openai.com/v1/organization/usage/completions";
const DAY_MS = 86_400_000;
const MAX_PAGES = 5;
export const USAGE_MAX_AGE_MS = 15_000;

export function usageOrganization(env) {
  const organization = env?.OPENAI_ORGANIZATION_ID;
  const adminKey = env?.OPENAI_USAGE_ADMIN_KEY;
  if (typeof organization !== "string" || !/^org[-_][a-zA-Z0-9_-]{1,128}$/.test(organization) ||
      typeof adminKey !== "string" || !adminKey.trim()) {
    throw new Error("Organization usage credentials are not configured");
  }
  return organization;
}

export function freshOrganizationUsage(snapshot, organization, now = Date.now()) {
  return Boolean(snapshot && snapshot.organization === organization &&
    Number.isSafeInteger(snapshot.tokens) && snapshot.tokens >= 0 &&
    Number.isSafeInteger(snapshot.checkedAt) && snapshot.checkedAt <= now &&
    now - snapshot.checkedAt <= USAGE_MAX_AGE_MS &&
    snapshot.day === new Date(now).toISOString().slice(0, 10));
}

// No project, key, model, batch, or processing-tier filters: other applications
// share this organization's allowance. Subtotals (including cached input) are
// already included in input_tokens/output_tokens and must not be added again.
export async function readOrganizationUsage(env, { now = Date.now } = {}) {
  const organization = usageOrganization(env);
  const checkedAt = now();
  const start = Math.floor(checkedAt / DAY_MS) * DAY_MS / 1000;
  const end = start + DAY_MS / 1000;
  const signal = AbortSignal.timeout(8_000);
  const seenPages = new Set();
  let page, tokens = 0, previousEnd = start;
  for (let count = 0; count < MAX_PAGES; count++) {
    const url = new URL(USAGE_URL);
    url.search = new URLSearchParams({
      start_time: String(start), end_time: String(end), bucket_width: "1d", limit: "1",
      ...(page ? { page } : {}),
    }).toString();
    const response = await fetch(url.toString(), {
      method: "GET", redirect: "error", cache: "no-store", signal,
      headers: {
        Authorization: `Bearer ${env.OPENAI_USAGE_ADMIN_KEY.trim()}`,
        "OpenAI-Organization": organization, Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error("Organization usage is unavailable");
    const body = await response.json();
    if (body?.object !== "page" || !Array.isArray(body.data) || typeof body.has_more !== "boolean") {
      throw new Error("Invalid organization usage page");
    }
    for (const bucket of body.data) {
      if (bucket?.object !== "bucket" || !Array.isArray(bucket.results) ||
          !Number.isSafeInteger(bucket.start_time) || !Number.isSafeInteger(bucket.end_time) ||
          bucket.start_time < previousEnd || bucket.end_time <= bucket.start_time || bucket.end_time > end) {
        throw new Error("Invalid organization usage bucket");
      }
      previousEnd = bucket.end_time;
      for (const result of bucket.results) {
        const used = usageTokens(result);
        if (result?.object !== "organization.usage.completions.result" || used === null ||
            !Number.isSafeInteger(tokens + used)) throw new Error("Invalid organization usage total");
        tokens += used;
      }
    }
    if (!body.has_more) {
      const snapshot = { organization, day: new Date(checkedAt).toISOString().slice(0, 10), tokens, checkedAt };
      if (!freshOrganizationUsage(snapshot, organization, now())) throw new Error("Organization usage check expired");
      return snapshot;
    }
    if (typeof body.next_page !== "string" || !body.next_page || seenPages.has(body.next_page)) {
      throw new Error("Incomplete organization usage pagination");
    }
    seenPages.add(body.next_page);
    page = body.next_page;
  }
  throw new Error("Organization usage pagination exceeded its limit");
}

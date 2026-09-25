export const usageEnv = {
  OPENAI_ORGANIZATION_ID: "org-test-usage",
  OPENAI_USAGE_ADMIN_KEY: "test-usage-admin-key",
};
export const usageSnapshot = (now = Date.now(), tokens = 0) => ({
  organization: usageEnv.OPENAI_ORGANIZATION_ID,
  day: new Date(now).toISOString().slice(0, 10), checkedAt: now, tokens,
});
export function usagePage(url, input = 0, output = 0) {
  const query = new URL(url).searchParams;
  return { object: "page", has_more: false, next_page: null, data: [{
    object: "bucket", start_time: Number(query.get("start_time")), end_time: Number(query.get("end_time")),
    results: [{ object: "organization.usage.completions.result", input_tokens: input, output_tokens: output }],
  }] };
}

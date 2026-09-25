import { readFile, readdir, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

// npm's postapply:prompt-policy hook runs after the legacy generator pipeline.
// Those generators reorder the pipeline and recreate several request functions.
for (const path of ["src/index.js", "src/uw-madison-chat.js"]) {
  await update(path, (source) => {
    let next = source;
    if (!next.includes('from "./openai-budget-fetch.js"')) {
      next = 'import { budgetedOpenAIFetch } from "./openai-budget-fetch.js";\n' +
        'import { DAILY_TOKEN_LIMIT_CODE, TOKEN_BUDGET_UNAVAILABLE_CODE, DAILY_TOKEN_LIMIT_MESSAGE, TOKEN_BUDGET_UNAVAILABLE_MESSAGE } from "./openai-budget-policy.js";\n' + next;
    }
    next = next.replaceAll("await fetch(OPENAI_RESPONSES_URL, {", "await budgetedOpenAIFetch(OPENAI_RESPONSES_URL, {");
    next = next.replaceAll("signal: controller.signal,\n    });", "signal: controller.signal,\n    }, env);");
    if (path === "src/index.js") {
      next = next.replaceAll("payload, apiKey, timeoutMs, errorName)", "payload, apiKey, timeoutMs, errorName, env)");
      next = next.replace(/(\s+"OpenAI(?:Http|FallbackHttp|SummaryHttp|GuestSummaryHttp)Error",)\n(\s*)\);/g, "$1\n$2  env,\n$2);");
      if (!next.includes("  DAILY_TOKEN_LIMIT_CODE,\n")) {
        next = next.replace("const OPENAI_ACCOUNT_LIMIT_CODES = new Set([", "const OPENAI_ACCOUNT_LIMIT_CODES = new Set([\n  DAILY_TOKEN_LIMIT_CODE,\n  TOKEN_BUDGET_UNAVAILABLE_CODE,");
      }
      if (!next.includes("if (error.code === DAILY_TOKEN_LIMIT_CODE)")) {
        next = next.replace("function publicOpenAIError(error) {", `function publicOpenAIError(error) {
  if (error.code === DAILY_TOKEN_LIMIT_CODE) {
    return { status: 503, message: DAILY_TOKEN_LIMIT_MESSAGE, retryAfterSeconds: Math.ceil((86_400_000 - Date.now() % 86_400_000) / 1000) };
  }
  if (error.code === TOKEN_BUDGET_UNAVAILABLE_CODE) {
    return { status: 503, message: TOKEN_BUDGET_UNAVAILABLE_MESSAGE };
  }`);
      }
    } else if (!next.includes("body.error?.code === DAILY_TOKEN_LIMIT_CODE")) {
      next = next.replace("  if (!response.ok) {\n    const retryAfter", `  if (!response.ok) {
    if ([DAILY_TOKEN_LIMIT_CODE, TOKEN_BUDGET_UNAVAILABLE_CODE].includes(body.error?.code)) {
      const error = new CampusRequestError(503, body.error?.code === DAILY_TOKEN_LIMIT_CODE
        ? DAILY_TOKEN_LIMIT_MESSAGE : TOKEN_BUDGET_UNAVAILABLE_MESSAGE);
      error.retryAfter = response.headers.get("retry-after");
      throw error;
    }
    const retryAfter`);
    }
    if (next.includes("await fetch(OPENAI_RESPONSES_URL")) throw new Error("Unguarded OpenAI request");
    return next;
  });
}

await update("src/domain-router.js", (source) => source.includes('export { OpenAITokenBudget }')
  ? source : 'export { OpenAITokenBudget } from "./openai-token-budget.js";\n' + source);

await update("src/paid-worker.js", (source) => {
  if (source.includes('data-free-tokens-only="true"')) return source;
  const start = source.indexOf("async function injectBillingPage(");
  const end = source.indexOf("async function rootResponse(", start);
  const block = source.slice(start, end).replace("  const headers = new Headers(response.headers);", `  if (env.OPENAI_FREE_TOKENS_ONLY !== "false") {
    html = html.replaceAll("GPT-5.6 Fast", "GPT-5.6")
      .replace("<html ", '<html data-free-tokens-only="true" ')
      .replaceAll("/billing-client.js?v=20260808-account-preflight-1", "/billing-client.js?v=20260924-free-token-budget-1");
  }
  const headers = new Headers(response.headers);`);
  return source.slice(0, start) + block + source.slice(end);
});

await update("public/billing-client.js", (source) => {
  let next = source;
  if (!next.includes("function freeTokenModelCopy(")) {
    next = `function freeTokenModelCopy(text) {
  return document.documentElement.dataset.freeTokensOnly === "true"
    ? text.replaceAll("GPT-5.6 Fast", "GPT-5.6") : text;
}

` + next;
  }
  next = next.replace("const message = modelUsageCopy(usage);", "const message = freeTokenModelCopy(modelUsageCopy(usage));")
    .replace("const copy = accountBillingUsageCopy(preflight);", "const copy = freeTokenModelCopy(accountBillingUsageCopy(preflight));");
  if (!next.includes("notice.textContent = freeTokenModelCopy(notice.textContent);")) {
    const text = '    " GPT-5.6 Fast messages. Stabilize used GPT-5.4 for this message; it was still sent.";';
    next = next.replace(text, text + "\n  notice.textContent = freeTokenModelCopy(notice.textContent);");
  }
  return next;
});

await update("wrangler.jsonc", (source) => {
  const config = JSON.parse(source);
  if (!config.durable_objects.bindings.some((binding) => binding.name === "OPENAI_TOKEN_BUDGET")) {
    config.durable_objects.bindings.push({ name: "OPENAI_TOKEN_BUDGET", class_name: "OpenAITokenBudget" });
    config.migrations.push({ tag: "v5-token-budget", new_sqlite_classes: ["OpenAITokenBudget"] });
  }
  config.vars.OPENAI_FREE_TOKENS_ONLY = "true";
  config.vars.OPENAI_FREE_TOKEN_ALLOWANCE ??= "1000000";
  config.vars.OPENAI_FREE_TOKEN_DAILY_LIMIT ??= "900000";
  config.vars.OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED ??= "false";
  for (const secret of ["OPENAI_USAGE_ADMIN_KEY", "OPENAI_ORGANIZATION_ID"]) {
    if (!config.secrets.required.includes(secret)) config.secrets.required.push(secret);
  }
  return JSON.stringify(config, null, 2) + "\n";
});

// Existing provider/schema tests exercise the explicit rollback mode. Dedicated
// token-budget tests below exercise protection with real Durable Object storage.
for (const name of await readdir("test")) {
  if (!name.endsWith(".mjs") || name.includes("token-budget")) continue;
  await update(`test/${name}`, (source) => source.replace(
    /OPENAI_API_KEY: "test[^"\n]*"/g,
    (match, offset) => /^,\s*OPENAI_FREE_TOKENS_ONLY:/.test(source.slice(offset + match.length))
      ? match : match + ', OPENAI_FREE_TOKENS_ONLY: "false"',
  ));
}
console.log("Applied the shared complimentary-token budget to every OpenAI request.");

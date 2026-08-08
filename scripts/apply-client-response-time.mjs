import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Client response-time policy could not find ${label}.`);
  }
  return source.replace(before, after);
}

function insertBefore(source, marker, addition, uniqueMarker, label) {
  if (source.includes(uniqueMarker)) return source;
  const index = source.indexOf(marker);
  if (index < 0) {
    throw new Error(`Client response-time policy could not find ${label}.`);
  }
  return source.slice(0, index) + addition + source.slice(index);
}

function replaceBefore(source, startMarker, endMarker, replacement, label) {
  if (source.includes(replacement)) return source;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Client response-time policy could not replace ${label}.`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

await update("public/impact.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    'const IMPACT_ENDPOINT = "/api/impact-event";\n',
    'const IMPACT_ENDPOINT = "/api/impact-event";\n' +
      'const CLIENT_LATENCY_ENDPOINT = "/api/client-latency";\n' +
      'const CLIENT_LATENCY_VERSION = "browser-render-v1";\n',
    "the impact endpoint constants",
  );
  next = replaceRequired(
    next,
    "let latestTurn = null;\nlet activeConversationCard = null;\n",
    "let latestTurn = null;\nlet activeConversationCard = null;\nlet activeLatencyTurn = null;\n",
    "the active impact state",
  );

  const latencyHelpers = `function monotonicNow() {
  return typeof performance?.now === "function" ? performance.now() : Date.now();
}

function currentAssistantArticle() {
  const articles = document.querySelectorAll(
    "#chat-log .assistant-output",
  );
  const article = articles.item(articles.length - 1);
  return article instanceof HTMLElement ? article : null;
}

function afterNextPaint(callback) {
  if (typeof window.requestAnimationFrame !== "function") {
    window.setTimeout(callback, 0);
    return;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

function clientLatencyElapsed(measurement) {
  return Math.max(0, Math.round(monotonicNow() - measurement.startedAt));
}

async function postClientLatency(turn) {
  const measurement = turn?.clientLatency;
  if (
    !turn?.turnId ||
    !measurement ||
    !Number.isFinite(measurement.firstVisibleMs) ||
    !Number.isFinite(measurement.completeMs)
  ) {
    return undefined;
  }

  const payload = {
    sessionId: impactSessionId,
    browserId: impactBrowserId,
    turnId: turn.turnId,
    firstVisibleMs: measurement.firstVisibleMs,
    completeMs: measurement.completeMs,
    metricVersion: CLIENT_LATENCY_VERSION,
  };
  const request = () =>
    originalFetch(CLIENT_LATENCY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });

  try {
    for (const delay of [0, 300, 900]) {
      if (delay) {
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
      const response = await request();
      if (response.status !== 409) return response;
    }
  } catch {
    // Client timing is optional and must never interfere with the chat.
  }
  return undefined;
}

function queueClientLatencyPaint(turn, phase) {
  const measurement = turn?.clientLatency;
  if (!measurement || !measurement.eligible || measurement.reported) return;
  const flag = phase === "first" ? "firstPaintQueued" : "completePaintQueued";
  if (measurement[flag]) return;
  measurement[flag] = true;

  afterNextPaint(() => {
    measurement[flag] = false;
    if (
      !measurement.eligible ||
      measurement.reported ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const article = measurement.article;
    if (
      !(article instanceof HTMLElement) ||
      !article.isConnected ||
      article.classList.contains("error-output")
    ) {
      return;
    }

    const elapsed = clientLatencyElapsed(measurement);
    if (phase === "first") {
      if (measurement.firstVisibleMs === null) {
        measurement.firstVisibleMs = elapsed;
      }
      return;
    }

    if (
      article.classList.contains("thinking-output") ||
      article.classList.contains("streaming-output")
    ) {
      return;
    }
    if (measurement.firstVisibleMs === null) {
      measurement.firstVisibleMs = elapsed;
    }
    measurement.completeMs = Math.max(measurement.firstVisibleMs, elapsed);
    measurement.reported = true;
    if (activeLatencyTurn === turn) activeLatencyTurn = null;
    void postClientLatency(turn);
  });
}

function observeClientLatency() {
  const turn = activeLatencyTurn;
  const measurement = turn?.clientLatency;
  if (!measurement || !measurement.eligible || measurement.reported) return;
  const article = measurement.article;
  if (!(article instanceof HTMLElement) || !article.isConnected) return;
  if (article.classList.contains("error-output")) {
    measurement.eligible = false;
    return;
  }

  const text = String(article.textContent || "").trim();
  if (!text) return;
  if (article.classList.contains("streaming-output")) {
    queueClientLatencyPaint(turn, "first");
    return;
  }
  if (
    article.classList.contains("assistant-output") &&
    !article.classList.contains("thinking-output")
  ) {
    queueClientLatencyPaint(turn, "first");
    queueClientLatencyPaint(turn, "complete");
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") return;
  const measurement = activeLatencyTurn?.clientLatency;
  if (measurement) measurement.eligible = false;
});

`;
  next = insertBefore(
    next,
    "async function inspectChatResponse(response, turn) {\n",
    latencyHelpers,
    "function observeClientLatency() {\n",
    "the chat-response inspector",
  );

  next = replaceRequired(
    next,
    `  const [nextInput, nextInit] = withImpactHeaders(input, init);
  const response = await originalFetch(nextInput, nextInit);
  const turn = {
    turnId: response.headers.get("X-Stabilize-Turn-Id") || randomId(),
    route: "UNKNOWN",
    completed: false,
  };
  latestTurn = turn;
`,
    `  const latencyMeasurement = {
    startedAt: monotonicNow(),
    article: currentAssistantArticle(),
    eligible: document.visibilityState === "visible",
    firstVisibleMs: null,
    completeMs: null,
    firstPaintQueued: false,
    completePaintQueued: false,
    reported: false,
  };
  const [nextInput, nextInit] = withImpactHeaders(input, init);
  const response = await originalFetch(nextInput, nextInit);
  const turn = {
    turnId: response.headers.get("X-Stabilize-Turn-Id") || randomId(),
    route: "UNKNOWN",
    completed: false,
    clientLatency: latencyMeasurement,
  };
  latestTurn = turn;
  activeLatencyTurn = turn;
  observeClientLatency();
`,
    "the chat fetch wrapper",
  );

  next = replaceRequired(
    next,
    `const observer = new MutationObserver(queueOutcomeEnhancement);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["hidden"],
});
queueOutcomeEnhancement();
`,
    `function observeImpactChanges() {
  observeClientLatency();
  queueOutcomeEnhancement();
}

const observer = new MutationObserver(observeImpactChanges);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["hidden", "class"],
});
observeImpactChanges();
`,
    "the impact mutation observer",
  );
  return next;
});

await update("src/impact-events.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    'const IMPACT_ASSET_VERSION = "20260806-shareable-next-step-1";\n',
    'const IMPACT_ASSET_VERSION = "20260808-browser-response-time-1";\n',
    "the impact asset version",
  );
  next = replaceRequired(
    next,
    'const IMPACT_PROMPT_VERSION = "next-step-v1";\n',
    'const IMPACT_PROMPT_VERSION = "next-step-v1";\n' +
      'const CLIENT_LATENCY_VERSION = "browser-render-v1";\n' +
      'const MAX_CLIENT_LATENCY_MS = 600_000;\n',
    "the impact prompt version",
  );

  const endpoint = `function clientTiming(value) {
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < 0 ||
    number > MAX_CLIENT_LATENCY_MS
  ) {
    return null;
  }
  return Math.round(number);
}

function cleanClientLatencyPayload(body) {
  const sessionId = String(body?.sessionId || "");
  const browserId = String(body?.browserId || "");
  const turnId = String(body?.turnId || "");
  const firstVisibleMs = clientTiming(body?.firstVisibleMs);
  const completeMs = clientTiming(body?.completeMs);
  const metricVersion = String(body?.metricVersion || "");
  if (
    !UUID_PATTERN.test(sessionId) ||
    !UUID_PATTERN.test(browserId) ||
    !UUID_PATTERN.test(turnId) ||
    firstVisibleMs === null ||
    completeMs === null ||
    completeMs < firstVisibleMs ||
    metricVersion !== CLIENT_LATENCY_VERSION
  ) {
    return null;
  }
  return {
    sessionId,
    browserId,
    turnId,
    firstVisibleMs,
    completeMs,
    metricVersion,
  };
}

export async function clientLatencyResponse(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!sameOriginRequest(request)) {
    return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  }

  const body = cleanClientLatencyPayload(await readBoundedJson(request));
  if (!body) {
    return jsonResponse({ error: "Invalid client latency report." }, 400);
  }
  const [sessionHash, browserHash] = await Promise.all([
    hashIdentifier(env, "impact-session", body.sessionId),
    hashIdentifier(env, "impact-browser", body.browserId),
  ]);
  if (!sessionHash || !browserHash) {
    return jsonResponse({ error: "Impact measurement is unavailable." }, 503);
  }
  const store = impactStub(env, browserHash);
  if (!store || typeof store.recordClientLatency !== "function") {
    return jsonResponse({ error: "Impact measurement is unavailable." }, 503);
  }

  const result = await store.recordClientLatency({
    occurredAt: Date.now(),
    sessionHash,
    browserHash,
    turnId: body.turnId,
    firstVisibleMs: body.firstVisibleMs,
    completeMs: body.completeMs,
    metricVersion: body.metricVersion,
  });
  if (!result?.accepted) {
    const status = result?.reason === "turn" ? 409 : 400;
    return jsonResponse({ accepted: false }, status);
  }
  return jsonResponse(
    { accepted: true, duplicate: result?.duplicate === true },
    202,
  );
}

`;
  next = insertBefore(
    next,
    "function parseNdjson(text) {\n",
    endpoint,
    "export async function clientLatencyResponse(request, env) {\n",
    "the NDJSON parser",
  );

  next = replaceRequired(
    next,
    `        The impact store also keeps broad route, completion, configured cost, and timing
        metadata, plus one-way hashes of random browser, tab, and conversation identifiers.
        It does not place the user's message or the assistant's reply in impact analytics.
        The browser identifier rotates after 30 days, the tab identifier ends with the tab,
`,
    `        The impact store also keeps broad route, completion, provider-usage cost, server
        timing, and foreground browser timing from Send to the first visible token and fully
        rendered reply, plus one-way hashes of random browser, tab, and conversation
        identifiers. Browser timing is skipped unless the tab stays continuously visible.
        It does not place the user's message or the assistant's reply in impact analytics.
        The browser identifier rotates after 30 days, the tab identifier ends with the tab,
`,
    "the privacy timing disclosure",
  );
  return next;
});

await update("src/impact-worker.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `import {
  enhanceHomePage,
  enhancePrivacyPage,
  impactEventResponse,
} from "./impact-events.js";
`,
    `import {
  clientLatencyResponse,
  enhanceHomePage,
  enhancePrivacyPage,
  impactEventResponse,
} from "./impact-events.js";
`,
    "the impact-events import",
  );
  next = replaceRequired(
    next,
    `      if (url.pathname === "/api/impact-event") {
        return await impactEventResponse(request, env);
      }
`,
    `      if (url.pathname === "/api/impact-event") {
        return await impactEventResponse(request, env);
      }
      if (url.pathname === "/api/client-latency") {
        return await clientLatencyResponse(request, env);
      }
`,
    "the impact-event route",
  );
  return next;
});

await update("src/impact-latency.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `export function emptyLatencyBreakdowns() {
  return {
    firstToken: emptyMetricBreakdown(),
    totalResponse: emptyMetricBreakdown(),
  };
}
`,
    `export function emptyLatencyBreakdowns() {
  return {
    firstToken: emptyMetricBreakdown(),
    totalResponse: emptyMetricBreakdown(),
    clientFirstVisible: emptyMetricBreakdown(),
    clientComplete: emptyMetricBreakdown(),
  };
}
`,
    "the empty latency breakdowns",
  );
  next = replaceRequired(
    next,
    `  addMetricSample(target.firstToken, row.firstTokenMs, dimensions);
  addMetricSample(target.totalResponse, row.totalResponseMs, dimensions);
  return target;
`,
    `  addMetricSample(target.firstToken, row.firstTokenMs, dimensions);
  addMetricSample(target.totalResponse, row.totalResponseMs, dimensions);
  addMetricSample(
    target.clientFirstVisible,
    row.clientFirstVisibleMs,
    dimensions,
  );
  addMetricSample(target.clientComplete, row.clientCompleteMs, dimensions);
  return target;
`,
    "the latency sample writer",
  );
  next = replaceRequired(
    next,
    `    mergeMetricBreakdown(merged.firstToken, breakdowns.firstToken);
    mergeMetricBreakdown(merged.totalResponse, breakdowns.totalResponse);
`,
    `    mergeMetricBreakdown(merged.firstToken, breakdowns.firstToken);
    mergeMetricBreakdown(merged.totalResponse, breakdowns.totalResponse);
    mergeMetricBreakdown(
      merged.clientFirstVisible,
      breakdowns.clientFirstVisible,
    );
    mergeMetricBreakdown(merged.clientComplete, breakdowns.clientComplete);
`,
    "the latency histogram merger",
  );
  next = replaceRequired(
    next,
    `  return {
    firstToken: summarizeMetricBreakdown(breakdowns?.firstToken),
    totalResponse: summarizeMetricBreakdown(breakdowns?.totalResponse),
  };
}
`,
    `  return {
    firstToken: summarizeMetricBreakdown(breakdowns?.firstToken),
    totalResponse: summarizeMetricBreakdown(breakdowns?.totalResponse),
    clientFirstVisible: summarizeMetricBreakdown(
      breakdowns?.clientFirstVisible,
    ),
    clientComplete: summarizeMetricBreakdown(breakdowns?.clientComplete),
  };
}
`,
    "the latency summary",
  );
  return next;
});

await update("src/impact-analytics-latency.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `  ["first_token_ms", "INTEGER"],
  ["requested_service_tier", "TEXT"],
`,
    `  ["first_token_ms", "INTEGER"],
  ["client_first_visible_ms", "INTEGER"],
  ["client_complete_ms", "INTEGER"],
  ["client_latency_version", "TEXT"],
  ["requested_service_tier", "TEXT"],
`,
    "the metric columns",
  );

  const recordMethod = `  async recordClientLatency(record) {
    await this.ensureMetricsColumns();
    const turnId = boundedToken(record?.turnId, 64);
    const sessionHash = boundedToken(record?.sessionHash, 128);
    const browserHash = boundedToken(record?.browserHash, 128);
    const firstVisibleMs = boundedTiming(record?.firstVisibleMs);
    const completeMs = boundedTiming(record?.completeMs);
    const metricVersion = boundedToken(record?.metricVersion, 64);
    if (
      !turnId ||
      !sessionHash ||
      !browserHash ||
      firstVisibleMs === null ||
      completeMs === null ||
      completeMs < firstVisibleMs ||
      !metricVersion
    ) {
      return { accepted: false, reason: "invalid" };
    }
    if (!this.verifiedChat(turnId, sessionHash, browserHash)) {
      return { accepted: false, reason: "turn" };
    }

    const existing = this.ctx.storage.sql
      .exec(
        "SELECT client_complete_ms FROM chat_turns WHERE turn_id = ?",
        turnId,
      )
      .toArray()[0];
    if (existing?.client_complete_ms !== null && existing?.client_complete_ms !== undefined) {
      return { accepted: true, duplicate: true, verifiedTurn: true };
    }

    this.ctx.storage.sql.exec(
      "UPDATE chat_turns SET client_first_visible_ms = ?, client_complete_ms = ?, client_latency_version = ? WHERE turn_id = ? AND client_complete_ms IS NULL",
      firstVisibleMs,
      completeMs,
      metricVersion,
      turnId,
    );
    await this.scheduleRetention(Number(record?.occurredAt) || Date.now());
    return { accepted: true, verifiedTurn: true };
  }

`;
  next = insertBefore(
    next,
    "  async summary(options = {}) {\n",
    recordMethod,
    "  async recordClientLatency(record) {\n",
    "the summary method",
  );
  next = replaceRequired(
    next,
    `        "SELECT account_type, model, requested_service_tier, actual_service_tier, memory_source, conversation_turn_index, status, first_token_ms, total_response_ms, input_tokens, cached_input_tokens, cache_write_tokens, reasoning_tokens, output_tokens, estimated_cost_micros, pricing_version, pricing_status FROM chat_turns WHERE occurred_at >= ?",
`,
    `        "SELECT account_type, model, requested_service_tier, actual_service_tier, memory_source, conversation_turn_index, status, first_token_ms, total_response_ms, client_first_visible_ms, client_complete_ms, client_latency_version, input_tokens, cached_input_tokens, cache_write_tokens, reasoning_tokens, output_tokens, estimated_cost_micros, pricing_version, pricing_status FROM chat_turns WHERE occurred_at >= ?",
`,
    "the summary query",
  );
  next = replaceRequired(
    next,
    `        firstTokenMs: row.first_token_ms,
        totalResponseMs: row.total_response_ms,
      });
`,
    `        firstTokenMs: row.first_token_ms,
        totalResponseMs: row.total_response_ms,
        clientFirstVisibleMs: row.client_first_visible_ms,
        clientCompleteMs: row.client_complete_ms,
      });
`,
    "the latency summary row",
  );
  next = replaceRequired(
    next,
    `      latencyHistograms,
      latency: summarizeLatencyBreakdowns(latencyHistograms),
      tokenTotals,
`,
    `      latencyHistograms,
      latency: summarizeLatencyBreakdowns(latencyHistograms),
      clientLatencyChats: Number(
        latencyHistograms.clientComplete?.overall?.count || 0,
      ),
      clientTimingCoverageRate: rate(
        Number(latencyHistograms.clientComplete?.overall?.count || 0),
        Number(base.completedChats || 0),
      ),
      tokenTotals,
`,
    "the latency summary return",
  );
  return next;
});

await update("src/impact-shards.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `  const estimatedCostMicros = Number(merged.estimatedCostMicros || 0);
  const helpfulConversations = Number(merged.conversationHelped || 0);
`,
    `  const estimatedCostMicros = Number(merged.estimatedCostMicros || 0);
  const helpfulConversations = Number(merged.conversationHelped || 0);
  const clientLatencyChats = Number(
    latencyHistograms.clientComplete?.overall?.count || 0,
  );
`,
    "the decision-grade totals",
  );
  next = replaceRequired(
    next,
    `    latencyHistograms,
    latency: summarizeLatencyBreakdowns(latencyHistograms),
    tokenTotals,
`,
    `    latencyHistograms,
    latency: summarizeLatencyBreakdowns(latencyHistograms),
    clientLatencyChats,
    clientTimingCoverageRate: metricRate(
      clientLatencyChats,
      Number(merged.completedChats || 0),
    ),
    tokenTotals,
`,
    "the merged latency return",
  );
  return next;
});

await update("src/impact-dashboard.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    "function latencySummaryRows(summary) {\n  const first = summary.latency?.firstToken || {};\n  const total = summary.latency?.totalResponse || {};\n",
    "function latencySummaryRows(\n  summary,\n  firstMetric = \"firstToken\",\n  totalMetric = \"totalResponse\",\n) {\n  const first = summary.latency?.[firstMetric] || {};\n  const total = summary.latency?.[totalMetric] || {};\n",
    "the latency summary function",
  );
  next = replaceRequired(
    next,
    "function latencyBreakdownTable(summary) {\n  const rows = latencySummaryRows(summary);\n",
    "function latencyBreakdownTable(\n  summary,\n  firstMetric = \"firstToken\",\n  totalMetric = \"totalResponse\",\n) {\n  const rows = latencySummaryRows(summary, firstMetric, totalMetric);\n",
    "the latency table function",
  );
  next = replaceRequired(
    next,
    '<header class="top"><div><h1>Orderly impact</h1><p>Outcomes, latency, provider usage, reliability, and cost.</p></div>',
    '<header class="top"><div><h1>Orderly impact</h1><p>Outcomes, actual browser latency, provider usage, reliability, and cost.</p></div>',
    "the dashboard subtitle",
  );
  next = replaceRequired(
    next,
    `<div class="tile"><span>Average response time</span><strong>\${formatDurationMs(summary.averageResponseMs)}</strong></div>
<div class="tile"><span>First-token p50</span><strong>\${formatDurationMs(summary.latency?.firstToken?.overall?.p50Ms)}</strong></div>
<div class="tile"><span>First-token p95</span><strong>\${formatDurationMs(summary.latency?.firstToken?.overall?.p95Ms)}</strong></div>
<div class="tile"><span>Total-response p50</span><strong>\${formatDurationMs(summary.latency?.totalResponse?.overall?.p50Ms)}</strong></div>
<div class="tile"><span>Total-response p95</span><strong>\${formatDurationMs(summary.latency?.totalResponse?.overall?.p95Ms)}</strong></div>
`,
    `<div class="tile"><span>Average response time (server)</span><strong>\${formatDurationMs(summary.averageResponseMs)}</strong></div>
<div class="tile"><span>Actual first-visible p50</span><strong>\${formatDurationMs(summary.latency?.clientFirstVisible?.overall?.p50Ms)}</strong></div>
<div class="tile"><span>Actual first-visible p95</span><strong>\${formatDurationMs(summary.latency?.clientFirstVisible?.overall?.p95Ms)}</strong></div>
<div class="tile"><span>Actual fully-rendered p50</span><strong>\${formatDurationMs(summary.latency?.clientComplete?.overall?.p50Ms)}</strong></div>
<div class="tile"><span>Actual fully-rendered p95</span><strong>\${formatDurationMs(summary.latency?.clientComplete?.overall?.p95Ms)}</strong></div>
<div class="tile"><span>Browser timing coverage</span><strong>\${formatPercent(summary.clientTimingCoverageRate)}</strong></div>
<div class="tile"><span>First-token p50 (server)</span><strong>\${formatDurationMs(summary.latency?.firstToken?.overall?.p50Ms)}</strong></div>
<div class="tile"><span>First-token p95 (server)</span><strong>\${formatDurationMs(summary.latency?.firstToken?.overall?.p95Ms)}</strong></div>
<div class="tile"><span>Total-response p50 (server)</span><strong>\${formatDurationMs(summary.latency?.totalResponse?.overall?.p50Ms)}</strong></div>
<div class="tile"><span>Total-response p95 (server)</span><strong>\${formatDurationMs(summary.latency?.totalResponse?.overall?.p95Ms)}</strong></div>
`,
    "the response-time tiles",
  );

  const latencyPanels = `<section class="panel usage latency-breakdown actual-latency"><div class="usage-heading"><div><h2>Actual response time</h2><p>Foreground browser time from Send to the first visible token and fully rendered reply. Hidden or backgrounded tabs are excluded.</p></div></div><div class="usage-table-wrap"><table><thead><tr><th>Segment</th><th>Chats</th><th>First visible p50</th><th>First visible p95</th><th>Fully rendered p50</th><th>Fully rendered p95</th></tr></thead><tbody>\${latencyBreakdownTable(summary, "clientFirstVisible", "clientComplete")}</tbody></table></div></section>
<section class="panel usage latency-breakdown server-latency"><div class="usage-heading"><div><h2>Latency breakdown · server</h2><p>Cloudflare-side p50 and p95 timing buckets. These exclude browser network and rendering delay.</p></div></div><div class="usage-table-wrap"><table><thead><tr><th>Segment</th><th>Chats</th><th>First p50</th><th>First p95</th><th>Total p50</th><th>Total p95</th></tr></thead><tbody>\${latencyBreakdownTable(summary)}</tbody></table></div></section>
`;
  next = replaceBefore(
    next,
    '<section class="panel usage latency-breakdown">',
    '<section class="panel usage cost-breakdown">',
    latencyPanels,
    "the latency dashboard panel",
  );
  return next;
});

await update("package.json", (source) => {
  const packageJson = JSON.parse(source);
  const clientPolicy = "node scripts/apply-client-response-time.mjs";
  const decisionFinalizer = "node scripts/finalize-decision-grade-impact.mjs";
  const pipeline = packageJson.scripts["apply:prompt-policy"]
    .split(" && ")
    .filter(Boolean)
    .filter(
      (entry) => entry !== clientPolicy && entry !== decisionFinalizer,
    );
  pipeline.push(clientPolicy, decisionFinalizer);
  packageJson.scripts["apply:prompt-policy"] = pipeline.join(" && ");

  const ensureTest = (name, file) => {
    const parts = packageJson.scripts[name].split(/\s+/u).filter(Boolean);
    if (!parts.includes(file)) parts.push(file);
    packageJson.scripts[name] = parts.join(" ");
  };
  ensureTest("test:node", "test/client-response-time.test.mjs");
  ensureTest("test:worker", "test/client-response-time-worker.test.mjs");
  return JSON.stringify(packageJson, null, 2) + "\n";
});

console.log(
  "Applied foreground browser response-time measurement and dashboard reporting.",
);

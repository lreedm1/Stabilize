import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Engagement feedback update could not find ${label}`);
  }
}

await update("src/impact-events.js", (source) => {
  const oldDisclosure =
    "        The outcome check records only shown, yes, partly, or no. The response-quality";
  if (!source.includes(oldDisclosure)) return source;
  return source.replace(
    oldDisclosure,
    "        The outcome check asks “Did you choose a next step?” and records only shown,\n        yes, partly, or no. The response-quality",
  );
});

await update("src/impact-analytics.js", (source) => {
  let text = source;
  if (!text.includes("const dailyUsage = this.ctx.storage.sql")) {
    const marker = `    return {\n      since,\n      now,`;
    requireText(text, marker, "the analytics summary return");
    const dailyUsage = `    const dailyUsage = this.ctx.storage.sql
      .exec(
        \`SELECT CAST(occurred_at / 86400000 AS INTEGER) AS day_number,
                COUNT(DISTINCT browser_hash) AS users,
                COUNT(*) AS messages
         FROM chat_turns
         WHERE occurred_at >= ? AND occurred_at < ?
         GROUP BY day_number
         ORDER BY day_number ASC\`,
        since,
        now,
      )
      .toArray()
      .map((row) => ({
        date: new Date(Number(row.day_number) * DAY_MS)
          .toISOString()
          .slice(0, 10),
        users: Number(row.users || 0),
        messages: Number(row.messages || 0),
      }));

`;
    text = text.replace(marker, dailyUsage + marker);

    const returnMarker = `      estimatedCostMicros,\n      estimatedCostPerResolutionMicros:`;
    requireText(text, returnMarker, "the analytics cost fields");
    text = text.replace(
      returnMarker,
      `      estimatedCostMicros,\n      dailyUsage,\n      estimatedCostPerResolutionMicros:`,
    );
  }
  return text;
});

await update("src/impact-shards.js", (source) => {
  let text = source;
  if (!text.includes("dailyUsageByDate")) {
    const objectMarker = `    estimatedCostMicros: 0,\n  };`;
    requireText(text, objectMarker, "the merged summary object");
    text = text.replace(
      objectMarker,
      `    estimatedCostMicros: 0,\n    dailyUsageByDate: {},\n  };`,
    );

    const loopMarker = `    addCounts(merged.feedbackReasons, summary.feedbackReasons);\n    for (const comment of summary.recentFeedbackComments || []) {`;
    requireText(text, loopMarker, "the shard summary loop");
    text = text.replace(
      loopMarker,
      `    addCounts(merged.feedbackReasons, summary.feedbackReasons);\n    for (const day of summary.dailyUsage || []) {\n      const date = String(day?.date || \"\");\n      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) continue;\n      const current = merged.dailyUsageByDate[date] || { users: 0, messages: 0 };\n      current.users += Number(day.users || 0);\n      current.messages += Number(day.messages || 0);\n      merged.dailyUsageByDate[date] = current;\n    }\n    for (const comment of summary.recentFeedbackComments || []) {`,
    );

    const ratesMarker = `\n  merged.recentFeedbackComments = merged.recentFeedbackComments`;
    requireText(text, ratesMarker, "the merged comment calculations");
    text = text.replace(
      ratesMarker,
      `\n  merged.dailyUsage = Object.entries(merged.dailyUsageByDate)\n    .sort(([left], [right]) => left.localeCompare(right))\n    .map(([date, values]) => ({ date, ...values }));\n  delete merged.dailyUsageByDate;\n${ratesMarker}`,
    );
  }
  return text;
});

await update("src/impact-dashboard.js", (source) => {
  let text = source;

  if (!text.includes("function formatDurationMs")) {
    const marker = `function selfFundingRatio(finance) {\n  return finance.costCents > 0\n    ? \`${"${(finance.revenueCents / finance.costCents).toFixed(2)}"}×\`\n    : \"Not configured\";\n}\n\nfunction weeklyDecision`;
    requireText(text, marker, "the dashboard helper insertion point");
    const helpers = `function selfFundingRatio(finance) {
  return finance.costCents > 0
    ? \`${"${(finance.revenueCents / finance.costCents).toFixed(2)}"}×\`
    : "Not configured";
}

function formatDurationMs(value) {
  if (value === null || value === undefined) return "Not enough data";
  const milliseconds = Number(value) || 0;
  return milliseconds < 1_000
    ? \`${"${formatInteger(milliseconds)}"} ms\`
    : \`${"${(milliseconds / 1_000).toFixed(1)}"} s\`;
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
      (day) => \`<tr><th scope="row">${"${escapeHtml(day.date)}"}</th><td>${"${formatInteger(day.users)}"}</td><td>${"${formatInteger(day.messages)}"}</td></tr>\`,
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
      ([reason, count]) => \`<li><span>${"${escapeHtml(FEEDBACK_REASON_LABELS[reason] || reason)}"}</span><strong>${"${formatInteger(count)}"}</strong></li>\`,
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
      return \`<article class="feedback-comment"><div><strong>${"${escapeHtml(rating)}"}</strong><span>${"${escapeHtml(date)}"} · ${"${escapeHtml(reason)}"}</span></div><p>${"${escapeHtml(entry.comment)}"}</p></article>\`;
    })
    .join("");
}

function weeklyDecision`;
    text = text.replace(marker, helpers);
  }

  if (!text.includes("summary.helpfulResponseRate < 0.7")) {
    const marker = `function weeklyDecision(summary, finance) {\n`;
    requireText(text, marker, "the weekly decision function");
    text = text.replace(
      marker,
      `${marker}  if (summary.feedbackShown >= 30 && summary.feedbackResponses < 10) {\n    return \"Make the response feedback control easier to notice before judging answer quality.\";\n  }\n  if (\n    summary.feedbackResponses >= 20 &&\n    summary.helpfulResponseRate !== null &&\n    summary.helpfulResponseRate < 0.7\n  ) {\n    return \"Review the top negative reason and written comments, then test one focused response-quality change.\";\n  }\n`,
    );
  }

  text = text.replace(
    "One question. Six numbers. One decision each week.",
    "Engagement, response quality, outcomes, reliability, and cost.",
  );
  text = text.replace(
    'aria-label="Six primary metrics"',
    'aria-label="Primary engagement and quality metrics"',
  );

  // Later conversation-outcome passes rename the first engagement tile, so
  // use the durable second-message tile as the insertion sentinel.
  if (!text.includes("<span>Second-message rate</span>")) {
    const marker = `<div class="tile"><span>Self-funding ratio</span><strong>${"${escapeHtml(selfFundingRatio(finance))}"}</strong></div>\n</section>`;
    requireText(text, marker, "the primary dashboard grid ending");
    const tiles = `<div class="tile"><span>Self-funding ratio</span><strong>${"${escapeHtml(selfFundingRatio(finance))}"}</strong></div>
<div class="tile"><span>Chats started</span><strong>${"${formatInteger(summary.chats)}"}</strong></div>
<div class="tile"><span>Second-message rate</span><strong>${"${formatPercent(summary.secondMessageRate)}"}</strong></div>
<div class="tile"><span>Helpful response rate</span><strong>${"${formatPercent(summary.helpfulResponseRate)}"}</strong></div>
<div class="tile"><span>Feedback response rate</span><strong>${"${formatPercent(summary.feedbackResponseRate)}"}</strong></div>
<div class="tile"><span>Failed responses</span><strong>${"${formatInteger(summary.failedChats)}"}</strong></div>
<div class="tile"><span>Average response time</span><strong>${"${formatDurationMs(summary.averageResponseMs)}"}</strong></div>
<div class="tile"><span>Returning-browser rate</span><strong>${"${formatPercent(summary.returningBrowserRate)}"}</strong></div>
<div class="tile"><span>Est. cost / helpful response</span><strong>${"${formatMoneyFromMicros(summary.estimatedCostPerHelpfulMicros)}"}</strong></div>
<div class="tile"><span>Written comments</span><strong>${"${formatInteger(summary.feedbackComments)}"}</strong></div>
</section>`;
    text = text.replace(marker, tiles);
  }

  if (!text.includes('class="panel usage"')) {
    const marker = `</section>\n<section class="panel decision">`;
    requireText(text, marker, "the dashboard grid ending");
    const panels = `</section>
<section class="panel usage"><div class="usage-heading"><div><h2>Daily usage</h2><p>Unique browsers and submitted chat messages by UTC day.</p></div><div class="usage-today"><span>Today</span><strong>${"${formatInteger(dailyUsageRows(summary, 1)[0]?.users || 0)}"} users</strong><strong>${"${formatInteger(dailyUsageRows(summary, 1)[0]?.messages || 0)}"} messages</strong></div></div><div class="usage-table-wrap"><table><thead><tr><th>Date</th><th>Users</th><th>Messages</th></tr></thead><tbody>${"${dailyUsageTable(summary)}"}</tbody></table></div></section>
<section class="panel feedback-reasons"><h2>Top feedback reasons</h2><ul>${"${feedbackReasonList(summary)}"}</ul><p>${"${formatInteger(summary.helpfulResponses)}"} helpful · ${"${formatInteger(summary.unhelpfulResponses)}"} not helpful · ${"${formatInteger(summary.feedbackComments)}"} written comments</p></section>
<section class="panel feedback-comments"><h2>Recent written feedback</h2><p class="feedback-comments-note">Private, retention-limited comments. No chat text or user identifier is shown.</p><div>${"${feedbackCommentList(summary)}"}</div></section>
<section class="panel decision">`;
    text = text.replace(marker, panels);
  }

  if (!text.includes(".feedback-comments>div{")) {
    const marker = `.decision h2,.guardrails h2{font-size:1.05rem;margin:0 0 10px}`;
    requireText(text, marker, "the dashboard panel heading styles");
    const styles = `.decision h2,.guardrails h2,.usage h2,.feedback-reasons h2,.feedback-comments h2{font-size:1.05rem;margin:0 0 10px}.usage,.feedback-reasons,.feedback-comments{margin-bottom:14px;padding:19px}.usage-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.usage-heading p,.feedback-reasons p,.feedback-comments-note{margin:0;line-height:1.45}.usage-today{display:grid;gap:3px;text-align:right;white-space:nowrap}.usage-today span{font-size:.78rem;opacity:.8}.usage-today strong{font-size:.95rem}.usage-table-wrap{overflow-x:auto;margin-top:16px}table{width:100%;border-collapse:collapse}th,td{border-top:1px solid #dce6df;padding:9px 10px;text-align:right}th:first-child,td:first-child{text-align:left}thead th{border-top:0;font-size:.78rem}tbody th{font-weight:600}.feedback-reasons ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;list-style:none;padding:0;margin:0 0 14px}.feedback-reasons li{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid #e4ebe6;padding:7px 0}.feedback-comments>div{display:grid;gap:10px;margin-top:14px}.feedback-comment{border:1px solid #dce6df;border-radius:12px;padding:12px}.feedback-comment div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}.feedback-comment span{font-size:.78rem;color:#607b6f}.feedback-comment p{white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0 0;line-height:1.45}`;
    text = text.replace(marker, styles);
    const mobileMarker = `@media(max-width:520px){.shell`;
    requireText(text, mobileMarker, "the dashboard mobile styles");
    text = text.replace(
      mobileMarker,
      `@media(max-width:620px){.usage-heading{display:block}.usage-today{margin-top:12px;text-align:left}.feedback-reasons ul{grid-template-columns:1fr}}${mobileMarker}`,
    );
  }

  text = text.replace(
    "impact analytics store one structured state, never chat text.",
    "impact analytics never store chat text; optional written feedback is private and retention-limited.",
  );
  text = text.replace(
    "the question is optional and always skippable.",
    "all feedback controls are optional and never block the conversation.",
  );
  return text;
});

console.log("Added private per-response feedback and engagement metrics.");

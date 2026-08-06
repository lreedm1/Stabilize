import { readFile, writeFile } from "node:fs/promises";

const ANALYTICS_PATH = "src/impact-analytics.js";
const SHARDS_PATH = "src/impact-shards.js";
const DASHBOARD_PATH = "src/impact-dashboard.js";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Daily usage update could not find ${label}`);
  }
}

await update(ANALYTICS_PATH, (source) => {
  if (source.includes("const dailyUsage = this.ctx.storage.sql")) return source;

  const marker = `    const estimatedCostMicros = chatCounts.reduce(\n      (sum, row) => sum + Number(row.estimated_cost_micros || 0),\n      0,\n    );\n\n    return {`;
  requireText(source, marker, "the analytics summary return");
  const replacement = `    const estimatedCostMicros = chatCounts.reduce(\n      (sum, row) => sum + Number(row.estimated_cost_micros || 0),\n      0,\n    );\n\n    const dailyUsage = this.ctx.storage.sql\n      .exec(\n        \`SELECT CAST(occurred_at / 86400000 AS INTEGER) AS day_number,\n                COUNT(DISTINCT browser_hash) AS users,\n                COUNT(*) AS messages\n         FROM chat_turns\n         WHERE occurred_at >= ? AND occurred_at < ?\n         GROUP BY day_number\n         ORDER BY day_number ASC\`,\n        since,\n        now,\n      )\n      .toArray()\n      .map((row) => ({\n        date: new Date(Number(row.day_number) * DAY_MS)\n          .toISOString()\n          .slice(0, 10),\n        users: Number(row.users || 0),\n        messages: Number(row.messages || 0),\n      }));\n\n    return {`;
  let text = source.replace(marker, replacement);
  const returnMarker = `      estimatedCostMicros,\n      estimatedCostPerResolutionMicros:`;
  requireText(text, returnMarker, "the cost summary fields");
  text = text.replace(
    returnMarker,
    `      estimatedCostMicros,\n      dailyUsage,\n      estimatedCostPerResolutionMicros:`,
  );
  return text;
});

await update(SHARDS_PATH, (source) => {
  let text = source;
  if (!text.includes("dailyUsageByDate")) {
    const objectMarker = `    completedChats: 0,\n    estimatedCostMicros: 0,\n  };`;
    requireText(text, objectMarker, "the merged summary object");
    text = text.replace(
      objectMarker,
      `    completedChats: 0,\n    estimatedCostMicros: 0,\n    dailyUsageByDate: {},\n  };`,
    );

    const loopMarker = `    addCounts(merged.outcomeStates, summary.outcomeStates);\n  }\n\n  merged.responseRate`;
    requireText(text, loopMarker, "the shard merge loop");
    text = text.replace(
      loopMarker,
      `    addCounts(merged.outcomeStates, summary.outcomeStates);\n    for (const day of summary.dailyUsage || []) {\n      const date = String(day?.date || \"\");\n      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) continue;\n      const current = merged.dailyUsageByDate[date] || { users: 0, messages: 0 };\n      current.users += Number(day.users || 0);\n      current.messages += Number(day.messages || 0);\n      merged.dailyUsageByDate[date] = current;\n    }\n  }\n\n  merged.dailyUsage = Object.entries(merged.dailyUsageByDate)\n    .sort(([left], [right]) => left.localeCompare(right))\n    .map(([date, values]) => ({ date, ...values }));\n  delete merged.dailyUsageByDate;\n\n  merged.responseRate`,
    );
  }
  return text;
});

await update(DASHBOARD_PATH, (source) => {
  let text = source;
  if (!text.includes("function dailyUsageRows")) {
    const helperMarker = `function selfFundingRatio(finance) {\n  return finance.costCents > 0\n    ? \`${"${(finance.revenueCents / finance.costCents).toFixed(2)}"}×\`\n    : \"Not configured\";\n}\n\nfunction weeklyDecision`;
    requireText(text, helperMarker, "the dashboard metric helpers");
    const helpers = `function selfFundingRatio(finance) {\n  return finance.costCents > 0\n    ? \`${"${(finance.revenueCents / finance.costCents).toFixed(2)}"}×\`\n    : \"Not configured\";\n}\n\nfunction dailyUsageRows(summary, days = 14) {\n  const byDate = new Map(\n    (summary.dailyUsage || []).map((day) => [String(day.date), day]),\n  );\n  const rows = [];\n  const end = new Date(summary.now);\n  end.setUTCHours(0, 0, 0, 0);\n  for (let offset = days - 1; offset >= 0; offset -= 1) {\n    const date = new Date(end.getTime() - offset * 24 * 60 * 60 * 1_000);\n    const key = date.toISOString().slice(0, 10);\n    const usage = byDate.get(key) || { users: 0, messages: 0 };\n    rows.push({ date: key, users: Number(usage.users || 0), messages: Number(usage.messages || 0) });\n  }\n  return rows;\n}\n\nfunction dailyUsageTable(summary) {\n  const rows = dailyUsageRows(summary);\n  return rows\n    .map(\n      (day) => \`<tr><th scope=\"row\">${"${escapeHtml(day.date)}"}</th><td>${"${formatInteger(day.users)}"}</td><td>${"${formatInteger(day.messages)}"}</td></tr>\`,\n    )\n    .join(\"\");\n}\n\nfunction weeklyDecision`;
    text = text.replace(helperMarker, helpers);
  }

  if (!text.includes('class="panel usage"')) {
    const gridEnd = `</section>\n<section class="panel decision">`;
    requireText(text, gridEnd, "the primary metric grid ending");
    const usage = `</section>\n<section class="panel usage"><div class="usage-heading"><div><h2>Daily usage</h2><p>Unique browsers and submitted chat messages by UTC day.</p></div><div class="usage-today"><span>Today</span><strong>${"${formatInteger(dailyUsageRows(summary, 1)[0]?.users || 0)}"} users</strong><strong>${"${formatInteger(dailyUsageRows(summary, 1)[0]?.messages || 0)}"} messages</strong></div></div><div class="usage-table-wrap"><table><thead><tr><th>Date</th><th>Users</th><th>Messages</th></tr></thead><tbody>${"${dailyUsageTable(summary)}"}</tbody></table></div></section>\n<section class="panel decision">`;
    text = text.replace(gridEnd, usage);
  }

  if (!text.includes(".usage-heading{")) {
    const cssMarker = `.decision h2,.guardrails h2{font-size:1.05rem;margin:0 0 10px}`;
    requireText(text, cssMarker, "the dashboard panel heading styles");
    text = text.replace(
      cssMarker,
      `.decision h2,.guardrails h2,.usage h2{font-size:1.05rem;margin:0 0 10px}.usage{margin-bottom:14px;padding:19px}.usage-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.usage-heading p{margin:0;line-height:1.45}.usage-today{display:grid;gap:3px;text-align:right;white-space:nowrap}.usage-today span{font-size:.78rem;opacity:.8}.usage-today strong{font-size:.95rem}.usage-table-wrap{overflow-x:auto;margin-top:16px}table{width:100%;border-collapse:collapse}th,td{border-top:var(--stabilize-reading-border);padding:9px 10px;text-align:right}th:first-child,td:first-child{text-align:left}thead th{border-top:0;font-size:.78rem}tbody th{font-weight:600}`,
    );
    const mobileMarker = `@media(max-width:520px){.shell`;
    requireText(text, mobileMarker, "the mobile dashboard media query");
    text = text.replace(
      mobileMarker,
      `@media(max-width:620px){.usage-heading{display:block}.usage-today{margin-top:12px;text-align:left}}${mobileMarker}`,
    );
  }
  return text;
});

console.log("Added daily users and daily messages to the impact dashboard.");

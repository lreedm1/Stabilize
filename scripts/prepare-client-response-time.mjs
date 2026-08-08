import { readFile, writeFile } from "node:fs/promises";

const shareTestPath = "test/organic-share-loop.test.mjs";
const shareTest = await readFile(shareTestPath, "utf8");
const alignedShareTest = shareTest.replace(
  /20260806-shareable-next-step-1/gu,
  "20260808-browser-response-time-1",
);
if (alignedShareTest !== shareTest) {
  await writeFile(shareTestPath, alignedShareTest);
}

const impactWorkerTestPath = "test/impact-worker.test.mjs";
const impactWorkerTest = await readFile(impactWorkerTestPath, "utf8");
const alignedImpactWorkerTest = impactWorkerTest
  .replace(
    "/Outcomes, latency, provider usage, reliability, and cost\\./",
    "/Outcomes, actual browser latency, provider usage, reliability, and cost\\./",
  )
  .replace(
    "/random browser, tab, and conversation identifiers/",
    "/random browser, tab, and conversation\\s+identifiers/",
  );
if (alignedImpactWorkerTest !== impactWorkerTest) {
  await writeFile(impactWorkerTestPath, alignedImpactWorkerTest);
}

const path = "src/impact-dashboard.js";
const source = await readFile(path, "utf8");

if (!source.includes("Actual first-visible p50")) {
  console.log("Browser response-time dashboard is ready for generation.");
  process.exit(0);
}

const tileStart =
  '<div class="tile"><span>Average response time (server)</span>';
const tileEnd =
  '<div class="tile"><span>Returning-browser rate</span>';
const tileStartIndex = source.indexOf(tileStart);
const tileEndIndex = source.indexOf(tileEnd, tileStartIndex);
if (tileStartIndex < 0 || tileEndIndex <= tileStartIndex) {
  throw new Error("Could not locate the browser response-time tile block.");
}

const canonicalServerTiles = `<div class="tile"><span>Average response time</span><strong>\${formatDurationMs(summary.averageResponseMs)}</strong></div>
<div class="tile"><span>First-token p50</span><strong>\${formatDurationMs(summary.latency?.firstToken?.overall?.p50Ms)}</strong></div>
<div class="tile"><span>First-token p95</span><strong>\${formatDurationMs(summary.latency?.firstToken?.overall?.p95Ms)}</strong></div>
<div class="tile"><span>Total-response p50</span><strong>\${formatDurationMs(summary.latency?.totalResponse?.overall?.p50Ms)}</strong></div>
<div class="tile"><span>Total-response p95</span><strong>\${formatDurationMs(summary.latency?.totalResponse?.overall?.p95Ms)}</strong></div>
`;

let next =
  source.slice(0, tileStartIndex) +
  canonicalServerTiles +
  source.slice(tileEndIndex);

const panelStart =
  '<section class="panel usage latency-breakdown actual-latency">';
const costStart = '<section class="panel usage cost-breakdown">';
const panelStartIndex = next.indexOf(panelStart);
const costStartIndex = next.indexOf(costStart, panelStartIndex);
if (panelStartIndex < 0 || costStartIndex <= panelStartIndex) {
  throw new Error("Could not locate the browser response-time dashboard panels.");
}

const canonicalServerPanel = `<section class="panel usage latency-breakdown"><div class="usage-heading"><div><h2>Latency breakdown</h2><p>Mergeable p50 and p95 timing buckets, segmented without storing chat text.</p></div></div><div class="usage-table-wrap"><table><thead><tr><th>Segment</th><th>Chats</th><th>First p50</th><th>First p95</th><th>Total p50</th><th>Total p95</th></tr></thead><tbody>\${latencyBreakdownTable(summary)}</tbody></table></div></section>
`;

next =
  next.slice(0, panelStartIndex) +
  canonicalServerPanel +
  next.slice(costStartIndex);

await writeFile(path, next);
console.log(
  "Prepared the decision-grade dashboard for repeatable browser timing generation.",
);
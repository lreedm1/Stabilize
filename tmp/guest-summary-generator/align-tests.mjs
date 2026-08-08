import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/add-guest-summary.mjs";
let source = readFileSync(path, "utf8");

function replaceRequired(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error(`Could not align ${label}`);
  }
  source = source.replace(before, after);
}

replaceRequired(
  "assert.match(packageSource, /add-guest-summary\\\\.mjs/);",
  "assert.match(packageSource, /add-guest-summary\\.mjs/);",
  "guest-summary generator path assertion",
);

const staticTestAnchor = 'const staticTest = String.raw`import test from "node:test";';
const alignmentIdentity = "const priorGuestSummaryPolicyPipeline =";
if (!source.includes(alignmentIdentity)) {
  const anchorIndex = source.indexOf(staticTestAnchor);
  if (anchorIndex < 0) throw new Error("Could not locate test-alignment anchor");

  const alignmentCode = `const priorGuestSummaryPolicyPipeline =
  "node scripts/apply-priority-latency.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs";
const completeGuestSummaryPolicyPipeline =
  priorGuestSummaryPolicyPipeline + " && node scripts/add-guest-summary.mjs";

for (const path of [
  "test/composer-chat-sections.test.mjs",
  "test/composer-placeholder-alignment.test.mjs",
  "test/daily-usage-dashboard.test.mjs",
  "test/mobile-background-loading.test.mjs",
  "test/model-catalog-usage.test.mjs",
  "test/navigation-model-placement.test.mjs",
  "test/paid-model-choice.test.mjs",
]) {
  replaceAllRequired(
    path,
    priorGuestSummaryPolicyPipeline,
    completeGuestSummaryPolicyPipeline,
    "guest-summary canonical policy pipeline expectation",
  );
}

replaceRequired(
  "test/memory-controls.test.mjs",
  \`  assert.match(workerSource, /privateChat \\\\|\\\\| signedOut/);\`,
  \`  assert.match(workerSource, /const signedOut = !accountKey;/);\n  assert.match(\n    workerSource,\n    /signedOut[\\\\s\\\\S]*guestModelInput\\\\(body, latestText\\\\)/,\n  );\`,
  "guest-summary signed-out memory boundary expectation",
);
replaceRequired(
  "test/product.test.mjs",
  \`  assert.match(pageSource, /Guest chats stay in this browser tab only/);\`,
  \`  assert.match(\n    pageSource,\n    /Guest chats keep eight recent messages plus a tab-only rolling summary/,\n  );\`,
  "guest-summary landing privacy expectation",
);
replaceRequired(
  "test/streaming-response.test.mjs",
  \`  assert.match(\n    workerSource,\n    /return streamChatReply\\\\(messages, route, env, latestText, stub, ctx\\\\)/,\n  );\`,
  \`  assert.match(\n    workerSource,\n    /return streamChatReply\\\\([\\\\s\\\\S]*memory\\\\.generation,[\\\\s\\\\S]*guestSummaryPromise,[\\\\s\\\\S]*\\\\);/,\n  );\`,
  "guest-summary streaming invocation expectation",
);

`;
  source =
    source.slice(0, anchorIndex) + alignmentCode + source.slice(anchorIndex);
}

writeFileSync(path, source, "utf8");

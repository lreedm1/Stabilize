import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("GPT-5.6 fast-first routing and subscriber choice share a resilient left-side picker", async () => {
  const [
    workerSource,
    accountSource,
    clientSource,
    billingStyles,
    pickerPolicy,
    freePolicy,
    packageSource,
    wranglerSource,
    setupGuide,
  ] = await Promise.all([
    readFile(new URL("../src/paid-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../src/billing-account.js", import.meta.url), "utf8"),
    readFile(new URL("../public/billing-client.js", import.meta.url), "utf8"),
    readFile(new URL("../public/billing.css", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/add-composer-model-picker.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/enable-free-daily-model-choice.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(
      new URL("../docs/STRIPE_MODEL_CHOICE_SETUP.md", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(workerSource, /data-billing-redirect="checkout"/);
  assert.match(workerSource, /data-billing-redirect="portal"/);
  assert.match(workerSource, /function billingNavigationResponse\(request, url\)/);
  assert.match(workerSource, /wantsJson\(request\)/);
  assert.match(workerSource, /origin !== "null"/);
  assert.match(
    workerSource,
    /fetchSite && !\["same-origin", "none"\]\.includes\(fetchSite\)/,
  );
  assert.match(
    workerSource,
    /src="\/billing-client\.js\?v=[A-Za-z0-9._-]+"/,
  );
  assert.match(workerSource, /form action="\/account\/model"/);
  assert.match(workerSource, /select id="model-choice" name="model"/);
  assert.match(workerSource, /await stub\.setSelectedModel\(model\)/);
  assert.doesNotMatch(
    workerSource,
    /if \(!state\.entitled\) return redirect\("\/\?billing=error"/,
  );

  const chatStart = workerSource.indexOf("async function paidChatResponse(");
  const chatEnd = workerSource.indexOf("function responseWithModelUsage", chatStart);
  assert.ok(chatStart >= 0 && chatEnd > chatStart, "paid chat handler is missing");
  const paidChat = workerSource.slice(chatStart, chatEnd);
  assert.match(
    paidChat,
    /stub\s*\.prepareChat\(chatPreparationOptions\(env, body\)\)/,
  );
  assert.match(
    paidChat,
    /const \[billingResult, memoryResult\] = await Promise\.all/,
  );
  assert.match(paidChat, /modelEnvironment\(env, preparation\.model\)/);
  assert.match(paidChat, /preparedChatResponse\(/);
  assert.match(paidChat, /event: "signed_in_chat_prepared"/);
  assert.match(paidChat, /X-Stabilize-Preparation-Ms/);
  assert.match(paidChat, /stub\.refundUsage\(preparation\.tier, preparation\.period\)/);
  assert.match(paidChat, /fallback: preparation\.fallback/);
  assert.doesNotMatch(paidChat, /readBillingState\(/);
  assert.doesNotMatch(paidChat, /reserveUsage\(/);

  assert.match(workerSource, /freeDailyModelMessageLimit\(env\)/);
  assert.match(workerSource, /dailyUsagePeriod\(\)/);
  assert.match(workerSource, /freeLimit[\s\S]*GPT-5\.6 Fast messages/);
  assert.match(workerSource, /allowance resets at 00:00 UTC/);

  assert.match(workerSource, /function composerModelPickerMarkup\(/);
  assert.match(workerSource, /class="composer-model-picker"/);
  assert.match(workerSource, /class="composer-model-button"/);
  assert.match(workerSource, /id="composer-model-choice" name="model"/);
  assert.match(workerSource, /class="composer-entry-row"/);
  assert.match(
    workerSource,
    /composerModelPicker \+\s*chatForm \+\s*"<\/div>"/,
  );

  assert.match(accountSource, /CREATE TABLE IF NOT EXISTS model_usage/);
  assert.match(accountSource, /PRIMARY KEY \(tier, period\)/);
  assert.match(accountSource, /async prepareChat\(options\)/);
  assert.match(accountSource, /this\.ctx\.storage\.transactionSync/);
  assert.match(accountSource, /model: config\.freeModel/);
  assert.match(accountSource, /model: config\.fallbackModel/);
  assert.match(accountSource, /freeUsagePeriod/);
  assert.match(accountSource, /paidUsagePeriod/);
  assert.doesNotMatch(accountSource, /Model choice is not active/);

  assert.match(clientSource, /form\[data-billing-redirect\]/);
  assert.match(clientSource, /Accept:\s*"application\/json"/);
  assert.match(clientSource, /credentials:\s*"same-origin"/);
  assert.match(clientSource, /checkout\.stripe\.com/);
  assert.match(clientSource, /billing\.stripe\.com/);
  assert.match(clientSource, /window\.location\.assign\(result\.url\)/);
  assert.match(
    clientSource,
    /closest\("\.billing-menu, \.composer-model-panel"\)/,
  );
  assert.match(clientSource, /function closePicker\(/);
  assert.match(clientSource, /event\.key !== "Escape"/);
  assert.doesNotMatch(clientSource, /innerHTML\s*=/);

  assert.match(
    billingStyles,
    /\.composer-entry-row\s*{[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\)/,
  );
  assert.match(
    billingStyles,
    /\.composer-model-button\s*{[\s\S]*min-height:\s*64px/,
  );
  assert.match(
    billingStyles,
    /\.composer-model-panel\s*{[\s\S]*position:\s*absolute;[\s\S]*bottom:\s*calc\(100% \+ 10px\)/,
  );
  assert.match(billingStyles, /\.billing-action-status/);
  assert.match(billingStyles, /form\[aria-busy="true"\]/);

  assert.match(pickerPolicy, /Added the left-side composer model picker/);
  assert.match(pickerPolicy, /20260804-composer-model-picker-1/);
  assert.match(freePolicy, /FREE_DAILY_MODEL_MESSAGE_LIMIT/);

  const packageJson = JSON.parse(packageSource);
  assert.equal(
    packageJson.scripts["apply:prompt-policy"],
    "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/prepare-decision-grade-impact.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs && node scripts/add-guest-summary.mjs && node scripts/apply-signed-in-prefetch-latency.mjs && node scripts/finalize-signed-in-prefetch-tests.mjs && node scripts/apply-account-preflight.mjs && node scripts/finalize-account-preflight.mjs && node scripts/apply-decision-grade-impact.mjs && node scripts/finalize-decision-grade-impact.mjs",
  );
  assert.match(
    wranglerSource,
    /"FREE_DAILY_MODEL_MESSAGE_LIMIT": "50"/,
  );
  assert.match(setupGuide, /https:\/\/stabilize\.info\/api\/stripe\/webhook/);
  assert.match(setupGuide, /50 GPT-5\.6 Fast messages per UTC day/);
  assert.match(setupGuide, /200 non-default-model messages per UTC month/);
});
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("free and subscriber model choice share a resilient left-side picker", async () => {
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
    /src="\/billing-client\.js\?v=20260805-composer-chat-sections-1"/,
  );
  assert.match(workerSource, /form action="\/account\/model"/);
  assert.match(workerSource, /select id="model-choice" name="model"/);
  assert.match(workerSource, /await stub\.setSelectedModel\(model\)/);
  assert.doesNotMatch(
    workerSource,
    /if \(!state\.entitled\) return redirect\("\/\?billing=error"/,
  );
  assert.match(workerSource, /modelEnvironment\(env, selectedModel\)/);
  assert.match(workerSource, /freeDailyModelMessageLimit\(env\)/);
  assert.match(workerSource, /dailyUsagePeriod\(\)/);
  assert.match(workerSource, /stub\.reserveUsage\(tier, period, limit\)/);
  assert.match(workerSource, /stub\.refundUsage\(tier, period\)/);
  assert.match(workerSource, /20 free model-select messages/);
  assert.match(workerSource, /allowance resets at 00:00 UTC/);

  assert.match(workerSource, /function composerModelPickerMarkup\(/);
  assert.match(
    workerSource,
    /class="composer-model-picker composer-quick-menu"/,
  );
  assert.match(workerSource, /class="composer-model-button"/);
  assert.match(workerSource, /id="composer-model-choice" name="model"/);
  assert.match(workerSource, /class="composer-entry-row"/);
  assert.match(
    workerSource,
    /composerModelPicker \+\s*chatForm \+\s*"<\/div>"/,
  );

  assert.match(accountSource, /CREATE TABLE IF NOT EXISTS model_usage/);
  assert.match(accountSource, /PRIMARY KEY \(tier, period\)/);
  assert.match(accountSource, /tier === "free"/);
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
  assert.match(
    freePolicy,
    /Enabled 20 free daily model-select messages for signed-in users/,
  );
  assert.match(packageSource, /node scripts\/add-composer-model-picker\.mjs/);
  assert.match(
    packageSource,
    /node scripts\/enable-free-daily-model-choice\.mjs/,
  );
  assert.match(
    wranglerSource,
    /"FREE_DAILY_MODEL_MESSAGE_LIMIT": "20"/,
  );
  assert.match(setupGuide, /https:\/\/stabilize\.info\/api\/stripe\/webhook/);
  assert.match(setupGuide, /20 free model-select messages per UTC day/);
  assert.match(setupGuide, /200 non-default-model messages per UTC month/);
});

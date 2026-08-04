import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("paid model choice has a resilient checkout and a left-side picker", async () => {
  const [
    workerSource,
    clientSource,
    billingStyles,
    pickerPolicy,
    packageSource,
    setupGuide,
  ] = await Promise.all([
    readFile(new URL("../src/paid-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../public/billing-client.js", import.meta.url), "utf8"),
    readFile(new URL("../public/billing.css", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/add-composer-model-picker.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
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
    /src="\/billing-client\.js\?v=20260804-composer-model-picker-1"/,
  );
  assert.match(workerSource, /form action="\/account\/model"/);
  assert.match(workerSource, /select id="model-choice" name="model"/);
  assert.match(workerSource, /stub\.setSelectedModel\(model\)/);
  assert.match(workerSource, /modelEnvironment\(env, selectedModel\)/);

  assert.match(workerSource, /function composerModelPickerMarkup\(/);
  assert.match(workerSource, /class="composer-model-picker"/);
  assert.match(workerSource, /class="composer-model-button"/);
  assert.match(workerSource, /id="composer-model-choice" name="model"/);
  assert.match(workerSource, /class="composer-entry-row"/);
  assert.match(
    workerSource,
    /composerModelPicker \+\s*chatForm \+\s*"<\/div>"/,
  );

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
  assert.match(packageSource, /node scripts\/add-composer-model-picker\.mjs/);
  assert.match(setupGuide, /https:\/\/stabilize\.info\/api\/stripe\/webhook/);
  assert.match(setupGuide, /Stabilize Model Choice/);
});

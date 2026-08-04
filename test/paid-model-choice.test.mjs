import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("paid model choice has a resilient checkout and an entitled selector", async () => {
  const [workerSource, clientSource, billingStyles, setupGuide] =
    await Promise.all([
      readFile(new URL("../src/paid-worker.js", import.meta.url), "utf8"),
      readFile(new URL("../public/billing-client.js", import.meta.url), "utf8"),
      readFile(new URL("../public/billing.css", import.meta.url), "utf8"),
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
    /src="\/billing-client\.js\?v=20260804-paid-model-choice-1"/,
  );
  assert.match(workerSource, /form action="\/account\/model"/);
  assert.match(workerSource, /select id="model-choice" name="model"/);
  assert.match(workerSource, /stub\.setSelectedModel\(model\)/);
  assert.match(workerSource, /modelEnvironment\(env, selectedModel\)/);

  assert.match(clientSource, /form\[data-billing-redirect\]/);
  assert.match(clientSource, /Accept:\s*"application\/json"/);
  assert.match(clientSource, /credentials:\s*"same-origin"/);
  assert.match(clientSource, /checkout\.stripe\.com/);
  assert.match(clientSource, /billing\.stripe\.com/);
  assert.match(clientSource, /window\.location\.assign\(result\.url\)/);
  assert.doesNotMatch(clientSource, /innerHTML\s*=/);

  assert.match(billingStyles, /\.billing-action-status/);
  assert.match(billingStyles, /form\[aria-busy="true"\]/);
  assert.match(setupGuide, /https:\/\/stabilize\.info\/api\/stripe\/webhook/);
  assert.match(setupGuide, /Stabilize Model Choice/);
});

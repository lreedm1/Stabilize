import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("README.md", (source) =>
  source
    .replace(
      "- signed-in fast replies on GPT-5.4 plus 50 free Current thinking messages per UTC day",
      "- guest and signed-in fast replies begin on GPT-5.6 Fast; signed-in free accounts receive 50 GPT-5.6 messages per UTC day before GPT-5.4 fallback",
    )
    .replace(
      "- **Guest:** ordinary chats use GPT-5.4. A bounded recent transcript stays in the current browser tab and is sent with follow-ups, but it does not use Stabilize account memory.",
      "- **Guest:** ordinary chats begin on GPT-5.6 Fast. A bounded recent transcript stays in the current browser tab and is sent with follow-ups, but it does not use Stabilize account memory or an account-based allowance.",
    )
    .replace(
      "- **Signed-in free account:** **Fastest response** uses GPT-5.4, matching guest speed while retaining account memory. Choosing a thinking level uses **Current** (`gpt-5.6-sol`) for up to **50** completed messages per UTC day; after that allowance, the request continues on GPT-5.4. The allowance resets at `00:00 UTC`.",
      "- **Signed-in free account:** the first **50** completed ordinary messages per UTC day use GPT-5.6 Fast (`gpt-5.6-sol`), including Fastest response. The selected thinking level changes reasoning effort, not the initial model. After the allowance, requests continue on GPT-5.4. The allowance resets at `00:00 UTC`.",
    )
    .replace(
      "The public labels intentionally use **GPT-5.4**, **Current**, and thinking-level names.",
      "The public labels intentionally use **GPT-5.6 Fast**, **GPT-5.4**, **Current**, and thinking-level names.",
    )
    .replace(
      "`OPENAI_MODEL` is the guest, signed-in fastest-response, and fallback model. The two `FREE_PLAN_*` values define the signed-in Current thinking allowance and fallback.",
      "`OPENAI_MODEL` remains the GPT-5.4 fallback and subscriber base model. `FREE_PLAN_PRIMARY_MODEL` supplies the GPT-5.6 Fast initial route for guests and the first 50 signed-in free messages; `FREE_PLAN_FALLBACK_MODEL` handles the signed-in daily-limit fallback.",
    ),
);

await update("docs/STRIPE_MODEL_CHOICE_SETUP.md", (source) =>
  source
    .replace(
      "Stabilize keeps signed-in fastest responses on GPT-5.4 and provides a free daily Current thinking allowance, plus an optional Stripe subscription for a larger monthly non-default-model allowance.",
      "Stabilize begins guest and signed-in free chats on GPT-5.6 Fast, with a 50-message daily signed-in allowance before GPT-5.4 fallback, plus an optional Stripe subscription for a larger monthly non-default-model allowance.",
    )
    .replace(
      "- guests use GPT-5.4 for ordinary chats",
      "- guests begin ordinary chats on GPT-5.6 Fast",
    )
    .replace(
      "- signed-in free accounts use GPT-5.4 for Fastest response and receive 50 free Current thinking messages per UTC day",
      "- signed-in free accounts receive 50 GPT-5.6 Fast messages per UTC day, including Fastest response, then continue on GPT-5.4",
    )
    .replace(
      "The free Current thinking allowance remains available even when Stripe is not configured.",
      "The free GPT-5.6 Fast daily allowance remains available even when Stripe is not configured.",
    )
    .replace(
      "A guest ordinary chat uses the configured fallback model, currently GPT-5.4. Guest usage is not written to Stabilize account memory and does not participate in an account-based model allowance.",
      "A guest ordinary chat uses GPT-5.6 Fast. Guest usage is not written to Stabilize account memory and does not participate in an account-based model allowance.",
    )
    .replace(
      "Fastest response uses GPT-5.4 so signing in does not silently move the user onto a slower default model. Choosing any supported thinking level uses Current (`gpt-5.6-sol`) and consumes one of 50 free Current thinking messages per UTC day. When that allowance is exhausted, the request continues on GPT-5.4 with instant reasoning. The daily counter resets at `00:00 UTC`.",
      "The first 50 completed ordinary messages per UTC day use GPT-5.6 Fast (`gpt-5.6-sol`), including Fastest response. A selected thinking level changes reasoning effort while remaining on GPT-5.6. When the allowance is exhausted, the request continues on GPT-5.4 with instant reasoning. The daily counter resets at `00:00 UTC`.",
    )
    .replace(
      "The free-account model tile shows GPT-5.4 by default. The separate thinking-level control opts into Current; a saved historical model preference does not override the free route.",
      "The guest and free-account model tile shows GPT-5.6 by default. A saved historical model preference does not override the automatic free route.",
    )
    .replace(
      "2. Send a Fastest response message and confirm GPT-5.4 is selected without increasing the Current allowance.\n3. Choose a thinking level, send a message, and confirm Current is selected and the daily count increases.\n4. Reload the page and confirm the count remains.\n5. In a test environment with a reduced free limit, exhaust the allowance and confirm the next thinking request succeeds on GPT-5.4 with the fallback notice.",
      "2. Send a Fastest response message and confirm GPT-5.6 Fast is selected and the daily count increases.\n3. Choose a thinking level, send a message, and confirm GPT-5.6 remains selected with the requested effort.\n4. Reload the page and confirm the count remains.\n5. In a test environment with a reduced free limit, exhaust the allowance and confirm the next request succeeds on GPT-5.4 with the fallback notice.",
    )
    .replace(
      "the account returns to the free GPT-5.4 Fastest-response and Current-thinking policy after Stripe sends the subscription update",
      "the account returns to the free GPT-5.6 Fast-first policy after Stripe sends the subscription update",
    ),
);

await update("public/about.html", (source) =>
  source
    .replace(
      "guest access on GPT-5.4, and GPT-5.4 fastest responses plus 50 free Current thinking messages per UTC day for signed-in accounts.",
      "guest access beginning on GPT-5.6 Fast, plus 50 GPT-5.6 Fast messages per UTC day for signed-in accounts before GPT-5.4 fallback.",
    )
    .replace(
      `ordinary chats use GPT-5.4. Signed-in free accounts use GPT-5.4 for Fastest response and receive 50 Current thinking
        messages per UTC day.`,
      `ordinary chats begin on GPT-5.6 Fast. Signed-in free accounts receive 50 GPT-5.6 Fast
        messages per UTC day before GPT-5.4 fallback.`,
    ),
);

await update("public/sustainability.html", (source) =>
  source
    .replace(
      "A usable guest experience on GPT-5.4 without requiring an account.",
      "A usable guest experience beginning on GPT-5.6 Fast without requiring an account.",
    )
    .replace(
      "GPT-5.4 Fastest responses plus fifty Current thinking messages per UTC day for signed-in free accounts.",
      "Fifty GPT-5.6 Fast messages per UTC day for signed-in free accounts before GPT-5.4 fallback.",
    )
    .replace(
      "Signed-in free accounts use GPT-5.4 for Fastest response and receive 50 Current thinking messages per UTC day.",
      "Signed-in free accounts receive 50 GPT-5.6 Fast messages per UTC day before GPT-5.4 fallback.",
    )
    .replace(
      "the free GPT-5.4 fastest-response and Current-thinking policy intact",
      "the free GPT-5.6 Fast-first policy intact",
    ),
);

console.log("Aligned public copy with GPT-5.6 Fast-first routing.");

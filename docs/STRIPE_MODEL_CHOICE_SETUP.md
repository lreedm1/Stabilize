# Stripe model-allowance setup

Stabilize keeps signed-in fastest responses on GPT-5.4 and provides a free daily Current thinking allowance, plus an optional Stripe subscription for a larger monthly non-default-model allowance.

The current behavior is:

- guests use GPT-5.4 for ordinary chats
- signed-in free accounts use GPT-5.4 for Fastest response and receive 50 free Current thinking messages per UTC day
- subscribers can choose GPT-5.4 or Current (`gpt-5.6-sol`) and receive 200 non-default-model messages per UTC month
- GPT-5.4 does not consume the subscriber monthly allowance
- fixed urgent routes and failed provider requests do not consume either allowance
- thinking level is a separate, free control and does not consume an additional allowance

Stripe-hosted Checkout sells the recurring subscriber allowance, and Stripe's hosted customer portal handles cancellation and payment-method management. Card numbers are never handled by the Worker.

## Stripe resources created in test mode

The connected Stripe sandbox contains:

- Product: `prod_V01MClXaF8xqB5`
- Product name: **Stabilize Model Choice**
- Description: choose an additional AI model, with up to 200 paid-model messages per month
- Tax code: `txcd_10103100`
- Default monthly Price: `price_1U01Jp96tfbPOBGIbQNXDlPx`
- Amount: **$10.00 USD per month**
- Webhook endpoint: `we_1U01Le96tfbPOBGICBrwkSeS`
- Webhook URL: `https://stabilize.info/api/stripe/webhook`

The Price ID is committed as the non-secret `STRIPE_MODEL_CHOICE_PRICE_ID` Worker variable. It does not need to be pasted into Cloudflare.

## Hosted Checkout

Checkout Session creation uses:

- `mode=subscription`
- the configured recurring Price
- quantity `1`
- the signed-in one-way account alias as `client_reference_id`
- the same alias in Checkout and Subscription metadata
- Stripe-hosted success and cancellation URLs on `stabilize.info`
- promotion codes when Stripe permits them

The upgrade form has a normal HTML POST fallback. The browser client may also request a short-lived Checkout URL as JSON and then navigate directly to the allowlisted `checkout.stripe.com` host. This keeps card entry on Stripe and improves reliability in mobile and embedded browsers.

Stripe customer and subscription IDs returned by Checkout and webhook events are stored under Stabilize's existing one-way Google account alias.

## Webhook events

The Stripe webhook endpoint is enabled for:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

`checkout.session.completed` grants the subscriber allowance. Subscription lifecycle events keep that allowance accurate after cancellation, pausing, resuming, failed renewal states, or other subscription changes. The canonical webhook URL must be used directly.

## Cloudflare secrets and variables

In **Cloudflare → Workers & Pages → stabilize → Settings → Variables and Secrets**, add:

- `STRIPE_SECRET_KEY` — the Stripe test secret key for the connected sandbox
- `STRIPE_WEBHOOK_SECRET` — the signing secret for webhook endpoint `we_1U01Le96tfbPOBGICBrwkSeS`

Both must be stored as **Secret** values. The publishable key is not required because Checkout is created server-side and hosted by Stripe.

The committed non-secret model-policy values are:

```text
OPENAI_MODEL=gpt-5.4
OPENAI_REASONING_EFFORT=none
MODEL_CHOICES=gpt-5.4|GPT-5.4,gpt-5.6-sol|Current
FREE_DAILY_MODEL_MESSAGE_LIMIT=50
FREE_PLAN_PRIMARY_MODEL=gpt-5.6-sol
FREE_PLAN_FALLBACK_MODEL=gpt-5.4
PAID_MONTHLY_MESSAGE_LIMIT=200
```

The free Current thinking allowance remains available even when Stripe is not configured. Only upgrade and billing-management controls depend on valid Stripe secrets, the recurring Price, and the public origin. Checkout errors appear in the browser instead of failing silently.

## Access and model routing

### Guest

A guest ordinary chat uses the configured fallback model, currently GPT-5.4. Guest usage is not written to Stabilize account memory and does not participate in an account-based model allowance.

### Signed-in free account

Fastest response uses GPT-5.4 so signing in does not switch the user onto a slower default path. Choosing any supported thinking level uses Current (`gpt-5.6-sol`) and consumes one of 50 free Current thinking messages per UTC day. When that allowance is exhausted, the request continues on GPT-5.4 with instant reasoning. The daily counter resets at `00:00 UTC`.

The free-account model tile shows GPT-5.4 by default. The separate thinking-level control opts into Current; a saved historical model preference does not override the free route.

### Subscriber

An account with an `active` or `trialing` subscription may choose from the configured model catalog:

- **GPT-5.4** — always available and does not consume the monthly non-default-model allowance
- **Current** — API model `gpt-5.6-sol`; consumes the subscriber allowance when used

Subscribers receive 200 non-default-model messages per UTC month. Free daily and subscriber monthly counters are stored separately, so changing subscription state does not erase the other counter.

### Thinking level

The browser offers supported thinking levels independently of model billing. The Worker validates the requested effort against the selected model. The strongest `max` level is available only for Current; unsupported or invalid values fall back safely.

### Counting and refunds

A successful ordinary provider response reserves and then confirms the applicable count. Failed provider requests are refunded. Fixed safety, medical, shelter, and medication routes are answered before ordinary model generation and do not consume the free or subscriber allowance.

Each counted response returns the selected model, tier, period, used count, and limit in response headers so the browser can update visible usage immediately. Reloading reads the persisted count from the Billing Durable Object.

## Deploy and test

Run the **Deploy Stabilize to Cloudflare** GitHub Action or deploy with Wrangler. Test billing in Stripe test mode first.

Expected signed-in free flow:

1. Sign in with Google.
2. Send a Fastest response message and confirm GPT-5.4 is selected without increasing the Current allowance.
3. Choose a thinking level, send a message, and confirm Current is selected and the daily count increases.
4. Reload the page and confirm the count remains.
5. In a test environment with a reduced free limit, exhaust the allowance and confirm the next thinking request succeeds on GPT-5.4 with the fallback notice.
6. Confirm the daily period resets at `00:00 UTC`.

Expected subscriber flow:

1. Open the model panel or site menu.
2. Select **Upgrade model allowance**.
3. Complete Stripe Checkout with a Stripe test card.
4. Return to Stabilize and confirm the subscriber allowance is shown.
5. Choose **Current**, send an ordinary message, and confirm the monthly count increases.
6. Choose **GPT-5.4**, send an ordinary message, and confirm the monthly count does not increase.
7. Open **Manage billing** and verify the customer portal works.
8. Cancel the test subscription and confirm the account returns to the free GPT-5.4 plus Current-thinking policy after Stripe sends the subscription update.

## Operational notes

- Account-based allowances require sign-in so they can be enforced without using IP addresses.
- Billing form submissions accept a same-origin browser request even when an embedded browser reports the opaque origin `null`; requests marked cross-site by Fetch Metadata remain blocked.
- The subscriber allowance is granted only for `active` and `trialing` subscription status.
- The sandbox Price and keys must be used together. A live secret key cannot create Checkout with a test-mode Price.
- Do not launch live payments without creating live-mode Stripe resources and reviewing pricing, refunds, taxes, terms, privacy disclosures, support procedures, and applicable app-store or payments rules.
- When model IDs, labels, limits, or routing behavior change, update this guide, `README.md`, `wrangler.jsonc`, public sustainability copy, and the corresponding regression tests together.

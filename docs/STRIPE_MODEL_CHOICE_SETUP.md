# Stripe model-allowance setup

Stabilize lets every signed-in user choose an allowed AI model. Free accounts receive 20 non-default-model messages per UTC day. Stripe-hosted Checkout sells a larger recurring allowance, and Stripe's hosted customer portal handles cancellation and payment-method management. Card numbers are never handled by the Worker.

## Stripe resources created in test mode

The connected Stripe sandbox contains:

- Product: `prod_V01MClXaF8xqB5`
- Product name: **Stabilize Model Choice**
- Description: choose additional AI models, with up to 200 paid-model messages per month
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

The upgrade form has a normal HTML POST fallback. The browser client also requests a short-lived Checkout URL as JSON and then navigates directly to the allowlisted `checkout.stripe.com` host. This makes the button reliable in mobile and embedded browsers while keeping card entry on Stripe.

Stripe customer and subscription IDs returned by Checkout and webhook events are stored under Stabilize's existing one-way Google account alias.

## Webhook events

The Stripe webhook endpoint is enabled for:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

`checkout.session.completed` grants the larger subscriber allowance. Subscription lifecycle events keep that allowance accurate after cancellation, pausing, resuming, failed renewal states, or other subscription changes. The canonical webhook URL must be used directly; Stripe should not have to follow the legacy-domain redirect.

## Cloudflare secrets and variables

In **Cloudflare → Workers & Pages → stabilize → Settings → Variables and Secrets**, add:

- `STRIPE_SECRET_KEY` — the Stripe test secret key for the connected sandbox
- `STRIPE_WEBHOOK_SECRET` — the signing secret for webhook endpoint `we_1U01Le96tfbPOBGICBrwkSeS`

Both must be stored as **Secret** values. The publishable key is not required because Checkout is created server-side and hosted by Stripe.

The committed non-secret limits are:

- `FREE_DAILY_MODEL_MESSAGE_LIMIT=20`
- `PAID_MONTHLY_MESSAGE_LIMIT=200`

The free model picker remains available even when Stripe is not configured. Only the upgrade and billing-management controls depend on valid Stripe secrets, the recurring Price, and the public origin. Checkout errors appear in the browser instead of failing silently.

## Access and model selection

Every signed-in user can save any model on the configured allowlist. On each ordinary chat request, the Worker reads the selected model from the account's Billing Durable Object and passes that model to the OpenAI Responses API.

The current configured choices are:

- **Stabilize default** — always available and does not consume either allowance
- **GPT-5.1**
- **GPT-5 mini**

Free signed-in accounts receive **20 free model-select messages per UTC day**. The daily counter resets at `00:00 UTC`.

Accounts with an `active` or `trialing` subscription receive **200 non-default-model messages per UTC month**. Free daily and subscriber monthly counters are stored separately, so canceling and later reactivating a subscription does not erase prior monthly usage.

Failed provider requests and fixed safety-route replies are refunded and do not consume the applicable allowance.

## Deploy and test

Run the **Deploy Stabilize to Cloudflare** GitHub Action or deploy with Wrangler. Test billing in Stripe test mode first.

Expected free flow:

1. Sign in with Google.
2. Use the **Model** button to the left of the message box.
3. Choose an allowed model and save it.
4. Send up to 20 non-default-model messages that UTC day.
5. After the allowance is used, switch to **Stabilize default** or return after `00:00 UTC`.

Expected subscriber flow:

1. Open the model panel or three-bar menu.
2. Select **Upgrade model allowance**.
3. Complete Stripe Checkout with a Stripe test card.
4. Return to Stabilize and confirm the subscriber allowance is shown.
5. Open **Manage billing** and verify the customer portal works.
6. Cancel the test subscription and confirm the account returns to the free daily allowance after Stripe sends the subscription update; the saved model choice remains available.

## Operational notes

- Model selection requires sign-in so the daily allowance can be enforced without using IP addresses.
- Billing form submissions accept a same-origin browser request even when an embedded browser reports the opaque origin `null`; requests marked cross-site by Fetch Metadata remain blocked.
- The larger allowance is granted only for `active` and `trialing` subscription status.
- The sandbox Price and keys must be used together. A live secret key cannot create Checkout with a test-mode Price.
- Do not launch live payments without creating live-mode Stripe resources and reviewing pricing, refunds, taxes, terms, privacy disclosures, support procedures, and applicable app-store or payments rules.

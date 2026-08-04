# Stripe model-choice setup

Stabilize uses Stripe-hosted Checkout for a recurring Model Choice subscription and Stripe's hosted customer portal for cancellation and payment-method management. Card numbers are never handled by the Worker.

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

The menu form has a normal HTML POST fallback. The browser client also requests a short-lived Checkout URL as JSON and then navigates directly to the allowlisted `checkout.stripe.com` host. This makes the button reliable in mobile and embedded browsers while keeping card entry on Stripe.

Stripe customer and subscription IDs returned by Checkout and webhook events are stored under Stabilize's existing one-way Google account alias.

## Webhook events

The Stripe webhook endpoint is enabled for:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

`checkout.session.completed` grants the initial entitlement. Subscription lifecycle events keep the entitlement accurate after cancellation, pausing, resuming, failed renewal states, or other subscription changes. The canonical webhook URL must be used directly; Stripe should not have to follow the legacy-domain redirect.

## Cloudflare secrets

In **Cloudflare → Workers & Pages → stabilize → Settings → Variables and Secrets**, add:

- `STRIPE_SECRET_KEY` — the Stripe test secret key for the connected sandbox
- `STRIPE_WEBHOOK_SECRET` — the signing secret for webhook endpoint `we_1U01Le96tfbPOBGICBrwkSeS`

Both must be stored as **Secret** values. The publishable key is not required because Checkout is created server-side and hosted by Stripe.

The payment UI remains hidden until the Stripe secret, webhook secret, recurring Price, and public origin have valid formats. Checkout errors are returned to the browser as a visible message instead of failing silently.

## Entitlement and model selection

An `active` or `trialing` subscription unlocks the model selector in the site menu. The signed-in user can save any model on the configured allowlist. On each ordinary chat request, the Worker reads the selected model from the account's Billing Durable Object and passes that model to the OpenAI Responses API.

The current configured choices are:

- **Stabilize default** — remains available without using the paid allowance
- **GPT-5.1**
- **GPT-5 mini**

The Worker defaults to 200 non-default-model messages per UTC calendar month. Failed provider requests and fixed safety-route replies do not consume that allowance.

## Deploy and test

Run the **Deploy Stabilize to Cloudflare** GitHub Action or deploy with Wrangler. Test in Stripe test mode first.

Expected flow:

1. Sign in with Google.
2. Open the three-bar menu.
3. Select **Unlock model choice**.
4. The button changes to **Opening secure checkout…** and navigates to Stripe.
5. Complete Stripe Checkout with a Stripe test card.
6. Return to Stabilize and choose a model.
7. Send a message and confirm the selected model is used.
8. Open **Manage billing** and verify the customer portal works.
9. Cancel the test subscription and confirm model choice becomes unavailable after Stripe sends the subscription update.

## Operational notes

- Billing form submissions accept a same-origin browser request even when an embedded browser reports the opaque origin `null`; requests marked cross-site by Fetch Metadata remain blocked.
- Subscription access is granted only for `active` and `trialing` status.
- The sandbox Price and keys must be used together. A live secret key cannot create Checkout with a test-mode Price.
- Do not launch live payments without creating live-mode Stripe resources and reviewing pricing, refunds, taxes, terms, privacy disclosures, support procedures, and applicable app-store or payments rules.

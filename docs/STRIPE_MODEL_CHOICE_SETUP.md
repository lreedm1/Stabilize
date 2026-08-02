# Stripe model-choice setup

Stabilize uses Stripe-hosted Checkout with Managed Payments for a recurring Model Choice subscription and Stripe's hosted customer portal for cancellation and payment-method management. Card numbers are never handled by the Worker.

## Stripe resources created in test mode

The managed-payments blueprint has been applied to the connected Stripe sandbox:

- Product: `prod_V01MClXaF8xqB5`
- Product name: **Basic subscription**
- Description: **A basic subscription to our service**
- Tax code: `txcd_10103100`
- Default monthly Price: `price_1U01Jp96tfbPOBGIbQNXDlPx`
- Amount: **$10.00 USD per month**
- Webhook endpoint: `we_1U01Le96tfbPOBGICBrwkSeS`
- Webhook URL: `https://reedlokken.com/api/stripe/webhook`

The Price ID is committed as the non-secret `STRIPE_MODEL_CHOICE_PRICE_ID` Worker variable. It does not need to be pasted into Cloudflare.

## Managed Payments Checkout

Checkout Session creation uses:

- `Stripe-Version: 2026-02-25.preview`
- `mode=subscription`
- `managed_payments[enabled]=true`
- the configured recurring Price
- the signed-in account alias as `client_reference_id`
- the same account alias in Checkout and Subscription metadata
- Stripe-hosted success and cancellation URLs

Stripe customer and subscription IDs returned by Checkout and webhook events are stored under Stabilize's existing one-way Google account alias.

## Webhook events

The Stripe webhook endpoint is enabled for:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

`checkout.session.completed` grants the initial entitlement. Subscription lifecycle events keep the entitlement accurate after cancellation, pausing, resuming, failed renewal states, or other subscription changes.

## Cloudflare secrets

In **Cloudflare → Workers & Pages → stabilize → Settings → Variables and Secrets**, add:

- `STRIPE_SECRET_KEY` — the Stripe test secret key for the connected sandbox
- `STRIPE_WEBHOOK_SECRET` — the signing secret for webhook endpoint `we_1U01Le96tfbPOBGICBrwkSeS`

Both must be stored as **Secret** values. The publishable key is not required because Checkout is created server-side and hosted by Stripe.

The payment UI remains hidden until both Stripe secrets are present and valid. The product, Price, webhook endpoint, and Worker code are already configured.

## Deploy and test

Run the **Deploy Stabilize to Cloudflare** GitHub Action or deploy with Wrangler. Test in Stripe test mode first.

Expected flow:

1. Sign in with Google.
2. Open the three-bar menu.
3. Select **Unlock model choice**.
4. Complete Stripe Checkout with a Stripe test card.
5. Return to Stabilize and choose a model.
6. Open **Manage billing** and verify the customer portal works.
7. Cancel the test subscription and confirm model choice becomes unavailable after Stripe sends the subscription update.

## Operational notes

- The default model does not consume the paid-model monthly allowance.
- Safety-routed fixed replies and failed AI requests are refunded from the allowance.
- Subscription access is granted only for `active` and `trialing` status.
- The Worker defaults to 200 non-default-model messages per UTC calendar month.
- Do not launch live payments without reviewing pricing, refunds, taxes, terms, privacy disclosures, support procedures, and Managed Payments eligibility.

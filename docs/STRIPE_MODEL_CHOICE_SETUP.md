# Stripe model-choice setup

Stabilize uses Stripe-hosted Checkout for a recurring Model Choice subscription and Stripe's hosted customer portal for cancellation and payment-method management. Card numbers are never handled by the Worker.

## 1. Create the Stripe subscription price

In Stripe Dashboard:

1. Create a product named **Stabilize Model Choice**.
2. Add one recurring monthly price.
3. Copy the Price ID beginning with `price_`.
4. Configure the customer portal so customers can cancel subscriptions and update payment methods.

Choose a price only after estimating OpenAI usage and leaving margin for Stripe fees, refunds, taxes, failed payments, and unusually heavy users. The Worker defaults to 200 non-default-model messages per UTC calendar month. Change `PAID_MONTHLY_MESSAGE_LIMIT` in `wrangler.jsonc` only after reviewing real costs.

## 2. Create the Stripe webhook

Create a webhook endpoint pointing to:

```text
https://reedlokken.com/api/stripe/webhook
```

Subscribe to these events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

Copy the endpoint signing secret beginning with `whsec_`.

## 3. Add Cloudflare secrets

In **Cloudflare → Workers & Pages → stabilize → Settings → Variables and Secrets**, add:

- `STRIPE_SECRET_KEY` — Stripe restricted or secret key for the same mode as the Price
- `STRIPE_WEBHOOK_SECRET` — webhook endpoint signing secret
- `STRIPE_MODEL_CHOICE_PRICE_ID` — recurring Price ID

Store all three as Secret values. Test-mode keys, webhooks, and Prices must all be test mode; live-mode values must all be live mode.

The payment UI remains hidden until all three values are present and valid.

## 4. Deploy and test

Run the **Deploy Stabilize to Cloudflare** GitHub Action or deploy with Wrangler. Test in Stripe test mode first using Stripe's test cards.

Expected flow:

1. Sign in with Google.
2. Open the three-bar menu.
3. Select **Unlock model choice**.
4. Complete Stripe Checkout.
5. Return to Stabilize and choose a model.
6. Open **Manage billing** and verify the portal works.
7. Cancel the test subscription and confirm model choice becomes unavailable after Stripe sends the subscription update.

## Operational notes

- The default model does not consume the paid-model monthly allowance.
- Safety-routed fixed replies and failed AI requests are refunded from the allowance.
- Stripe customer and subscription IDs are stored under Stabilize's one-way Google account alias.
- Subscription access is granted only for `active` and `trialing` status.
- Do not launch live payments without reviewing pricing, refunds, tax collection, terms, privacy disclosures, and support procedures.

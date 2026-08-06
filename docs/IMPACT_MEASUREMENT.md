# Orderly impact measurement

Stabilize uses an intentionally small operating loop:

1. Ask one optional question after an eligible, non-emergency response: **“Did you choose a next step?”**
2. Keep one structured event state for that response: `shown`, `yes`, `partly`, or `no`.
3. Review six dashboard numbers.
4. Make one bounded product decision for the week.

The optimization target is reported next steps per dollar, subject to safety, privacy, trust, and reliability guardrails.

## What is stored

The impact layer distributes writes across 16 SQLite-backed Durable Object shards rather than routing the whole site through one global object. Each eligible response has at most one `next_step_reported` row. The row begins as `shown` and is updated to `yes`, `partly`, or `no` when the user answers. A late retry cannot overwrite an answer.

The store contains only structured outcome state, broad route and completion metadata, configured cost metadata, and one-way HMAC hashes of random browser and tab identifiers. It never stores the user’s message or the assistant’s reply. The browser identifier rotates after 30 days; the tab identifier ends with the tab. Records expire after the configured retention period, which defaults to 180 days.

Immediate-danger, medical-emergency, and safety-unclear routes do not receive the ordinary outcome question. The question is optional and includes a Skip control. Every submitted event must match a server-created chat turn with the same hashed browser and tab identifiers. Writes are same-origin, allow-listed, idempotent, and rate-limited.

## Six dashboard numbers

The protected `/admin/impact` dashboard shows only:

1. Eligible checks shown
2. Reports received
3. Response rate
4. Reported next-step rate
5. Estimated cost per reported next step
6. Self-funding ratio

A reported next step means the user answered `yes`. `partly` and `no` contribute to the response count but are not counted as resolved. Nonresponse remains unknown rather than being labeled failure.

The dashboard then presents one operating decision for the week. Its conservative rules prioritize sufficient sample, response collection, reliability, reported usefulness, real cost inputs, and recurring sustainability—in that order. Only one product variable should be changed before the next review.

## Private dashboard setup

Set a private Worker secret with at least 24 characters:

```bash
npx wrangler secret put IMPACT_ADMIN_SECRET
```

Without that secret, outcome collection still works, but the dashboard returns a setup page instead of exposing data.

Set these non-secret variables in `wrangler.jsonc` when real operating data is available:

- `IMPACT_ESTIMATED_CHAT_COST_MICROS`
- `IMPACT_MONTHLY_RECURRING_REVENUE_CENTS`
- `IMPACT_MONTHLY_RECURRING_COST_CENTS`
- `IMPACT_RETENTION_DAYS`

A zero cost or revenue value leaves the related dashboard tile marked as not configured. Grant proceeds should not be entered as recurring revenue.

# Outcome measurement and orderly-impact dashboard

Stabilize measures whether a completed, non-emergency response produced a useful resolution. The web interface asks one optional clarity question, records the structured resolution selected by the user, and occasionally asks whether the response intensity was proportionate.

## What is stored

The impact layer distributes writes across 16 SQLite-backed Durable Object shards rather than routing the whole site through one global object. Each shard stores only structured fields: event type, selected value, broad response type, safety route, response status and timing, configured estimated cost, app/prompt version, and one-way HMAC hashes of random browser and tab identifiers. It never stores the user's message or the assistant's reply. The browser identifier rotates after 30 days; the tab identifier ends with the tab. Records expire after the configured retention period, which defaults to 180 days.

Urgent fixed routes do not show the ordinary outcome prompt. Every submitted outcome event must match a server-created chat turn with the same hashed browser and tab identifiers. Event names and values are allow-listed and rate-limited.

## Private dashboard

The dashboard is available at `/admin/impact`. Set a private Worker secret with at least 24 characters:

```bash
npx wrangler secret put IMPACT_ADMIN_SECRET
```

Without that secret, outcome collection still works but the dashboard returns a setup page instead of exposing data.

The dashboard reports:

- reported resolution and a conservative lower bound across all eligible prompts
- clarity and resolution selections
- unique sessions and rotating browser identifiers
- route distribution, completion, latency, and requested revisions
- proportional-response feedback
- estimated cost per resolution
- a self-funding ratio based on configured recurring revenue and recurring cash cost

Set the following non-secret variables in `wrangler.jsonc` as real operating data becomes available:

- `IMPACT_ESTIMATED_CHAT_COST_MICROS`
- `IMPACT_MONTHLY_RECURRING_REVENUE_CENTS`
- `IMPACT_MONTHLY_RECURRING_COST_CENTS`
- `IMPACT_RETENTION_DAYS`

A value of `0` leaves cost or self-funding tiles marked as not configured. Grant proceeds should not be entered as recurring revenue.

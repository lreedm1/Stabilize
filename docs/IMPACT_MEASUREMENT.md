# Orderly impact measurement

Stabilize uses a small, privacy-bounded operating loop:

1. When the model reply itself indicates that a few follow-up actions would materially reduce effort, show up to three optional action buttons beside the response-feedback icons.
2. Keep one structured next-step event state for that response: `shown` when those actions appear and `yes` when one is selected.
3. Ask a separate optional whole-conversation question only after New conversation succeeds.
4. Review engagement, helpfulness, outcomes, reliability, and cost before making one bounded product change.

The optimization target is useful next steps per dollar, subject to safety, privacy, trust, and reliability guardrails.

## What is stored

The impact layer distributes writes across 16 SQLite-backed Durable Object shards rather than routing the whole site through one global object. Each response can have at most one `next_step_reported` row. The row begins as `shown` only when model-relevant follow-up actions are surfaced and advances to `yes` when the user selects one. A late retry cannot overwrite an answer. Historical `partly` and `no` values remain supported for compatibility, but the inline action interface does not ask a separate Yes / Partly / No next-step survey.

The store contains structured outcome state, broad route and completion metadata, configured cost metadata, optional response-feedback reason codes and comments, and one-way HMAC hashes of random browser, tab, and conversation identifiers. It never stores the user’s message or the assistant’s reply in impact analytics. The browser identifier rotates after 30 days, the tab identifier ends with the tab, and the conversation identifier rotates after New conversation succeeds. Records expire after the configured retention period, which defaults to 180 days.

Immediate-danger, medical-emergency, and safety-unclear routes do not receive ordinary follow-up actions. Ordinary follow-up actions are also omitted unless the model reply contains a relevant domain and an explicit action cue, or the selected route is one of the small allow-listed support routes. Every submitted event must match a server-created chat turn with the same hashed browser and tab identifiers. Writes are same-origin, allow-listed, idempotent, and rate-limited.

## Dashboard

The protected `/admin/impact` dashboard covers:

- eligible next-step actions shown, selected actions, response rate, and estimated cost per reported next step
- conversations started, second-message rate, and returning-browser rate
- response-feedback rate, helpful-response rate, reason counts, and recent private comments
- whole-conversation feedback and help rates
- response failures, average response time, daily usage, estimated cost per helpful response, and self-funding ratio

A reported next step means the user selected one of the optional follow-up actions. Nonselection remains unknown rather than being labeled failure. The weekly decision panel prioritizes sufficient sample, response collection, reliability, reported usefulness, real cost inputs, and recurring sustainability—in that order. Only one product variable should be changed before the next review.

## Private dashboard access

Production stores only the SHA-256 fingerprint of a high-entropy dashboard password in `IMPACT_ADMIN_PASSWORD_SHA256`. The raw password is delivered out of band and is never committed to GitHub or stored in Worker configuration. The existing `AUTH_SECRET` signs the seven-day, HTTP-only dashboard cookie, so changing either the password fingerprint or `AUTH_SECRET` invalidates old sessions.

Use a randomly generated password with at least 192 bits of entropy. A human-chosen password must not be used with an unsalted public fingerprint. To rotate access, generate a new random password, replace `IMPACT_ADMIN_PASSWORD_SHA256` with its lowercase SHA-256 hex fingerprint, deploy, and distribute the new raw password privately. Colons or hyphens may be inserted between fingerprint groups for readability.

`IMPACT_ADMIN_SECRET` remains available only as a local-development fallback. It is not required for production.

Set these non-secret variables in `wrangler.jsonc` when real operating data is available:

- `IMPACT_ESTIMATED_CHAT_COST_MICROS`
- `IMPACT_MONTHLY_RECURRING_REVENUE_CENTS`
- `IMPACT_MONTHLY_RECURRING_COST_CENTS`
- `IMPACT_RETENTION_DAYS`

A zero cost or revenue value leaves the related dashboard tile marked as not configured. Grant proceeds should not be entered as recurring revenue.

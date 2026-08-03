# OpenAI Conversations integration

Stabilize uses the Responses API for generation and an OpenAI Conversation for cross-visit continuity only when the browser is bound to a valid signed-in account session.

## Request modes

- **Guest:** sends bounded input to `POST /v1/responses` with `store: false`. It does not create account memory or a Conversation, even if a different tab signs in later.
- **Signed in:** creates an empty account-scoped `conv_*` container, durably adopts its identifier, and only then sends up to 19 bounded local recovery items plus the current user message. Later requests send only the current user message. Every request supplies `conversation`, `store: false`, and `truncation: "auto"`: completed input/output items attach to the Conversation for continuity, while no separately retained Response object is created.
- **Summary compaction:** remains a separate stateless Responses request with `store: false`.

The browser sends the exact guest/account continuity mode rendered into the page. A missing binding is treated as guest mode. An account-mode request whose opaque session binding no longer matches receives `409` and must reload; it cannot write into the newly signed-in account.

## Concurrency and recovery

The account Durable Object is the transaction coordinator:

1. It grants one time-bounded provider-turn lease and epoch.
2. A newly created Conversation is adopted only while that exact lease is live. Losing candidates are durably queued for cleanup.
3. The model reply and bounded local exchange commit only if the lease, epoch, and active Conversation still match.
4. A newer fixed safety route or retention expiry increments the epoch, invalidates an in-flight turn, and forces a later Conversation reseed.
5. Timeouts, connection failures, invalid outputs, and expired leases quarantine the provider Conversation. Cleanup starts after a quiet period because an upstream request may have completed after the Worker stopped waiting.
6. Only a provider error explicitly identifying the Conversation as missing triggers one create-and-retry cycle. An unrelated `404` preserves valid Conversation state.

Legacy local writes fail closed after the persistent-state epoch has activated, even when no lease remains. Current demo/local writes use a separate epoch-aware method. This protects a deploy window in which an older Worker invocation overlaps the new Durable Object schema.

## Retention and deletion

Local summary/recent text expires after 30 days of inactivity. Expiry is enforced inside every write as well as by the alarm, so a delayed alarm or stale completion cannot revive expired context.

Deleting a Conversation object does not delete its items. Cleanup therefore:

1. lists a strictly validated page of items;
2. deletes every validated item;
3. processes one bounded page per alarm and retries until a validated empty page is observed;
4. deletes the Conversation object.

Malformed listings and ambiguous list `404` responses are failures, not proof of deletion. Local text is still erased on schedule; only an opaque Conversation-ID tombstone remains for retry. The tombstone contains no chat text or Google identity.

The account menu exposes explicit deletion. It erases local text synchronously, durably queues any provider Conversation for item-first cleanup, rotates the browser session binding, and issues a five-minute signed receipt bound to the replacement session. The redirect consumes that receipt before displaying success; a query parameter alone cannot claim deletion. Signing out alone does not delete remembered conversation data.

Provider-side automatic truncation means older context can stop influencing replies before the 30-day deletion deadline. The bounded local summary/recent buffer is retained as recovery seed, not as a visible transcript archive.

## Secrets and permissions

- `OPENAI_API_KEY` must permit both Responses and Conversations operations.
- `AUTH_SECRET` is the stable HMAC key used to derive account aliases. Rotating it orphans existing account-scoped objects.
- `SESSION_SECRET` is a required, separate key for login, continuity, and OAuth-state cookies so cookie revocation does not change account aliases. Legacy v1 cookies are accepted only if issued before the fixed August 17, 2026 at 00:00 UTC rollout cutoff and expire no later than 30 days afterward. Production must finish deploying this release before that cutoff; if the rollout moves, advance the fixed timestamp and its boundary test before deployment.

Never put any of these values in source, browser code, or plain-text Wrangler variables.

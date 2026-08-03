# Account memory integration

Stabilize provides cross-visit continuity only when a browser is bound to a valid signed-in account session. Continuity is stored in one account-scoped Cloudflare Durable Object; OpenAI is used only for stateless generation with `store: false`.

## Request modes

- **Guest:** sends bounded current input to the Responses API with `store: false`. It creates no server-side conversation memory, even if another tab signs in later. The current tab may cache the latest assistant reply for up to 24 hours; the prompt itself is not placed in that record, although a reply can repeat prompt details.
- **Signed in:** reads a bounded rolling summary and recent-message buffer from the account Durable Object, sends that context plus the current message to the Responses API with `store: false`, and commits the exchange locally only after a valid reply returns.
- **Summary compaction:** uses a separate Responses request with `store: false` and applies the result only if its exact state epoch is still current.

The browser sends the exact guest/account continuity mode rendered into the page. A missing binding is treated as guest mode. An account request whose opaque session binding no longer matches receives `409` and must reload; it cannot write into a newly signed-in account.

## Concurrency and retention

The Durable Object grants one 90-second model-turn lease per account. A commit succeeds only when its lease token and epoch still match. A newer fixed safety route, explicit deletion, or retention expiry increments the epoch and invalidates any stale completion. The outermost Worker also records request start before billing or other wrappers can wait, so a request that began before deletion cannot be reclassified as a post-deletion write.

Only a committed exchange refreshes retention. Local text expires 30 days after the last committed exchange, with enforcement inside reads and writes as well as by the Durable Object alarm. Expired context cannot be revived by a delayed model response.

The stored record is intentionally bounded:

- a rolling summary of at most 1,000 characters;
- at most eight recent user/assistant messages pending compaction;
- an awaiting-safety-answer flag, turn count, and timestamps; and
- short-lived lease and epoch coordination fields.

This is not a visible transcript archive. Compaction is model-generated and may omit details or preserve an inaccurate interpretation; the current message always takes precedence.

## Deletion and account boundaries

The account menu atomically validates the deleting session, erases the Durable Object text, and advances a monotonic session-issuance watermark. Only one of two concurrent deletion requests can advance that watermark. A successful deletion receives the exact next session generation; cookies issued at or before the watermark are rejected by memory, billing, model-choice, feedback, and account-page wrappers and must sign in again. A short-lived signed browser receipt displays confirmation after redirect and is normally consumed and cleared by the next page; it is not a server-side single-use token. A query parameter alone is never treated as proof of deletion.

Signing out does not delete remembered account data. Rotating `AUTH_SECRET` changes account aliases and can orphan existing Durable Objects; rotate the separate `SESSION_SECRET` when cookie revocation is the goal.

## Provider behavior

All guest, signed-in, and compaction Responses requests set `store: false`. Stabilize does not create OpenAI Conversation containers and does not use `previous_response_id` for persistence. OpenAI and infrastructure providers may still process request content and metadata, including any applicable abuse-monitoring retention under the deployment's terms and data controls.

## Operator obligations

- Keep `OPENAI_API_KEY`, `AUTH_SECRET`, `SESSION_SECRET`, and Google OAuth secrets in Worker secrets.
- Keep `AUTH_SECRET` stable; provision `SESSION_SECRET` before deploying this version.
- Restrict Durable Object and operational-log access.
- Do not add prompt, reply, account-alias, email, or network-address logging by default.
- Establish deletion, incident-response, credential-rotation, and legal-request procedures.
- Obtain independent privacy, security, and legal review before broad public launch.

# Conversation memory integration

Stabilize provides same-browser guest continuity and cross-device signed-in continuity. Guest and account records use separate Cloudflare Durable Object namespaces. Reply and compaction requests use the OpenAI Responses API with response storage enabled; they do not use OpenAI Conversations for continuity.

## Request modes

- **Guest:** a signed host-only `HttpOnly` cookie holds a random 256-bit guest key, timing data, and nonce. A separate non-bearer HMAC rendered into the page binds requests to that cookie. The guest Durable Object stores the same bounded context shape as account memory. The latest assistant reply may also be written to token-partitioned browser local storage; the prompt and full transcript are not placed there, although a reply can repeat prompt details. Records older than 30 days are ignored, and the app attempts to remove them on the next successful load. Browser or profile backups, unavailable JavaScript, or unavailable storage access may retain copies longer.
- **Signed in:** reads a bounded rolling summary and recent-message buffer from the account Durable Object, sends that context plus the current message to the Responses API with `store: true`, and commits the exchange locally only after a valid reply returns.
- **Summary compaction:** uses a separate Responses request with `store: true` and applies the result only if its exact state epoch is still current.

The browser sends the exact guest/account continuity mode and binding rendered into the page. A cached client with no guest binding remains stateless until reload. Any mismatch receives `409` before model or memory access. A valid account session always wins over a stale guest tab. Guest memory is preserved separately through sign-in and resumes after sign-out; it is never merged into account memory.

## Concurrency and retention

Each Durable Object grants one 90-second model-turn lease. A commit succeeds only when its lease token and epoch still match. A newer fixed safety route, explicit deletion, or retention expiry increments the epoch and invalidates any stale completion. The outermost Worker also records request start before billing or other wrappers can wait, so a request that began before deletion cannot be reclassified as a post-deletion write.

Only a committed exchange refreshes retention. Local text expires 30 days after the last committed exchange, with enforcement inside reads and writes as well as by the Durable Object alarm. Expired context cannot be revived by a delayed model response.

The stored record is intentionally bounded:

- a rolling summary of at most 1,000 characters;
- at most eight recent user/assistant messages pending compaction;
- an awaiting-safety-answer flag, turn count, and timestamps; and
- short-lived lease and epoch coordination fields.

This is not a visible transcript archive. Compaction is model-generated and may omit details or preserve an inaccurate interpretation; the current message always takes precedence.

## Deletion and account boundaries

The menu validates the exact session binding before deletion. Account deletion erases text and advances a monotonic issuance watermark across account features. Guest deletion erases text, retains only a non-text revocation tombstone until the old one-year cookie horizon, and issues a completely new random guest identity; the tombstone is then removed with `deleteAll()`. Losing, stale, and invalid responses never clear or replace the guest cookie. A short-lived scope-bound signed receipt displays confirmation after redirect and identifies only the continuity partition whose pending-deletion marker may be cleared; a query parameter alone is never proof.

Clearing cookies removes browser access but cannot prove immediate erasure of the now-unreachable guest record; its text still expires after 30 days and its metadata is hard-deleted by the cookie horizon. Signing out does not delete account or guest memory. Rotating `AUTH_SECRET` changes account aliases; `SESSION_SECRET` revokes account cookies; `GUEST_SESSION_SECRET` revokes guest cookies and may orphan guest records until cleanup.

## Provider behavior

All guest, signed-in, and compaction Responses requests set `store: true`. Under current OpenAI platform policy, the resulting Response objects are retained for at least 30 days unless organization or project data controls, including Zero Data Retention, override that behavior; separate abuse-monitoring retention may also apply. Stabilize does not create OpenAI Conversation containers, use `previous_response_id` for continuity, or retain provider response IDs. The in-app Delete control removes live remembered data from Stabilize, but it cannot target those separate OpenAI Response objects; those remain governed by OpenAI project and organization controls.

## Operator obligations

- Keep `OPENAI_API_KEY`, `AUTH_SECRET`, `SESSION_SECRET`, `GUEST_SESSION_SECRET`, and Google OAuth secrets in Worker secrets; all three identity/session secrets must differ.
- Keep `AUTH_SECRET` stable; provision both `SESSION_SECRET` and `GUEST_SESSION_SECRET` before deploying this version.
- Restrict Durable Object and operational-log access.
- Do not add prompt, reply, account-alias, email, or network-address logging by default.
- Establish deletion, incident-response, credential-rotation, and legal-request procedures.
- Obtain independent privacy, security, and legal review before broad public launch.

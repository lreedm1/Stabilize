# Complimentary-token budget

Stabilize now has one durable token ledger for the primary OpenAI model group.
It covers guest, private, signed-in and subscriber replies, streaming fallback
attempts, account-memory summaries, the retained guest-summary helper, and
`chat.uwmadison.stabilize.info`. The account's 50-message/200-message limits are
separate from this global token budget.

Before every reservation, the Durable Object reads the organization's current
UTC-day input and output totals from OpenAI's Usage API. The request has **no
project, key, model, batch, or processing-tier filter**: it includes other apps,
including Astra usage, and conservatively includes models in other free pools.
Cached input and other token subtotals are already included in these totals.

## Activation

The production configuration reserves a 10% margin on a **1,000,000-token daily
allowance**, stopping at **900,000 tokens**. The owner approved activation after
organization enrollment and Tier 3 eligibility were inspected, a Usage API
read-only admin key was created, and the owner reported saving the Worker
secrets. The confirmation flag is enabled; credential validity is still checked
at runtime, and failed checks pause generation. Fixed safety responses and the
rest of the site continue to work.

Before merging/deploying an active configuration, the organization owner must:

1. Verify that the organization shows enrollment in complimentary daily tokens,
   that the project supplying `OPENAI_API_KEY` shares eligible inputs/outputs,
   and that its current allowance is 1M for this model group. For a 250K
   allowance, set `OPENAI_FREE_TOKEN_ALLOWANCE=250000` and
   `OPENAI_FREE_TOKEN_DAILY_LIMIT=225000` instead.
2. Check the Usage dashboard's **data sharing incentive tier** against Costs for
   this project's Standard traffic. This patch does not change data-sharing
   settings, create an API key, or enable sharing on the owner's behalf.
3. Stop other applications, previews, scripts and projects from consuming this
   organization's same free-token group, or route them through this same ledger.
   A separate API key or project alone does not give it a separate free pool.
   Independent Worker deployments have independent Durable Object namespaces.
4. Configure the Worker's required `OPENAI_USAGE_ADMIN_KEY` secret with an OpenAI
   admin key authorized to read organization usage, and `OPENAI_ORGANIZATION_ID`
   with that organization's ID. These are separate from `OPENAI_API_KEY`.
   Use the narrowest usage-read permissions available. Store the admin key only
   as a Worker secret; never put it in the repository, browser, logs, or chat.
   The usage lookup sends it only to the fixed Usage API endpoint. Counting and
   generation retain the ordinary chat key and explicitly select the same org.
   Missing credentials or denied usage access stop protected requests.
5. Set `OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED=true` in `wrangler.jsonc` after
   these checks. Keep `OPENAI_FREE_TOKENS_ONLY=true`. Explicit Wrangler vars
   should be treated as the source of truth when redeploying.

The deployment gate waits for the public free-token-mode marker before sending
its chat probe. It accepts a complete streamed reply or the specific daily-budget
denial produced after successful input counting and organization usage lookup.
Missing credentials, failed usage checks, and other provider errors fail the gate.

The ledger's first reservation initializes it but denies generation for the rest
of that UTC day because prior provider usage is unknown. Requests can begin after
the next **00:00 UTC** reset. Do not delete the ledger or change its object name
to reset usage during a day. Keep a positive API balance, as OpenAI requires this
even for complimentary traffic.

An enforced project spend limit is a useful additional backstop, but provider
enforcement can lag. The Usage API check detects **reported** usage from other
applications; it cannot reserve their concurrent requests or prove that the
provider has reported all recent usage. This app-side ledger also cannot establish
continued enrollment or detect revocation of the incentive. Recheck eligibility
if billing or account settings change;
set the confirmation flag to `false` while uncertain. This is a conservative
admission control, not a provider guarantee that the bill will be exactly zero.

## Request accounting

- Every reservation fetches `/v1/organization/usage/completions` for **00:00 UTC
  through the next 00:00 UTC**, using one-day buckets. All pagination must finish
  within an eight-second timeout; HTTP errors, malformed/missing data, invalid
  totals, and incomplete pagination deny generation. Only an explicit successful
  empty report counts as zero. Failed checks never reuse an earlier success.
- The ledger keeps the highest reported total for the UTC day. Admission checks
  `reported high-water mark + locally completed tokens + outstanding reservations
  + new reservation <= daily limit`. Local usage is deliberately added even if
  some of it is already reflected in OpenAI's aggregate: there is no safe way to
  prove the overlap from an unfiltered aggregate. This can stop generation well
  before 900K actual tokens (roughly 450K if all traffic is local and reporting
  is current), in exchange for avoiding undercounting during reporting delays.
  Checking only `max(reported, local)` would miss recent local usage whenever
  the reported total is larger and has not caught up.
- The check must be from the same UTC day and no more than 15 seconds old both
  during the atomic reservation and immediately before generation. A midnight
  rollover, a changed organization, or an expired check denies the request.
  Reported usage resets at UTC midnight; uncertain reservations remain held.
- Only `gpt-5.4` and `gpt-5.6-sol` are approved. Both consume the **same** ledger;
  switching to GPT-5.4 cannot bypass the daily stop. New models need review.
- Each request is sent to `/v1/responses/input_tokens` before generation, with
  the same normalized input, instructions, reasoning and text configuration.
  A failed/invalid count stops the request. Counting and organization usage each
  add a provider round trip before generation.
- The ledger atomically reserves exact input + maximum output + 256 tokens.
  Existing smaller output caps are preserved; otherwise a hard 8,192-token cap
  bounds reasoning and visible output together. High-effort requests can reach
  this cap before producing a complete answer.
- Standard processing is forced at the network boundary. Fast/Priority
  eligibility is unverified. Explicit cache-write directives are removed.
  Tools, images/files, stored conversation references, and unknown payload fields
  are rejected. The legacy `OPENAI_SERVICE_TIER=fast` setting only affects the
  explicit rollback mode; free-only mode always sends `default`.
- Terminal usage reconciles the reservation exactly once. Cached input counts;
  reasoning is already included in output tokens. Each retry reserves anew.
- Missing/invalid usage, HTTP failures, canceled streams, provider timeouts, or
  settlement failures retain the complete reservation. These unknown holds
  carry over across midnight until reconciled, so available quota may be lower
  than the provider dashboard. They never expire automatically.
- At midnight settled usage resets. Outstanding requests still count against
  the new day; late receipts are conservatively charged to that day. An actual
  count larger than its reservation suspends the ledger until investigated.
- Storage contains token counts and opaque reservation IDs, not prompts or keys.
  Reservation IDs match the provider's `X-Client-Request-Id` and are logged with
  reserved token counts for reconciliation; no chat content is included.
  Settled receipts are retained for seven days for idempotence, then cleaned up.
  No public endpoint can reset or refund the ledger. Recover unknown reservations
  only against authoritative provider usage; do not clear them to restore access.

`OPENAI_FREE_TOKENS_ONLY=false` is an explicit operator rollback to legacy paid
behavior. It is used by existing isolated provider/schema tests and must **not**
be used to resolve a production budget error. An absent/malformed flag keeps
protection enabled. Missing confirmation, invalid budgets or missing storage
fail closed.

## Development and validation

`npm run apply:prompt-policy` also runs the `postapply:prompt-policy` hook to
restore budget integration after older generators rewrite provider functions.
Run the npm command, not individual historic generators, before committing.
The hook also preserves the existing tests' explicit legacy mode; dedicated
`token-budget` tests exercise protection with mocked OpenAI responses and real
Cloudflare Durable Object storage. No live OpenAI requests are needed for tests.

Run `npm test`, `npm run check`, and after committing generated outputs,
`npm run verify:clean`. The migration adds `OpenAITokenBudget` under
`v5-token-budget` without changing existing Durable Object classes.

References checked September 24, 2026:

- [Data-sharing incentive and quota rules](https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai)
- [Counting tokens](https://developers.openai.com/api/docs/guides/token-counting)
- [Organization usage API](https://developers.openai.com/api/reference/ruby/resources/admin/subresources/organization/subresources/usage/methods/completions)
- [Responses output limit](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create)
- [Spend limits](https://developers.openai.com/api/docs/guides/spend-limits)

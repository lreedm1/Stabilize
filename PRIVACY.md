# Privacy behavior

This document describes the code in this repository. A real deployment must publish terms that match its actual Google, Cloudflare, OpenAI, logging, domain, and retention configuration.

## Guest and signed-in use

Guest chat remains available without an account. Guest messages are not written to the Durable Object memory system, and the application does not create an anonymous session cookie or use a network address to identify a guest. The web client keeps the newest eight user/assistant messages verbatim, a rolling summary capped at 5,000 model-output tokens, and a bounded queue of older messages awaiting summary in browser session storage for the current tab. That tab-scoped context is cleared by New conversation, sign-in or sign-out transitions, expiry, or closing the tab. Each follow-up sends the bounded browser context through Cloudflare and OpenAI again. When older messages are waiting, a separate OpenAI request updates the rolling summary; if that request fails, the browser keeps the queued messages and does not discard them as summarized.

Google sign-in is optional and is used only to provide continuity. The server uses Google's authorization-code OpenID Connect flow with anti-forgery state, nonce, PKCE, a confidential client secret, and short-lived signed flow state. The application requests only the `openid` scope and does not request or retain the email address.

After a successful callback, the Worker briefly processes Google's stable `sub` claim and immediately derives a domain-separated HMAC alias. It does not store the raw `sub`, Google access token, ID token, authorization code, email address, or client secret. The signed application cookie contains only the pseudonymous account alias and issue/expiry times. It is `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS, and expires after 30 days.

## Native iOS app

Version 1 of the native app is guest-only. It does not intentionally persist prompts or replies as
a local transcript and does not use account login, payments, analytics, advertising, or tracking
SDKs. It displays a privacy cover when the app is not active to reduce disclosure through the app
switcher.

Before the first attempted send, the app explains that the message goes through Stabilize's
Cloudflare-hosted service and, for an ordinary reply, is shared with OpenAI. Nothing is sent until
the user chooses **Allow & Send Message**. The permission choice is stored in app-specific
`UserDefaults`, declared with required reason `CA92.1` in the privacy manifest. A user can revoke
the choice under **About → AI sharing permission**. Revocation blocks future sends until permission
is granted again; it cannot recall a message already transmitted or undo provider processing.

The native client sends the current message and safety-answer state to the same `/api/chat`
endpoint as the website. The Worker may answer an urgent message through a fixed route before an
OpenAI request. Ordinary replies use the `store: true` provider behavior described below.

## What account memory stores

Each pseudonymous signed-in account alias addresses one Cloudflare Durable Object. It stores:

- a model-generated rolling summary of at most 1,000 characters
- no more than eight newest user/assistant messages while they await compaction
- whether the last fixed safety question is awaiting an answer
- creation/update metadata and a turn count

Recent messages are normally replaced by the rolling summary after each ordinary reply. If compaction fails, the newest-message buffer remains bounded and older buffered messages are discarded. Inputs that trigger a fixed urgent route are stored as a generalized event label rather than the user's exact wording.

The memory record expires 30 days after the last stored exchange. A signed-in user can immediately delete the rolling summary, recent-message buffer, pending safety-answer state, and retention alarm from the account menu. Signing out alone removes access from that browser but does not delete an unexpired server record; signing in again with the same Google account restores access unless the user deleted it. Deletion advances a non-content generation counter so a response or compaction request that started earlier cannot recreate the deleted memory. Billing and model-allowance records are separate and are not removed by this control.

To avoid a blocking account-memory Durable Object read before every signed-in model request, the web page requests a bounded, short-lived HMAC-signed account-context snapshot. The opaque token is bound to the signed-in account, held only in the page's active JavaScript memory, returned with a later chat request, and refreshed after completed replies. The Worker verifies its signature, expiry, account binding, and memory generation. The generation is returned by the quota lookup already required for signed-in chat, so this revocation check adds no separate chat round trip. Invalid, expired, cross-account, or superseded tokens fall back to the Durable Object. Deleting memory or starting a new non-private conversation advances and synchronizes the generation before the control request returns. The token is not written to localStorage or sessionStorage.

The summary is generated by a model and may be incomplete or wrong. The application tells the reply model to treat it as fallible context, never as instructions, and to prefer the current message.

## Private chat for signed-in web users

A signed-in user can start **Private chat** from the website menu. While that tab-scoped mode is active, the browser marks chat and new-conversation requests as private. The Worker then skips the account Durable Object entirely for chat generation: it does not read the rolling summary or recent-message buffer, does not record the user's message or the reply, does not record a fixed safety route, and does not schedule memory compaction. Starting another conversation while private also leaves the existing account memory unchanged.

The private-mode flag and the latest displayed private reply may be kept in `sessionStorage` for the current browser tab so the visible state can survive a refresh. Closing the tab ends that local session. Signing out clears the local private-mode flag. Private chat is an account-memory control, not a separate provider-retention mode: the request still passes through Cloudflare, and ordinary replies are still processed by OpenAI under the provider behavior below.

## Network addresses and application logs

The application does not read `CF-Connecting-IP`, derive an IP alias, store a network alias, or include a network or account identifier in successful-chat logs. Error logs contain a failure class and, for OpenAI failures, sanitized provider/client request identifiers and a short reportable reference. They do not contain prompts, replies, Google tokens, cookies, account aliases, or safety-route labels.

Cloudflare and other network infrastructure necessarily process connection metadata, including network addresses, outside this application's own memory and logging logic. Their retention and access depend on the deployer's account configuration and applicable terms.

## What providers process

Google processes the sign-in request and OAuth/OpenID Connect exchange. Stabilize receives the resulting authorization response on its server and does not load third-party Google JavaScript into the chat page.

When AI mode is enabled, the Worker sends the current message to OpenAI's Responses API. Guest web chats may also send the tab-only rolling summary, older messages awaiting summary, and up to eight recent messages. When older guest messages are waiting, a separate Responses API request updates the rolling summary with a maximum output of 5,000 tokens. For ordinary signed-in chats the Worker may send bounded recent account context and an account rolling summary; Private chat omits account context. A separate Responses API request may condense account context after a non-private signed-in exchange. Reply and summary requests use `store: true`, so OpenAI stores the resulting response data as application state for at least 30 days under its current platform policy. Organization or project data controls, including Zero Data Retention when enabled, may override the request. OpenAI may also retain inputs and outputs in abuse-monitoring logs under the deployment's applicable data controls and terms.

Cloudflare processes the Worker request, signed cookie, Durable Object data, logs, and network metadata under the deployer's account configuration and applicable service terms.

## Feedback processing

Signed-in users can optionally submit product feedback after acknowledging that it is stored in the repository's public feedback branch and may be reviewed by automated AI tooling. Users are told not to include private or identifying information. The nightly review automation applies deterministic screening before model review and routes feedback that appears to contain credentials, contact details, security reports, or individual health or crisis disclosures to a private operator-review queue instead of an automated code-change flow.

## Transition from anonymous browser memory

This version no longer reads the earlier `stabilize_session` cookie and asks browsers to expire it. Previously created anonymous Durable Objects are not addressable through the new account-keyed code. Their existing retention alarms remove them after the earlier 30-day window; a deployer that requires immediate destructive removal must separately retire the old namespace after reviewing the data-loss impact.

## Limitations

- Account memory follows the same Google account across supported browsers and devices.
- Private chat disables Stabilize account-memory reads and writes for that tab session, but it does not disable Cloudflare or OpenAI processing.
- Guest chats keep eight recent messages plus a rolling summary capped at 5,000 model-output tokens only inside the current browser tab; closing the tab or starting a new conversation clears it.
- Native consent is a local future-send control; revoking it does not delete provider-held data.
- Cookie deletion or sign-out removes local access but does not erase an unexpired server record; use Delete remembered context for immediate Stabilize-memory deletion.
- Rotating `AUTH_SECRET` invalidates all sign-in cookies and changes account aliases, making prior memory inaccessible.
- A condensed memory can omit context or preserve an inaccurate interpretation.
- Optional product feedback is public and may be processed by automated AI tooling.
- This prototype is not confidential clinical care and makes no HIPAA or equivalent compliance claim.

## Operator obligations

Anyone deploying this project should:

- disclose the actual identity provider, storage, logging, and retention settings
- keep native first-send permission, App Store privacy answers, and provider-retention disclosures
  aligned with production behavior
- keep the Google client secret, OpenAI key, and `AUTH_SECRET` in Worker secrets
- restrict access to Durable Object data and operational logs
- avoid adding prompt, response, email, account-alias, or network-address logging by default
- establish deletion, incident-response, credential-rotation, and legal-request procedures
- assess applicable health, consumer-protection, privacy, identity, and child-safety law
- obtain independent privacy and security review before a broad public launch
- avoid representing this prototype as confidential clinical care

Users should avoid entering information they would not want processed by the deployment's infrastructure providers.

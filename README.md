# Stabilize

Stabilize is a small, floor-first AI support website for overloaded moments. It aims to help an adult protect immediate needs, reduce cognitive load, and choose one safe, reversible next step.

This is an early public prototype, not a clinical product. It does not diagnose, provide therapy, replace emergency services, or guarantee safety.

## What is included

- a layered Cloudflare Worker application served at `stabilize.info`
- Worker-rendered HTML with static CSS and browser JavaScript
- deterministic routes for immediate danger, possible overdose, unsafe shelter, and medication-change requests
- OpenAI's Responses API for ordinary AI replies
- safe, local Markdown rendering for assistant replies
- a fixed bottom composer with streamed responses, recovery controls, and contextual follow-up actions
- a continuous forested lake landscape with a lower-load static mobile path
- a self-hosted Lexend variable font
- demo mode that works without an API key
- optional Google sign-in for cross-device memory; guest chats keep eight recent messages plus a 5,000-output-token rolling summary in the current tab without entering Stabilize's server-side account memory
- no full transcript database; account memory uses a rolling summary with a bounded recent-message buffer
- guest and signed-in fast replies begin on GPT-5.6 Fast; signed-in free accounts receive 50 GPT-5.6 messages per UTC day before GPT-5.4 fallback
- an optional subscription for a larger monthly non-default-model allowance and subscriber model choice
- privacy-bounded response, outcome, reliability, and usage measurement without prompt or reply text in impact analytics
- safety, privacy, billing, UI, Worker, and release tests
- public-safe protocol background documents
- a native, guest-only SwiftUI iPhone client with explicit OpenAI sharing permission

The language model is not the only safety layer. Selected urgent phrases are routed to fixed responses before model generation, ordinary model output is bounded and validated, and raw HTML or executable link schemes are rejected by the local Markdown renderer. These defenses are intentionally conservative, but they are not comprehensive and require independent review before a high-stakes public launch.

## Current model and allowance behavior

The checked-in runtime configuration is intended to describe the deployed policy directly:

- **Guest:** ordinary chats begin on GPT-5.6 Fast. The newest eight messages plus a rolling summary capped at 5,000 model-output tokens stay in the current browser tab and are sent with follow-ups, but they do not use Stabilize account memory or an account-based allowance.
- **Signed-in free account:** the first **50** completed ordinary messages per UTC day use GPT-5.6 Fast (`gpt-5.6-sol`), including Fastest response. The selected thinking level changes reasoning effort, not the initial model. After the allowance, requests continue on GPT-5.4. The allowance resets at `00:00 UTC`.
- **Subscriber:** the account may choose GPT-5.4 or **Current** (`gpt-5.6-sol`). Up to **200** non-default-model messages are available per UTC month; GPT-5.4 does not consume that monthly allowance.
- **Thinking level:** the user may choose supported reasoning levels independently of the model allowance. The Worker validates the requested level for the selected model; the maximum level is available only for Current.
- **Urgent fixed routes and failed provider requests:** these do not consume the free or subscriber model allowance.

The public labels intentionally use **GPT-5.6 Fast**, **GPT-5.4**, **Current**, and thinking-level names. Internal API model IDs remain in configuration and code.

## Project map

| Path | Purpose |
| --- | --- |
| `src/domain-router.js` | Canonical-host enforcement, HTTPS redirects, and HSTS for the deployed Worker |
| `src/copy.js` | Core site text, fixed replies, public errors, memory prompt, and model instructions |
| `src/page.js` | Core HTML layout rendered from `src/copy.js` |
| `src/safety.js` | Deterministic input routing |
| `src/index.js` | Core chat endpoint, OpenAI reply path, and account-memory routing |
| `src/paid-worker.js` | Model allowance, subscription, model-selection, and fallback behavior |
| `src/impact-worker.js` | Privacy-bounded feedback, outcome, reliability, and impact measurement |
| `src/auth.js` | Google OpenID Connect flow and signed account session |
| `src/session-memory.js` | Per-account Durable Object memory, expiry, and compaction state |
| `public/` | Static CSS, browser JavaScript, terrain renderer, safe Markdown renderer, Lexend font, and asset security headers |
| `test/` | Deterministic router, UI, billing, memory, analytics, and Worker endpoint tests |
| `docs/` | Public-safe background material and operating documentation |
| `ios/` | Native SwiftUI app, unit tests, App Store metadata, and release tooling |
| `wrangler.jsonc` | Cloudflare bindings and non-secret production policy values |

## Edit site text

Core product language is in `src/copy.js`: the intro blurb, labels, fixed emergency and medication replies, demo responses, public errors, and backend model prompt. Billing, model-allowance, feedback, and impact copy also lives beside those feature layers and their generation scripts, so any public-copy change should be covered by the corresponding regression test.

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm install
npm test
npm run dev
```

Copy `.dev.vars.example` to `.dev.vars`, place an OpenAI API key in the local file, and open the URL Wrangler prints. `.dev.vars` is ignored by Git. To run only the interface and deterministic routes without an API call, temporarily set `DEMO_MODE` to `true` in local configuration.

The current repository materializes the production policy through the standard npm commands. Run those commands rather than invoking individual scripts in isolation; the clean-tree guard verifies that generation is repeatable.

## Enable OpenAI

The deployment uses OpenAI's Responses API. The committed model-policy values are:

```text
OPENAI_MODEL=gpt-5.4
OPENAI_REASONING_EFFORT=none
MODEL_CHOICES=gpt-5.4|GPT-5.4,gpt-5.6-sol|Current
FREE_DAILY_MODEL_MESSAGE_LIMIT=50
FREE_PLAN_PRIMARY_MODEL=gpt-5.6-sol
FREE_PLAN_FALLBACK_MODEL=gpt-5.4
PAID_MONTHLY_MESSAGE_LIMIT=200
```

`OPENAI_MODEL` remains the GPT-5.4 fallback and subscriber base model. `FREE_PLAN_PRIMARY_MODEL` supplies the GPT-5.6 Fast initial route for guests and the first 50 signed-in free messages; `FREE_PLAN_FALLBACK_MODEL` handles the signed-in daily-limit fallback. `MODEL_CHOICES` defines the subscriber-facing model catalog. The browser may request a supported thinking level; `OPENAI_REASONING_EFFORT` is the safe server fallback when that preference is missing or invalid.

The same deployed OpenAI key also powers low-reasoning memory compaction for signed-in users. Guest and private chats do not enter the Stabilize account-memory or Durable Object compaction path. Guest web chats can use a separate OpenAI summary request whose result returns to and remains in the current browser tab.

1. Use a project-scoped OpenAI API key with appropriate usage and spend limits.
2. For local development, copy `.dev.vars.example` to `.dev.vars` and place the key there.
3. For a Cloudflare deployment, store the key as a Worker runtime secret:

```bash
npx wrangler secret put OPENAI_API_KEY
```

4. Validate and deploy:

```bash
npm run check
npm run deploy
```

Never place the key in browser code, GitHub, `wrangler.jsonc`, or a Cloudflare plain-text variable. The browser calls the Worker, and only the Worker reads the secret at runtime. Rotate a key immediately if it is exposed, and set project-level spend limits before public use.

Both reply and summary requests currently use `store: true`, so OpenAI stores the resulting Responses API objects for at least 30 days unless organization or project data controls override the request. Keep `README.md`, `PRIVACY.md`, the public privacy page, native disclosures, and the actual request payload aligned whenever that behavior changes.

## Enable Google sign-in

Google sign-in is optional for chatting and required only for cross-device remembered context and account-based allowances. Guests receive deterministic safety routing and bounded continuity inside the current browser tab without a server-side Stabilize memory record.

1. In Google Cloud, configure the OAuth consent screen and create an OAuth client with application type **Web application**.
2. Add each exact production callback as an authorized redirect URI, for example:

```text
https://your-domain.example/auth/google/callback
https://stabilize.your-subdomain.workers.dev/auth/google/callback
```

3. Store the OAuth values as Worker secrets:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put PUBLIC_ORIGIN
```

4. Generate a separate long random signing secret and store it once:

```bash
openssl rand -base64 32
npx wrangler secret put AUTH_SECRET
```

Do not reuse the OpenAI key or Google client secret as `AUTH_SECRET`. Rotating `AUTH_SECRET` signs everyone out and changes the one-way account aliases, so existing remembered context becomes inaccessible.

Set `PUBLIC_ORIGIN` to the exact canonical origin, such as `https://your-domain.example`, with no path. A trailing slash is harmless and normalized. It is not sensitive, but this project declares it with the required deployment values so every release uses the same callback origin. Requests that begin sign-in on another Worker hostname are redirected to the canonical origin. The authorized Google callback must match it exactly.

The server uses authorization code, anti-forgery state, nonce, and PKCE. It requests only `openid`, uses Google's stable `sub` claim only long enough to derive a one-way account alias, and does not request or retain an email, Google tokens, or the authorization code.

## Connect Cloudflare to GitHub

In Cloudflare Workers & Pages, import this GitHub repository as a Worker project. Use `npx wrangler deploy` as the deploy command. Keep secrets in Cloudflare, not in repository settings or source files.

The Worker handles HTML, APIs, authentication, billing, feedback, admin, and redirects. Eligible static CSS, JavaScript, fonts, and images are served through Cloudflare Static Assets. Worker responses receive security headers in the Worker layers; static asset headers live in `public/_headers`.

## Safety and launch limits

Before a broad public launch, add or verify:

- independent clinical, crisis-response, lived-experience, privacy, security, and accessibility review
- Cloudflare rate limiting or WAF rules for `/api/chat` and other abuse-sensitive routes
- a much larger adversarial and multilingual test set
- monitoring that never records prompt or reply bodies
- a production privacy policy and terms matching the real deployment
- verified crisis and basic-needs resources for every supported location
- OAuth consent-screen, redirect-URI, cookie, billing, and account-recovery review
- a credential-rotation plan, spend controls, and graceful model fallback
- a clear incident-response and rollback process

See `SECURITY.md`, `PRIVACY.md`, and `RESPONSIBLE_USE.md`.

## Privacy behavior

Guest chats create no server-side Stabilize account memory. The web client keeps the newest eight guest messages, a rolling summary capped at 5,000 model-output tokens, and a bounded queue awaiting summary in the current tab's session storage. It sends that bounded context with follow-ups and clears it on New conversation, sign-in or sign-out transitions, expiry, or tab closure. After Google sign-in, the Worker derives a one-way alias from Google's stable account identifier and uses that alias to address one Durable Object. The signed HttpOnly cookie contains the alias and expiry—not an email, Google token, raw Google identifier, network address, or conversation. The object retains a rolling summary plus at most eight newest messages awaiting compaction and deletes the record 30 days after the last stored exchange. Signed-in users can delete that remembered context immediately from the account menu; a generation token prevents an older in-flight response from recreating it. Billing and model-allowance records remain separate.

Signed-in users can start a private chat that bypasses Stabilize account-memory reads and writes for that tab. Private chat does not disable Cloudflare or OpenAI processing and does not change the provider-retention behavior described above.

To reduce signed-in response delay, the web page prefetches a bounded, short-lived signed account-context snapshot while the user is reading or typing. The opaque snapshot is bound to the signed-in account, held only in active page memory, checked against the current memory generation returned by the existing quota lookup, and refreshed after completed replies. It is not written to localStorage or sessionStorage. Invalid, expired, cross-account, or superseded snapshots fall back to the account-memory Durable Object.

The landscape animation tokenizes submitted prompts and displayed replies locally, immediately reduces them to numeric climate and motion signals, and does not add message text to animation storage, requests, or logs. Reduced-motion and lower-capacity mobile clients receive a static landscape path.

The application does not use `CF-Connecting-IP` for memory, derive network aliases, or include account or network identifiers in successful-chat logs. Impact analytics uses one-way hashes of random browser, tab, and conversation identifiers and does not store prompt or assistant-response text. Google, Cloudflare, OpenAI, Stripe when used, and network infrastructure may process request data and metadata under their applicable terms. See `PRIVACY.md` for the implementation-level description and limitations.

## License

Source code is available under the **AI Pubs OpenRAIL-S v0.1 License**, which permits broad use, modification, hosting, and redistribution subject to use restrictions. Because those restrictions limit fields of use, this is source-available rather than OSI-approved open source.

Background documents are included as project materials under the same responsible-use expectations. Obtain legal review before relying on the license for a production organization.

The bundled Lexend font remains under the SIL Open Font License 1.1; its copyright notice and license are in `public/fonts/OFL.txt`.

# Stabilize

Stabilize is a small, floor-first AI support website for overloaded moments. It aims to help an adult protect immediate needs, reduce cognitive load, and choose one safe, reversible next step.

This is an early public prototype, not a clinical product. It does not diagnose, provide therapy, replace emergency services, or guarantee safety.

## What is included

- a Cloudflare Worker API
- Worker-rendered HTML with static CSS and browser JavaScript
- deterministic routes for immediate danger, possible overdose, unsafe shelter, and medication-change requests
- OpenAI's Responses API for replies and account-scoped Conversations for signed-in continuity
- safe, local Markdown rendering for assistant replies
- a fixed bottom text composer beneath one panel for the intro, thinking, and latest reply
- a continuous, token-modulated forested lake valley at dawn generated locally from layered terrain noise
- a self-hosted Lexend variable font
- demo mode that works without an API key
- optional Google sign-in for cross-device memory; guest chats are not stored
- no visible transcript archive; account memory uses an OpenAI Conversation plus a bounded local recovery summary/recent buffer
- safety and route tests
- public-safe protocol background documents

The language model is not the only safety layer. Urgent phrases are routed to fixed responses before model generation, and ordinary model replies receive a small final validation check. Assistant Markdown is rendered locally with DOM nodes; raw HTML remains text and executable link schemes are rejected. These defenses are intentionally conservative, but they are not comprehensive and require independent review before a high-stakes public launch.

## Project map

| Path | Purpose |
| --- | --- |
| `src/copy.js` | Single source of truth for site text, replies, errors, and model instructions |
| `src/page.js` | HTML layout rendered from `src/copy.js` |
| `src/safety.js` | Deterministic input routing |
| `src/index.js` | Cloudflare Worker routes, OpenAI call, and account-memory routing |
| `src/auth.js` | Google OpenID Connect flow and signed account session |
| `src/session-memory.js` | Per-account Durable Object memory, expiry, and compaction state |
| `public/` | Static CSS, browser JavaScript, terrain renderer, safe Markdown renderer, Lexend font, and asset security headers |
| `test/` | Deterministic router and Worker endpoint tests |
| `docs/` | Public-safe background material for the protocol |
| `wrangler.jsonc` | Cloudflare configuration and non-secret model settings |

## Edit site text

All editable product language is in `src/copy.js`: the intro blurb, labels, buttons, emergency and medication replies, demo responses, public errors, and the backend model prompt. The other runtime files reference that module, so text changes do not need to be repeated across HTML, browser JavaScript, or routing logic.

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm install
npm test
npm run dev
```

Copy `.dev.vars.example` to `.dev.vars`, place an OpenAI API key in the local file, and open the URL Wrangler prints. `.dev.vars` is ignored by Git. To run only the interface and deterministic routes without an API call, temporarily set `DEMO_MODE` to `true` in your local configuration.

## Enable OpenAI

The default model is `gpt-5.6-sol` through OpenAI's Responses API, with maximum supported reasoning effort and current-turn reasoning context. Guest and signed-in reply requests use `store: false`; signed-in continuity attaches deletable items to an account-scoped OpenAI Conversation with automatic context truncation.

The same deployed OpenAI key also powers low-reasoning memory compaction for signed-in users. Guest requests do not enter the memory or compaction path.

1. Use a project-scoped OpenAI API key with appropriate usage limits and permissions for both Responses and Conversations.
2. For local development, copy `.dev.vars.example` to `.dev.vars` and place the key there.
3. For a Cloudflare deployment, store the same key as a Worker runtime secret:

```bash
npx wrangler secret put OPENAI_API_KEY
```

4. Validate and deploy:

```bash
npm run check
npm run deploy
```

Never place the key in browser code, GitHub, `wrangler.jsonc`, or a Cloudflare plain-text variable. The browser calls the Worker, and only the Worker reads the secret at runtime. Rotate a key immediately if it is exposed, and set project-level spend limits before public use.

To change the model without editing application code, update `OPENAI_MODEL` in `wrangler.jsonc`, rerun the tests, and validate the new model's behavior. `OPENAI_REASONING_EFFORT` accepts `none`, `low`, `medium`, `high`, `xhigh`, or `max`; the Worker reduces unsupported high settings for older models.

## Enable Google sign-in

Google sign-in is optional for chatting and required only for remembered context. Guests receive the same current-turn chat and deterministic safety routing without a server-side session.

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

4. Generate separate long random secrets for stable account aliases and rotatable session signing:

```bash
openssl rand -base64 32
npx wrangler secret put AUTH_SECRET
openssl rand -base64 32
npx wrangler secret put SESSION_SECRET
```

Do not reuse the OpenAI key or Google client secret for either value. Both secrets are required. Keep `AUTH_SECRET` stable because rotating it changes one-way account aliases and makes prior account state inaccessible. Rotate `SESSION_SECRET` when you need to revoke sign-in cookies without changing those aliases. Legacy cookies signed with `AUTH_SECRET` have a fixed rollout cutoff and sunset after their original 30-day lifetime. Finish deploying this release before the documented UTC cutoff; if rollout moves past it, advance the fixed timestamp and its boundary test first.

Set `PUBLIC_ORIGIN` to the exact canonical origin, such as `https://your-domain.example`, with no path. A trailing slash is harmless and normalized. It is not sensitive, but this project declares it with the required deployment values so every release uses the same callback origin. Requests that begin sign-in on another Worker hostname are redirected to the canonical origin. The authorized Google callback must match it exactly.

The server uses authorization code, anti-forgery state, nonce, and PKCE. It requests only `openid`, uses Google's stable `sub` claim only long enough to derive a one-way account alias, and does not request or retain an email, Google tokens, or the authorization code.

## Connect Cloudflare to GitHub

In Cloudflare Workers & Pages, import this GitHub repository as a Worker project. Use `npx wrangler deploy` as the deploy command. Keep secrets in Cloudflare, not in repository settings or source files.

The Worker renders `/` and `/index.html` from the centralized copy file, handles `/api/*`, and serves CSS and browser JavaScript from `public/`. Worker responses receive security headers in `src/index.js`; static asset headers live in `public/_headers`.

## Safety and launch limits

Before a broad public launch, add or verify:

- independent clinical, crisis-response, privacy, and security review
- Cloudflare rate limiting or WAF rules for `/api/chat`
- a much larger adversarial and multilingual test set
- monitoring that never records prompt bodies
- a production privacy policy and terms matching the real deployment
- verified crisis and basic-needs resources for every supported location
- OAuth consent-screen, redirect-URI, cookie, and account-recovery review
- a credential rotation plan and cost controls
- a clear incident-response and rollback process

See `SECURITY.md`, `PRIVACY.md`, and `RESPONSIBLE_USE.md`.

## Privacy behavior

Guest chats create no server-side memory and use `store: false`. After Google sign-in, the Worker derives a one-way alias from Google's stable account identifier and uses it to address one Durable Object. The signed `HttpOnly` cookie contains the alias, an opaque session identifier, and expiry—not an email, Google token, raw Google identifier, network address, or conversation. Signed-in replies use one OpenAI Conversation plus a bounded local recovery summary/recent buffer. Local text expires 30 days after the last exchange; provider items are then deleted before the Conversation object, with opaque retry tombstones if cleanup is temporarily unavailable. Users can also delete remembered conversation data from the account menu; successful deletion rotates the session binding and is confirmed by a short-lived signed receipt.

The landscape animation tokenizes submitted prompts and displayed replies locally, immediately reduces them to numeric climate and motion signals, and does not add message text to animation storage, requests, or logs. Reduced-motion preferences receive a static landscape.

The application never reads `CF-Connecting-IP`, derives network aliases, or includes account/network identifiers in successful-chat logs. Summary requests, guest replies, and signed-in reply requests use OpenAI with `store: false`; signed-in input/output items are intentionally attached to the account Conversation for continuity until deletion, without also storing a separately retrievable Response object. Google, Cloudflare, OpenAI, and network infrastructure may still process request data and metadata under their applicable terms. See `PRIVACY.md` and `docs/OPENAI_CONVERSATIONS.md` for the complete implementation-level description and limitations.

## License

Source code is available under the **AI Pubs OpenRAIL-S v0.1 License**, which permits broad use, modification, hosting, and redistribution subject to use restrictions. Because those restrictions limit fields of use, this is source-available rather than OSI-approved open source.

Background documents are included as project materials under the same responsible-use expectations. Obtain legal review before relying on the license for a production organization.

The bundled Lexend font remains under the SIL Open Font License 1.1; its copyright notice and license are in `public/fonts/OFL.txt`.

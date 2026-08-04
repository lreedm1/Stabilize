# Stabilize

Stabilize is a floor-first AI support product for overloaded moments. It aims to help an adult protect immediate needs, reduce cognitive load, and choose one safe, reversible next step.

This is an early public prototype, not a clinical product. It does not diagnose, provide therapy, replace emergency services, or guarantee safety.

## What is included

- a Cloudflare Worker API and Worker-rendered website
- deterministic routes for immediate danger, possible overdose, unsafe shelter, and medication-change requests
- OpenAI Responses API generation for ordinary replies, with adaptive reasoning and streamed output
- a visible current conversation, local draft recovery, stop/retry, copy/share, read-aloud, and supported-browser voice input
- optional Google sign-in for 30-day condensed continuity
- user-facing controls to view, correct, or delete signed-in memory
- a private-chat mode that does not read or write account memory
- no full server-side transcript database; account memory remains a rolling summary plus a bounded recent-message buffer
- OpenAI reply and summary requests with `store: false`
- safe local Markdown rendering; raw HTML remains text and unsafe link schemes are rejected
- a calm photographic/animated background with a user-controlled still mode
- a progressive web app manifest, service worker, install affordance, and offline connection page
- a one-tap, prompt-free clarity outcome signal
- optional paid model choice through Stripe
- opt-in public product feedback with bounded automation
- a native, guest-only SwiftUI iPhone client with explicit OpenAI sharing permission
- safety, privacy, billing, UI, and Worker tests

The language model is not the only safety layer. Urgent phrases are routed to fixed responses before model generation. Ordinary output receives a bounded safety validation before held-back text is released to the browser. These defenses are intentionally conservative, but they are not comprehensive and require independent review before a high-stakes public launch.

## Project map

| Path | Purpose |
| --- | --- |
| `src/copy.js` | Core product language, fixed replies, errors, and model instructions |
| `src/page.js` | Worker-rendered homepage and product controls |
| `src/safety.js` | Deterministic input routing |
| `src/index.js` | Chat streaming, OpenAI calls, memory controls, outcome signal, auth routing |
| `src/auth.js` | Google OpenID Connect flow and signed account session |
| `src/session-memory.js` | Per-account Durable Object memory, editing, deletion, expiry, and compaction |
| `src/paid-worker.js` | Stripe model-choice and usage routing |
| `public/app.js` | Current-thread UI, streaming client, voice, sharing, local draft/thread state |
| `public/` | CSS, PWA assets, safe Markdown, backgrounds, public guidance pages |
| `test/` | Deterministic router, Worker, UI, privacy, billing, and memory tests |
| `docs/` | Public-safe background material for the protocol |
| `ios/` | Native SwiftUI app, unit tests, App Store metadata, and release tooling |
| `wrangler.jsonc` | Cloudflare configuration and non-secret model settings |

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm install
npm test
npm run dev
```

Copy `.dev.vars.example` to `.dev.vars`, place an OpenAI API key in the local file, and open the URL Wrangler prints. `.dev.vars` is ignored by Git. To run deterministic routes and the interface without an API call, temporarily set `DEMO_MODE` to `true` in local configuration.

## OpenAI behavior

The default model is configured in `wrangler.jsonc`. The deployed reasoning setting is a ceiling: ordinary requests receive adaptive low, medium, or high reasoning based on complexity, while harder requests may use the configured maximum when supported. Text verbosity stays low.

Both reply and memory-summary requests use `store: false`. The same deployed key powers ordinary replies and low-reasoning memory compaction for signed-in users. Guest and private requests do not enter the Durable Object memory or compaction path.

Store the key only as a Worker secret:

```bash
npx wrangler secret put OPENAI_API_KEY
```

Never place the key in browser code, GitHub, `wrangler.jsonc`, or a plain-text Cloudflare variable. Rotate an exposed key immediately and set project-level spend limits before public use.

## Google sign-in and memory

Google sign-in is optional for chatting and required only for cross-visit account memory. The app requests only `openid`, derives a one-way alias from Google's stable account identifier, and does not request or retain the user's email or Google tokens.

Signed-in users can inspect the raw condensed summary and bounded recent buffer, save a correction, delete all memory immediately, or use private mode for a conversation. The server record otherwise expires 30 days after the last stored exchange.

Configure exact redirect URIs and store these Worker secrets:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put PUBLIC_ORIGIN
openssl rand -base64 32
npx wrangler secret put AUTH_SECRET
```

Do not reuse the OpenAI key or Google client secret as `AUTH_SECRET`. Rotating it signs everyone out and changes the one-way aliases, making prior account memory inaccessible.

## Deploy

Validate before deployment:

```bash
npm run check
npm run deploy
```

Cloudflare can import this repository as a Worker project and run `npx wrangler deploy`. Keep secrets in Cloudflare rather than repository settings or source files.

## Safety and launch limits

Before broad public promotion, add or verify:

- independent clinical, crisis-response, privacy, accessibility, and security review
- Cloudflare rate limiting or WAF rules for `/api/chat`
- a larger adversarial and multilingual test set
- monitoring that never records prompt or reply bodies
- production terms and privacy disclosures matching the real deployment
- verified crisis and basic-needs resources for every supported location
- OAuth, cookie, account-recovery, billing, and deletion review
- credential rotation, cost controls, incident response, rollback, and public status procedures

See `SECURITY.md`, `PRIVACY.md`, and `RESPONSIBLE_USE.md`.

## Privacy summary

The current browser tab stores a bounded current thread in `sessionStorage` for up to 24 hours so navigation or refresh does not erase the conversation. An unfinished non-private draft may be stored locally for up to seven days. Private mode clears and does not save the unfinished draft. Neither browser record is sent to Stabilize as analytics.

Guest and private chats create no Stabilize server-side conversation memory. Signed-in memory uses one pseudonymous Durable Object containing a summary and at most eight recent messages awaiting compaction. Users can view, correct, or delete that record from the product.

The application does not read `CF-Connecting-IP`, derive network aliases, or include prompts, replies, account aliases, or network identifiers in successful-chat logs. Outcome feedback records only a coarse rating and deterministic route. OpenAI reply and summary calls use `store: false`; provider processing and abuse-monitoring retention can still occur under the deployment's applicable data controls and terms.

## License

Source code is available under the **AI Pubs OpenRAIL-S v0.1 License**. It permits broad use, modification, hosting, and redistribution subject to use restrictions, so it is source-available rather than OSI-approved open source.

The bundled Lexend font remains under the SIL Open Font License 1.1; its notice and license are in `public/fonts/OFL.txt`.

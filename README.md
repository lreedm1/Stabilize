# Stabilize

Stabilize is a small, floor-first AI support website for overloaded moments. It aims to help an adult protect immediate needs, reduce cognitive load, and choose one safe, reversible next step.

This is an early public prototype, not a clinical product. It does not diagnose, provide therapy, replace emergency services, or guarantee safety.

## What is included

- a Cloudflare Worker API
- Worker-rendered HTML with static CSS and browser JavaScript
- deterministic routes for immediate danger, possible overdose, unsafe shelter, and medication-change requests
- OpenAI's Responses API for ordinary AI replies
- safe, local Markdown rendering for assistant replies
- a fixed bottom text composer beneath one panel for the intro, thinking, and latest reply
- a self-hosted Lexend variable font
- demo mode that works without an API key
- no account, cookies, database, or persistent chat history in this code
- safety and route tests
- public-safe protocol background documents

The language model is not the only safety layer. Urgent phrases are routed to fixed responses before model generation, and ordinary model calls use a 500-token generation budget plus a small final validation check. OpenAI counts hidden reasoning and formatting tokens inside that budget. Assistant Markdown is rendered locally with DOM nodes; raw HTML remains text and executable link schemes are rejected. These defenses are intentionally conservative, but they are not comprehensive and require independent review before a high-stakes public launch.

## Project map

| Path | Purpose |
| --- | --- |
| `src/copy.js` | Single source of truth for site text, replies, errors, and model instructions |
| `src/page.js` | HTML layout rendered from `src/copy.js` |
| `src/safety.js` | Deterministic input routing |
| `src/index.js` | Cloudflare Worker API and OpenAI call |
| `public/` | Static CSS, browser JavaScript, safe Markdown renderer, Lexend font, and asset security headers |
| `test/` | Deterministic router and Worker endpoint tests |
| `docs/` | Public-safe background material for the protocol |
| `wrangler.jsonc` | Cloudflare configuration and non-secret model settings |

## Edit site text

All editable product language is in `src/copy.js`: the intro blurb, labels, buttons, emergency and medication replies, demo responses, public errors, and the backend model prompt. The other runtime files reference that module, so text changes do not need to be repeated across HTML, browser JavaScript, or routing logic.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm test
npm run dev
```

Copy `.dev.vars.example` to `.dev.vars`, place an OpenAI API key in the local file, and open the URL Wrangler prints. `.dev.vars` is ignored by Git. To run only the interface and deterministic routes without an API call, temporarily set `DEMO_MODE` to `true` in your local configuration.

## Enable OpenAI

The default model is `gpt-5.6-sol` through OpenAI's Responses API, with medium reasoning effort, current-turn reasoning context, and `store: false`.

1. Use a project-scoped OpenAI API key with appropriate usage limits.
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

To change the model without editing application code, update `OPENAI_MODEL` in `wrangler.jsonc`, rerun the tests, and validate the new model's behavior. `OPENAI_REASONING_EFFORT` accepts `none`, `low`, `medium`, `high`, or `xhigh` when the selected model supports that setting.

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
- a credential rotation plan and cost controls
- a clear incident-response and rollback process

See `SECURITY.md`, `PRIVACY.md`, and `RESPONSIBLE_USE.md`.

## Privacy behavior

This repository contains no database and does not write chat messages to storage. The browser holds the active conversation in memory until the page is refreshed. In AI mode, recent messages are sent through the Worker to OpenAI with `store: false`. Cloudflare, OpenAI, and network infrastructure may still process request data and metadata. See `PRIVACY.md` for the implementation-level description and retention limits.

## License

Source code is available under the **AI Pubs OpenRAIL-S v0.1 License**, which permits broad use, modification, hosting, and redistribution subject to use restrictions. Because those restrictions limit fields of use, this is source-available rather than OSI-approved open source.

Background documents are included as project materials under the same responsible-use expectations. Obtain legal review before relying on the license for a production organization.

The bundled Lexend font remains under the SIL Open Font License 1.1; its copyright notice and license are in `public/fonts/OFL.txt`.

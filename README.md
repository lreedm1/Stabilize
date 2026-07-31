# Stabilize

Stabilize is a small, floor-first AI support website for overloaded moments. It aims to help an adult protect immediate needs, reduce cognitive load, and choose one safe, reversible next step.

This is an early public prototype, not a clinical product. It does not diagnose, provide therapy, replace emergency services, or guarantee safety.

## What is included

- a Cloudflare Worker API
- static HTML, CSS, and browser JavaScript
- deterministic routes for immediate danger, possible overdose, unsafe shelter, and medication-change requests
- Amazon Bedrock for ordinary AI replies
- demo mode that works without an API key
- no account, cookies, database, or persistent chat history in this code
- safety and route tests
- public-safe protocol background documents

The language model is not the only safety layer. Urgent phrases are routed to fixed responses before model generation, and model output receives a small final validation check. This defense is intentionally conservative, but it is not comprehensive and requires independent review before a high-stakes public launch.

## Project map

| Path | Purpose |
| --- | --- |
| `src/prompt.js` | Single source of truth for backend model instructions |
| `src/safety.js` | Deterministic input routing and fixed urgent responses |
| `src/index.js` | Cloudflare Worker API and Amazon Bedrock call |
| `public/` | Static website and security headers |
| `test/` | Deterministic router and Worker endpoint tests |
| `docs/` | Public-safe background material for the protocol |
| `wrangler.jsonc` | Cloudflare configuration and non-secret model settings |

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm test
npm run dev
```

Open the local URL Wrangler prints. The committed configuration uses `DEMO_MODE=true`, so no credential is needed for the interface and deterministic routes.

## Enable Amazon Bedrock

The default model is Amazon Nova 2 Lite through Bedrock's Converse endpoint.

1. Copy `.dev.vars.example` to `.dev.vars` for local development and place a Bedrock API key there.
2. Change `DEMO_MODE` to `false` in `wrangler.jsonc`.
3. For a Cloudflare deployment, store the key as a secret:

```bash
npx wrangler secret put AWS_BEARER_TOKEN_BEDROCK
```

4. Validate and deploy:

```bash
npm run check
npm run deploy
```

Never place the key in browser code, GitHub, or `wrangler.jsonc`. AWS recommends long-term Bedrock API keys only for exploration. A production deployment should use short-lived credentials with a rotation design or an AWS-hosted service that can use an IAM role.

To change the model without editing application code, update `BEDROCK_MODEL_ID` in `wrangler.jsonc`, rerun the tests, and validate the new model's behavior.

## Connect Cloudflare to GitHub

In Cloudflare Workers & Pages, import this GitHub repository as a Worker project. Use `npx wrangler deploy` as the deploy command. Keep secrets in Cloudflare, not in repository settings or source files.

The current Worker serves assets from `public/` and runs Worker code first only for `/api/*`. Static response security headers live in `public/_headers`; API headers are attached in `src/index.js`.

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

This repository contains no database and does not write chat messages to storage. The browser holds the active conversation in memory until the page is refreshed. In AI mode, recent messages are sent through the Worker to Amazon Bedrock. Cloudflare, AWS, and network infrastructure may still process request data and metadata. See `PRIVACY.md` for the implementation-level description.

## License

Source code is available under the **AI Pubs OpenRAIL-S v0.1 License**, which permits broad use, modification, hosting, and redistribution subject to use restrictions. Because those restrictions limit fields of use, this is source-available rather than OSI-approved open source.

Background documents are included as project materials under the same responsible-use expectations. Obtain legal review before relying on the license for a production organization.

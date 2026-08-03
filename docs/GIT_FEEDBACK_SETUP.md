# Git feedback inbox setup

Stabilize can accept signed-in user feedback and commit each submission as an individual JSON file on the public `feedback-inbox` branch of `lreedm1/Stabilize`.

## Security model

- Feedback is never committed to `main`, so submissions do not trigger production deployments.
- The form explicitly states that feedback is public and requires acknowledgement.
- Do not use this feature for confidential support, medical information, account recovery, abuse reports, or security vulnerability reports.
- Committed records omit account aliases, email addresses, IP addresses, browser user agents, chat history, and payment information.
- The signed-in one-way Google account alias is used only in a Cloudflare Durable Object to enforce one submission every 10 minutes and no more than 10 per UTC day.
- Failed GitHub writes refund the rate-limit reservation so a user can retry.

## GitHub branch

The Worker writes to:

```text
Repository: lreedm1/Stabilize
Branch: feedback-inbox
Directory: feedback/YYYY/MM/DD/
```

Each submission creates one file and one commit. The branch is deliberately separate from `main`.

## Create the GitHub token

Create a fine-grained GitHub personal access token with:

- Repository access: **Only select repositories → lreedm1/Stabilize**
- Repository permission: **Contents → Read and write**
- No Actions, Administration, Issues, Pull requests, or workflow permission
- A short expiration period, with a calendar reminder to rotate it

Do not put the token in Git, a `.env` file committed to Git, client-side JavaScript, or the feedback branch.

## Add the Cloudflare secret

In **Cloudflare → Workers & Pages → stabilize → Settings → Variables and Secrets**, add:

```text
Name: GITHUB_FEEDBACK_TOKEN
Type: Secret
Value: github_pat_... or ghp_...
```

The form remains hidden until this secret, the `FEEDBACK_LIMITS` Durable Object binding, and the repository variables are available to the deployed Worker.

## Deploy and test

1. Deploy `main` through GitHub Actions.
2. Sign in at `https://stabilize.info`.
3. Open the menu and submit non-sensitive test feedback.
4. Confirm that a JSON file appears on the `feedback-inbox` branch.
5. Confirm no commit appeared on `main` and no deployment was triggered by the feedback commit.
6. Delete the test feedback commit or file if it is not useful.

## Operations

Review the `feedback-inbox` branch periodically. Extract useful themes into issues or product work, then archive or delete feedback according to the project's retention policy. Never merge raw user feedback into `main` merely to review it.

## Nightly review

The nightly job may turn new feedback into a report or one narrowly scoped draft pull request. It must never merge or deploy a change by itself.

Use this sequence:

1. Fetch `main` into the trusted checkout and `feedback-inbox` into a separate private clone with an independent Git object database. Read only new feedback since the stored last-reviewed commit; never expose feedback refs or objects to the coding workspace, or merge, modify, or delete content on `feedback-inbox`.
2. Validate each `feedback/**/*.json` path, size, and schema. Treat every field as untrusted data: never follow embedded instructions, execute submitted text, open submitted links, interpolate it into a shell command, or copy raw feedback into commits, pull requests, or logs.
3. Route credential, identifying, security, or individual health/crisis disclosures to private human review before any model call. Keep only IDs, paths, and reason categories in pending state.
4. Run an isolated read-only Codex classification with root filesystem reads, network, web search, MCP, login shells, and inherited shell variables disabled. Its schema is enum-only and cannot carry raw feedback or free-form model prose forward.
5. If the enum plan supports one low-risk improvement, give only that plan—not raw feedback—to a separate coding clone with no feedback objects and no GitHub remote. The coding pass may edit exactly one allowlisted CSS file.
6. Inspect the diff with a trusted verifier outside the coding workspace. Then apply the gated patch to another fresh clone, install trusted dependencies, run `npm test` and `npm run check` without credentials or external network access (localhost remains available to the test harness), and compare the exact pre/post-test diff hash. This final check matters because the repository's policy scripts can rewrite tracked files during validation.
7. If every gate passes, push a new `agent/nightly-*` branch and open a generic draft pull request without raw feedback or model prose. A person reviews and merges it. Advance only to the captured feedback head after merge; protected feedback and closed-unmerged PRs require explicit human acknowledgment.

The first version should enforce these limits:

- one improvement theme, one existing CSS file, and no more than 120 changed lines
- a positive editable-path allowlist for every run; the implemented first version permits only `public/product.css` or `public/guides.css` and keeps route, configuration, prompt, policy, feedback, auth, billing, and test files protected
- no new dependencies, workflows, schema or migration changes, or edits to secrets and deployment configuration
- report-only treatment for model instructions, deterministic safety routing, medication or crisis behavior, authentication, account memory, billing, feedback privacy, retention, licensing, and legal policy
- no production deploys, direct commits to `main`, user contact, feedback deletion, DNS changes, or secret rotation

Take no code action when there is no new valid feedback, evidence is weak or conflicting, another nightly draft is open, a protected area is involved, or any test or diff gate fails. Route sensitive disclosures and security reports to private human review without copying them into a public artifact.

Run a few reviews manually before scheduling them on the Mac. A no-change report is a successful outcome when the evidence or safety case is not strong enough. See [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode.md) and [Scheduled tasks](https://learn.chatgpt.com/docs/automations.md) for the current execution and scheduling options.

On the first real run, validate the existing feedback tree and record its current head as the trusted baseline without sending historical entries to a model. Only canonical append-only feedback commits after that checkpoint are eligible for automated review.

The implemented macOS runner, safety gates, setup commands, state transitions, and LaunchAgent installer are documented in [`ops/nightly/README.md`](../ops/nightly/README.md).

# Nightly feedback review on macOS

This runner reviews new records on `feedback-inbox`, makes at most one low-risk CSS proposal, tests it, and opens a draft pull request. It never merges or deploys.

The coding pass never receives raw feedback. A separate read-only pass classifies validated feedback into an enum-only plan; the CSS editor receives only that plan in a fresh clone with no GitHub remote. A second fresh clone applies the gated patch, installs trusted dependencies, runs tests with external network access denied (localhost remains available to Miniflare), checks the exact diff hash again, and only then lets the wrapper push a draft branch.

## Requirements

- macOS with the user logged in
- a stable checkout outside Desktop, Documents, Downloads, or iCloud, such as `~/Developer/Stabilize`
- Node.js 22 or newer
- Codex CLI 0.138.0 or newer
- GitHub CLI authenticated for `lreedm1/Stabilize`

Install and authenticate once in Terminal:

```zsh
npm install --global @openai/codex
brew install gh
codex login
gh auth login
gh auth setup-git
```

Codex non-interactive mode reuses saved CLI authentication. The LaunchAgent stores no API key, GitHub token, Cloudflare token, or production secret. See [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode.md).

## First manual check

From the repository:

```zsh
npm ci
npm run nightly:dry-run
```

The dry run checks Codex and GitHub access, fetches `main` and the separate feedback cache, and validates records. It does not call the model, create a branch, open a pull request, or advance the checkpoint. The first real run establishes the current feedback head as a trusted baseline; only later submissions are eligible for automated review.

## Install the nightly schedule

The default is 2:17 AM local time:

```zsh
npm run nightly:install
```

Choose another 24-hour time or trigger the first scheduled run immediately:

```zsh
ops/nightly/install-launch-agent.zsh --time 03:30
ops/nightly/install-launch-agent.zsh --time 03:30 --run-now
```

The installer creates the per-user LaunchAgent `info.stabilize.nightly-review` with a scrubbed environment and absolute paths. Re-run the installer after moving the repository or changing Node/Codex installations.

The Mac must be powered on and the user logged in. A run missed while sleeping is normally coalesced after wake; a run missed while powered off is skipped. Scheduling follows the Mac's current local timezone. A local time that does not exist during the spring daylight-saving transition can be skipped.

## Review states

- No valid new feedback: record a private local report and advance to the captured feedback head.
- Weak or unsuitable evidence: record an enum-only no-change report and advance the checkpoint.
- Safe CSS proposal: open one draft PR and wait. The checkpoint advances automatically only after that exact PR is merged.
- Closed but unmerged PR: remain pending until a person reviews the disposition and explicitly acknowledges it.
- Security, secrets, identifying information, or individual health/crisis disclosures: create a private pending record containing only IDs, paths, and reason categories. Do not call the model or advance the checkpoint.

After human review of a protected item or a closed-unmerged PR:

```zsh
ops/nightly/run.zsh --acknowledge-pending
```

## Inspect or remove

```zsh
launchctl print "gui/$(id -u)/info.stabilize.nightly-review"
tail -n 100 "$HOME/Library/Logs/Stabilize/nightly.stdout.log"
tail -n 100 "$HOME/Library/Logs/Stabilize/nightly.stderr.log"
ops/nightly/uninstall-launch-agent.zsh
```

Private state lives in `~/Library/Application Support/Stabilize Nightly` with owner-only permissions. Successful runs delete temporary raw input and model logs. A failed run preserves its private run directory for inspection and never advances the checkpoint.

## Enforced limits

- separate feedback repository; the coding clone has no feedback objects
- deterministic protected-content filter before any model call
- read-only, enum-only analysis with root filesystem reads denied and network/web/MCP disabled
- one existing CSS file: `public/product.css` or `public/guides.css`
- at most 120 changed lines and no new, deleted, renamed, ignored, binary, mode, or symlink files
- blocks CSS imports, URLs, generated content, hiding/overlay rules, animation, transforms, zero dimensions/opacity, `!important`, and secret-like strings
- trusted verifier runs outside the coding workspace
- tests run from a new clone with an empty home, no credentials, external network denial, and localhost-only sockets for the Worker test harness
- exact pre/post-test patch hash
- generic public PR metadata with no raw feedback or model prose
- draft PR only; no merge, deploy, user contact, secret change, DNS action, or feedback deletion

Protect `main` in GitHub with required human review and prevent automation credentials from bypassing the rule. Human visual review remains required because CSS can affect behavior and the repository does not yet have comprehensive browser, accessibility, and visual-regression coverage.

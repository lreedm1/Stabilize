# Cloud nightly review

GitHub Actions runs the bounded reviewer at 2:17 AM America/Chicago. The Mac can be off. OpenAI API usage is billed to the API project associated with the `OPENAI_API_KEY` repository secret.

The workflow separates credentials and executable code across fresh runners:

1. A macOS preparation job has a read-only GitHub token. It validates feedback, gives raw feedback only to a read-only classifier, gives the editor only a five-field enum plan, applies the deterministic CSS gate, and shuts down the protected OpenAI proxy.
2. It uploads a one-day candidate artifact containing only bounded state and, when applicable, one gated CSS patch plus its enum plan and result. Raw feedback, logs, reports, and model prose are rejected from the artifact.
3. A fresh macOS verification job has neither the OpenAI key nor write access. It clones the captured `main` commit, installs dependencies without lifecycle scripts, runs normalization and the complete test/Cloudflare dry-run suite inside a disposable filesystem root, and uploads the handoff only if the exact patch is unchanged.
4. A fresh publication job has the write-capable GitHub token but no OpenAI key. It never runs repository tests. It revalidates the exact tested patch against the captured `main` commit, persists a crash-recovery intent, pushes a same-repository branch, and opens only a draft PR.
5. The acknowledgement job is separate again and never receives the OpenAI key.

The OpenAI key is passed only to the pinned `openai/codex-action`. Trusted orchestration starts the proxy and provides `CODEX_HOME` to the two Codex processes, but the model tool subprocesses do not inherit GitHub credentials. The proxy is shut down before any application build or test code runs. The separate verification job starts with an empty environment and receives neither GitHub nor OpenAI credentials.

## Durable state

The dedicated `automation/nightly-state` branch has an allowlist-only tree. It may contain `.nightly-state/README.md` and only these three bounded state files:

- the last reviewed feedback commit SHA;
- the exact identity of a pending same-repository nightly draft PR; or
- a generic protected-review marker containing no feedback text, ID, path, or reason.

Every checkout rejects extra paths, symlinks, non-regular Git modes, two simultaneous pending markers, a stale remote head, or an unexpected repository origin. State is committed before an agent branch is pushed so the next run can recover an interrupted publication.

Each cross-job handoff names one atomic state transition and carries hashes of the exact before/after snapshots. The publication runner restores the live state branch and requires its hash to match the handoff's starting hash. It then verifies checkpoint commits against the live append-only `feedback-inbox` history and verifies merge, PR, and branch identities directly with GitHub before writing state. A handoff cannot both resolve old state and propose a new change; the next nightly run handles the next batch.

The first scheduled run validates the existing feedback tree and records its current head as a baseline. It does not send historical feedback to a model.

## Required GitHub setting

In **Settings → Actions → General → Workflow permissions**, keep workflow writes available and enable **Allow GitHub Actions to create and approve pull requests**. The workflow requests write access only in the fresh publication and acknowledgement jobs; the model/test job remains read-only.

## Manual use

Open **Actions → Nightly Stabilize review → Run workflow** to test it immediately.

If a protected submission or closed-unmerged nightly PR has been reviewed by a person, run the workflow with **acknowledge_pending** enabled. This advances the checkpoint without starting OpenAI or executing tests. Do not use it before the private review.

An open nightly draft blocks later nightly code proposals until it is merged or explicitly acknowledged after closure.

Cloudflare Workers Builds must keep `main` as the production branch. Agent branches may create previews, but the nightly workflow never merges or invokes a production deployment. Exclude `.nightly-state/*` in Cloudflare Build watch paths if state-only commits generate unwanted previews.

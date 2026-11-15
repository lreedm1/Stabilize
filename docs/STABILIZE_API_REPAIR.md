# Stabilize API-only credential repair (manual GitHub Action)

The production chat diagnostic `budget_organization_credentials` means local
configuration validation failed: `OPENAI_ORGANIZATION_ID` is absent/malformed,
or `OPENAI_USAGE_ADMIN_KEY` is absent/blank. It does **not** establish that a
nonempty admin key was rejected by OpenAI. An earlier test returned
`budget_input_count_http_401` as well. Obtain a fresh diagnostic before treating
either historical finding as current; do not bypass the shared token-budget gate.

This workflow is deliberately **manual only**. A diagnostic run makes one
public `Hi` chat call and prints only the bounded error classification. This
does not change credentials, but successful generation consumes allowance.
A `preflight` run checks existing credentials and deployed configuration without
generation, key creation, secret changes, or deployment.
A repair run requires an explicit confirmation phrase and valid credentials
stored in **GitHub Actions secrets**, never in source control or chat.

## Initial setup (one time)

At [Stabilize → Settings → Secrets and variables → Actions](https://github.com/lreedm1/Stabilize/settings/secrets/actions),
set:

**Repository variables** (non-secret identifiers):

- `CLOUDFLARE_ACCOUNT_ID` — the 32-hex-character Cloudflare account ID.
- `STABILIZE_OPENAI_ORG_ID` — the `org-...` organization ID that owns
  Stabilize's project **and its complimentary-token eligibility**.
- `STABILIZE_OPENAI_PROJECT_ID` — the `proj_...` project ID;
  required only if creating a new service-account key.

Both the normal deploy workflow and this repair workflow prefer the account-ID
variable and accept the legacy secret as a fallback. If both exist, verify they
identify the same account. No copying or rotating of an API token is required.

**Repository secrets**:

- `CLOUDFLARE_API_TOKEN` — narrowly scoped to the Stabilize Worker,
  with Workers Scripts Write/deployment access.
- `STABILIZE_OPENAI_USAGE_ADMIN_KEY` — an OpenAI organization admin key
  allowed to read the organization Usage API.
- `STABILIZE_OPENAI_API_KEY` — a working project API key for the same
  organization, if **reusing** an existing project key.
- `STABILIZE_OPENAI_PROVISION_ADMIN_KEY` — only if **creating** a new
  service account and project API key through the OpenAI Admin API.

Never paste raw keys into a GitHub issue, commit, workflow inputs, or chat.
If your existing GitHub repository already has a general-purpose
`OPENAI_API_KEY` secret for another task, do not reuse it automatically:
ensure the chosen key belongs to the right eligible project.

## Run

1. Open [Actions → Stabilize API credential repair](https://github.com/lreedm1/Stabilize/actions/workflows/stabilize-api-repair.yml).
2. Choose `diagnose` to run one public live chat check without credentials.
3. After the variables and secrets above have been added, select `preflight`,
   leaving `create_service_account=false`. This checks organization usage-read,
   token-count access for both configured models, the live budget variables,
   and the existing Durable Object namespace. It reports the version serving
   100% of traffic, and stops if another uploaded version is newer.
4. Complete the account-side checks below. Use Cloudflare deployment history to
   map that version to reviewed source. Stop concurrent Cloudflare native builds
   and deploy workflows during the repair window. Obtain approval for the exact
   version and credential changes; a successful preflight is not that approval.
5. Select `repair` and enter the reviewed live version in `expected_version`.
   For an existing project key, leave `create_service_account=false`.
   To create a new service-account key through the Admin API, select `true`
   and supply both the provisioning admin key and the project ID.
6. Enter the exact confirmation phrase `APPLY-STABILIZE-REPAIR` and run.
7. Inspect the Actions result. The job repeats the preflight **before mutation**.
   It patches exactly three secrets into a new, undeployed version through the
   version-only endpoint used by the pinned Wrangler 4.118.0
   `versions secret bulk` command. It does not use the legacy
   `scripts/.../secrets-bulk` operation, which can deploy immediately.
   The new version must preserve the reviewed script hash, runtime, budget,
   ledger namespace, and all unrelated bindings before deployment to 100% traffic.
   A concurrent deployment stops this procedure; do not retry blindly.
8. The single guest probe must have streamed text, a final ordinary reply,
   positive model token usage, Standard processing, and no error events anywhere
   in the complete stream. A demo reply, HTTP 200 alone, quota stop, or a `done`
   event followed by an error is not restoration.

OpenAI's Default project may not permit adding service accounts. The
`create_service_account=true` path requires a project that supports them.
Do not create or switch projects blindly: free-token incentive eligibility,
model access, and costs can differ.

The workflow checks that `OPENAI_FREE_TOKENS_ONLY=true`, that the allowance is
`1000000`, that the daily ceiling is `900000`, and that the eligibility flag is
confirmed, in both the repository and the deployed version.
It never changes those values, resets the Durable Object ledger, or removes
unrelated Worker secrets. **Complimentary-token eligibility is an
account-side property this script cannot independently establish.**
Verify the enrollment and project configuration before running a production repair.

If the secret patch succeeds but a new Worker version cannot be uniquely
identified or its resources differ, the job requests no deployment and requires
manual inspection. It does not delete the new version or undo secret changes
automatically. Failed live chat after deployment is reported as a failed job,
not concealed by HTTP 200 from streaming.

## Account-side checks and remaining cost/privacy limits

The API key connector can create a key; that capability does not verify
enrollment, balance, ownership, or the permissions of existing GitHub/Worker
secrets. Do not create a replacement key merely to obtain account information.

Before repair, the organization owner must inspect:

1. [Organization settings](https://platform.openai.com/settings/organization/general)
   and the selected project: record their names and IDs privately and match the
   API key to this same organization/project. The usage admin key needs only
   organization usage-read access; the project key needs Responses creation and
   input-token counting for `gpt-5.4` and `gpt-5.6-sol`.
2. [Data-sharing settings](https://platform.openai.com/settings/organization/data-controls/sharing):
   verify actual complimentary-token enrollment, that this specific project
   shares inputs/outputs, and a 1M daily allowance for the shared model group.
   If the allowance is 250K, stop and request approval for a lower ceiling;
   do not silently change the approved 900K configuration.
3. [Billing overview](https://platform.openai.com/settings/organization/billing/overview):
   verify a positive balance without adding credit, enabling recharge, or
   increasing spending limits.
4. [Usage](https://platform.openai.com/usage): compare input and output tokens
   grouped by service tier against Costs. Verify that this project's Standard
   traffic receives the data-sharing incentive. Neither `service_tier=default`
   nor the repository eligibility flag establishes this account-side fact.
5. Review the public privacy disclosure before restoring generation. This
   program shares inputs/outputs for model improvement, including ordinary
   Private chat and any summaries. It is not appropriate for sensitive or
   confidential health information. Do not enable sharing without authorization.

The ledger cannot guarantee a zero bill: provider reporting can lag,
other projects/apps can consume the same organization allowance concurrently,
and enrollment can change without a request-level eligibility signal. The
nightly review workflow also uses a separate `OPENAI_API_KEY`; inspect its org
before assuming the production ledger is the organization's only consumer.
Isolating all shared-pool traffic behind one ledger reduces this risk; a separate
project or key alone does not. A strict no-charge requirement needs a verified
provider-enforced no-overage arrangement; until then, keep generation paused
when eligibility is uncertain. A project with sharing disabled and separately
approved funding is a safer privacy alternative for sensitive support use, but
requires an explicit billing/privacy decision and is outside this repair.

Provider references:

- [OpenAI complimentary-token requirements](https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai)
- [Cloudflare secret operation deployment behavior](https://developers.cloudflare.com/workers/configuration/secrets/)
- Pinned Wrangler package: `src/versions/secrets/index.ts`,
  `patchLatestWorkerVersionWithSecrets`, as shipped in Wrangler 4.118.0.

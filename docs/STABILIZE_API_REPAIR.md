# Stabilize API-only credential repair (manual GitHub Action)

The production chat diagnostic `budget_organization_credentials` indicates a
missing or invalid `OPENAI_ORGANIZATION_ID` or `OPENAI_USAGE_ADMIN_KEY`
binding. An earlier test returned `budget_input_count_http_401` as well.
Both must be verified; do not bypass the shared token-budget gate.

This workflow is deliberately **manual only**. A diagnostic run makes one
public `Hi` chat call and prints only the bounded error classification.
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
2. Choose `diagnose` to run one read-only live chat check without credentials.
3. After the variables and secrets above have been added, select `repair`.
   For an existing project key, leave `create_service_account=false`.
   To create a new service-account key through the Admin API, select `true`
   and supply both the provisioning admin key and the project ID.
4. Enter the exact confirmation phrase `APPLY-STABILIZE-REPAIR` and run.
5. Inspect the Actions result. The job validates OpenAI usage-read and
   token-count authentication **before updating Cloudflare**. It then patches
   exactly three secret values, deploys the newly created Worker version to
   100% traffic, verifies the deployment, and sends one `Hi` chat test.

OpenAI's Default project may not permit adding service accounts. The
`create_service_account=true` path requires a project that supports them.
Do not create or switch projects blindly: free-token incentive eligibility,
model access, and costs can differ.

The workflow checks that `OPENAI_FREE_TOKENS_ONLY=true`, that the committed
daily ceiling is `900000`, and that the eligibility flag is confirmed.
It never changes those values, resets the Durable Object ledger, or removes
unrelated Worker secrets. **Complimentary-token eligibility is an
account-side property this script cannot independently establish.**
Verify the enrollment and project configuration before running a production repair.

If the secret patch succeeds but a new Worker version cannot be uniquely
identified, the job stops **before deployment** and asks for manual
inspection. Failed live chat after deployment is reported as a failed job,
not concealed by HTTP 200 from streaming.

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

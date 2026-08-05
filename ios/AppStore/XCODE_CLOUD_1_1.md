# Xcode Cloud plan for Stabilize 1.1

This is the authoritative iOS build, test, archive, signing, TestFlight, and App Store Connect upload path for version 1.1. No local Mac, local Simulator, or GitHub-hosted iOS build may substitute for it.

## Prerequisites

- Active Apple Developer Program membership
- Accepted Apple agreements
- App Store Connect app record for bundle ID `info.stabilize.app`
- Apple Account with Account Holder, Admin, or App Manager access, or Developer access with Create Apps permission where applicable
- Xcode Cloud connected to the `lreedm1/Stabilize` GitHub repository
- Cloud-managed automatic signing enabled for the Stabilize product
- An internal TestFlight group

## Workflow 1: Pull Request Verification

**Name:** Stabilize iOS PR

**Start condition:** Pull requests targeting `main` when files under `ios/**` change.

**Environment:** Current publicly released Xcode and macOS versions.

**Actions:**

1. Build the `Stabilize` scheme.
2. Run `StabilizeTests` on one current iPhone simulator configuration in Xcode Cloud.
3. Analyze the `Stabilize` scheme.

**Post-actions:** Build-status notification only. Do not distribute pull-request builds.

**Merge requirement:** Configure the successful Xcode Cloud workflow or action as a required check for `main`. The release pull request must not merge without it.

## Workflow 2: Stabilize 1.1 Release

**Name:** Stabilize 1.1 Release

**Start condition:** Manual only, from the merged release commit or a `ios-1.1` tag.

**Environment:** Current publicly released Xcode and macOS versions, Clean enabled.

**Environment variables:**

- `STABILIZE_XCODE_CLOUD_RELEASE=1`
- `APP_STORE_CONNECT_KEY_ID` — Secret, only if Fastlane metadata/submission automation is used
- `APP_STORE_CONNECT_ISSUER_ID` — Secret, only if Fastlane metadata/submission automation is used
- `APP_STORE_CONNECT_KEY_CONTENT_BASE64` — Secret, only if Fastlane metadata/submission automation is used
- `XCODE_CLOUD_BUILD_NUMBER=2` — set only after build 2 is processed and selected for automated submission

**Actions:**

1. Test the `Stabilize` scheme.
2. Archive the `Stabilize` product with automatic signing.

**Post-actions:**

1. Upload the archive to App Store Connect.
2. Distribute to the internal TestFlight group.
3. Retain manual App Store release.

The release workflow may run `bundle exec fastlane ios metadata` after the Xcode Cloud build has been uploaded and processed. It may run `bundle exec fastlane ios submit` only after screenshots, review contact, privacy, age rating, export compliance, category, availability, and the physical-device TestFlight pass are complete.

## Build numbering

Repository version: `1.1 (2)`.

If Xcode Cloud is configured to manage build numbers automatically, set its next build number to `2` before the first release archive. Do not reuse a build number already uploaded for bundle ID `info.stabilize.app` and version 1.1.

## Failure handling

- Fix code or configuration only on the release branch.
- Rerun the Xcode Cloud workflow after each fix.
- Do not switch to GitHub Actions, a local build, or a local Simulator to bypass a failure.
- Do not merge while the Xcode Cloud required check is missing, queued indefinitely, cancelled, or failing.
- Do not submit a build that has not completed internal TestFlight testing on a physical iPhone.

## First-workflow account gate

Apple requires the first Xcode Cloud workflow to be configured through Xcode before later workflows can be managed in App Store Connect or through the App Store Connect API. This first configuration is an Apple-account action: select the Stabilize product, team, repository, and app record; grant Apple’s Xcode Cloud GitHub app access to this repository; and start the first cloud build. No source-code change can perform that authorization on the account holder’s behalf.

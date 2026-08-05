# Stabilize for iOS

A native SwiftUI client for the existing Stabilize Cloudflare Worker. The app sends guest check-ins to `https://stabilize.info/api/chat`; it never embeds an OpenAI key and intentionally omits account login and payments from the first App Store release.

## Stabilize 1.1

- Bundle ID: `info.stabilize.app`
- Marketing version: `1.1`
- Build number: `2`
- Minimum iOS version: `17.0`
- Distribution: iPhone, United States first

## Cloud-only release policy

Stabilize 1.1 must not be built, tested, archived, signed, or uploaded from a local Mac, a local Simulator, or GitHub Actions. Xcode Cloud is the only iOS build system for this release.

The GitHub `iOS release configuration` workflow performs text and metadata validation only. It never invokes `xcodebuild`, Simulator, signing, archiving, or binary upload commands.

The committed `Stabilize.xcodeproj` is generated from `project.yml` using cloud compute so Xcode Cloud always sees a stable project. When `project.yml` changes, regenerate the project in cloud compute and commit the resulting project changes before requesting an Xcode Cloud build.

## Required Xcode Cloud workflows

### Pull request verification

Configure an Xcode Cloud workflow that starts for pull requests targeting `main` when `ios/**` changes. It should use the current released Xcode and macOS environment and run:

1. Build
2. Unit tests for `StabilizeTests` on a current iPhone configuration
3. Analyze

Make the successful Xcode Cloud workflow a required pull-request check before merge.

### Stabilize 1.1 release

Configure a manually started clean Xcode Cloud workflow for the release branch or tag. It should run:

1. Unit tests
2. Archive with automatic signing for `info.stabilize.app`
3. An internal TestFlight distribution post-action
4. Upload of the archive to App Store Connect

Set `STABILIZE_XCODE_CLOUD_RELEASE=1` in the release workflow. If metadata and submission are automated with Fastlane from Xcode Cloud, also provide the App Store Connect API key fields as redacted environment variables and set `XCODE_CLOUD_BUILD_NUMBER` to the processed build selected for review.

## Privacy and product boundary

- The native app does not intentionally persist the user's prompt or assistant reply as a local transcript.
- Before the first send, the app requires permission to share an ordinary message with OpenAI; permission can be revoked from About.
- Messages travel through Cloudflare and OpenAI under the disclosures shown in the app and on the public privacy page.
- The app is not therapy, diagnosis, emergency care, or a guarantee of safety.
- The iPhone release is intended for adults 18+ and includes U.S. 988/911 actions when the server marks a response urgent.

## App Store release

See `AppStore/SUBMISSION.md` and `AppStore/XCODE_CLOUD_1_1.md`. App Store Connect credentials, agreements, review contact information, screenshots, signing access, and the first Xcode Cloud workflow remain account-bound and must never be committed to this public repository.

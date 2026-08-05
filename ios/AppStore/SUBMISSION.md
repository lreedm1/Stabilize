# Stabilize 1.1 App Store submission checklist

## Prepared in this repository

- Native iPhone SwiftUI app rather than a web wrapper
- Bundle ID: `info.stabilize.app`
- Version/build: `1.1 (2)`
- Automatic signing configuration
- App icon source and asset catalog
- Privacy manifest and app-switcher privacy cover
- Explicit pre-send OpenAI permission with revocation under About
- App Store description, subtitle, keywords, URLs, review notes, and 1.1 release notes
- No Google login, in-app purchase, external paid-plan link, analytics SDK, ads, tracking, HealthKit, location, camera, microphone, contacts, or notifications
- In-app privacy, safety, support, and project links
- A repository policy that prohibits local or GitHub-hosted iOS builds, tests, archives, signing, and binary uploads

## Required Xcode Cloud configuration

The release cannot merge until an Xcode Cloud pull-request workflow has completed successfully. Configure the workflows in `XCODE_CLOUD_1_1.md`.

The release workflow must:

1. Use the committed `Stabilize.xcodeproj` and shared `Stabilize` scheme.
2. Run `StabilizeTests` in Xcode Cloud.
3. Perform a clean archive in Xcode Cloud with automatic signing.
4. Upload the archive to App Store Connect and distribute it to an internal TestFlight group.
5. Keep manual App Store release selected.
6. Set `STABILIZE_XCODE_CLOUD_RELEASE=1` before any Fastlane metadata or submission lane runs.

Do not use local Xcode builds, local Simulator, GitHub Actions macOS builds, Fastlane `build_app`, Transporter, or `altool` for Stabilize 1.1.

## Apple-account work

These fields and permissions are account-bound and must not be committed to this public repository:

1. Active Apple Developer Program membership and accepted agreements.
2. Registration of `info.stabilize.app` in Certificates, Identifiers & Profiles.
3. App Store Connect app record:
   - Preferred name: Stabilize
   - Fallback if unavailable: Stabilize: One Next Step
   - Primary language: English (U.S.)
   - SKU: `stabilize-ios-1`
   - Bundle ID: `info.stabilize.app`
4. Xcode Cloud access to `lreedm1/Stabilize` through Apple’s GitHub app.
5. App Review contact name, phone number, and email address.
6. Age-rating questionnaire. The product is intended for adults 18+; App Store Connect determines the displayed rating from the answers.
7. App Privacy answers matching the current implementation and public privacy disclosure.
8. Export compliance: the app uses Apple’s standard HTTPS networking and declares `ITSAppUsesNonExemptEncryption = NO`.
9. Primary category: Lifestyle.
10. Initial availability: United States only, because the native urgent actions use U.S. 988 and 911 resources.
11. At least one accepted iPhone screenshot. Recommended: three portrait screenshots at an accepted current iPhone size showing the starter screen, a normal reply, and an urgent response with 988/911 actions.
12. An internal TestFlight tester group and a completed TestFlight pass on a physical iPhone.
13. VoiceOver, first-send consent, consent revocation, urgent-route, and production-backend checks on the TestFlight build.

## Submission sequence

1. Open the release pull request and let Xcode Cloud run the pull-request workflow.
2. Fix branch failures and rerun Xcode Cloud until build, test, and analyze actions pass.
3. Merge only after the Xcode Cloud check and repository checks are successful.
4. Start the clean Stabilize 1.1 release workflow from the merged commit or release tag.
5. Let Xcode Cloud archive, sign, upload, and distribute build `2` to internal TestFlight.
6. Complete the physical-device TestFlight checks.
7. Upload screenshots and finish the account-bound App Store Connect questionnaires.
8. Run the Xcode Cloud-restricted Fastlane metadata lane, or enter the prepared metadata in App Store Connect.
9. Select the processed Xcode Cloud build for version 1.1.
10. Add version 1.1 for review and submit the draft submission to App Review with manual release selected.

## Stop conditions

Do not merge or submit if the Xcode Cloud workflow is absent or failing, the backend is unexpectedly in demo mode, urgent fixed routes fail, consent can be bypassed, revocation does not restore the consent prompt, the privacy page is inaccurate, support contact does not work, the app crashes, screenshots are missing, or a physical-device TestFlight pass has not been completed.

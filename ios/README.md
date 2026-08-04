# Stabilize for iOS

A native SwiftUI client for the existing Stabilize Cloudflare Worker. The app sends guest check-ins to `https://stabilize.info/api/chat`; it never embeds an OpenAI key and intentionally omits account login and payments from version 1.

## Requirements

- macOS 26 or later recommended
- Xcode 26 or later
- XcodeGen (`brew install xcodegen`)
- An Apple Developer Program membership for device/TestFlight/App Store distribution

## Generate and run

```bash
cd ios
xcodegen generate
open Stabilize.xcodeproj
```

Select the `Stabilize` scheme. For a local simulator build, signing is not required. For a device or archive, choose your development team in Xcode and register the bundle ID `info.stabilize.app` in your Apple Developer account.

## Validate from the command line

```bash
cd ios
xcodegen generate
xcodebuild \
  -project Stabilize.xcodeproj \
  -scheme Stabilize \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

The GitHub Actions workflow performs the same generation, builds with Xcode 26 on macOS 26, and runs unit tests on an available simulator.

## Privacy and product boundary

- The native app does not intentionally persist the user's prompt or assistant reply.
- Guest app chats do not create a retrievable conversation history on the Stabilize Worker.
- Before the first send, the app requires permission to share an ordinary message with OpenAI;
  permission can be revoked from About.
- Messages travel through Cloudflare. Ordinary replies use OpenAI with `store: true`, so OpenAI
  currently stores resulting Responses API data for at least 30 days unless project data controls
  override the request.
- The app is not therapy, diagnosis, emergency care, or a guarantee of safety.
- Version 1 is an iPhone app for adults 18+ and includes U.S. 988/911 actions when the server marks a response urgent.

## App Store release

See `AppStore/SUBMISSION.md`. Fastlane metadata and a starter `Fastfile` are under `fastlane/`. Signing and submission still require the developer's Apple account, legal agreements, App Store Connect app record, contact details, screenshots, and signing credentials.

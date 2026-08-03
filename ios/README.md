# Stabilize for iOS

Native SwiftUI starter app for the existing Stabilize Cloudflare Worker.

## Requirements

- macOS with Xcode 26 or newer recommended
- iOS 17 minimum deployment target
- The deployed backend at `https://stabilize.info`

The app uses iOS 26 Liquid Glass when available and falls back to native material surfaces on iOS 17–25.

## Run it

1. Open `Stabilize.xcodeproj`.
2. Select the **Stabilize** target.
3. Open **Signing & Capabilities** and choose your Apple development team.
4. Select an iPhone simulator or your connected iPhone.
5. Press **Run**.

No OpenAI key belongs in this project. The app sends guest requests to:

```text
POST https://stabilize.info/api/chat
```

with:

```json
{
  "message": "What is happening right now?",
  "awaitingSafetyAnswer": false
}
```

The app expects:

```json
{
  "route": "DIRECT",
  "reply": "...",
  "showEmergency": false,
  "awaitingSafetyAnswer": false
}
```

## Current scope

- Native SwiftUI chat
- Guest-only, ephemeral URL session
- No transcript persistence
- Exact server-side safety route fields
- Automatic urgent-help surface
- Dynamic Type, VoiceOver labels, text selection
- iOS 26 Liquid Glass with an iOS 17–25 fallback
- Nature-inspired native background
- No API key in the app

## Deliberately not included yet

- Google account sign-in and 30-day remembered context
- Push notifications
- Analytics
- Crash reporting
- Production legal review and finalized App Store Connect privacy answers
- Localization
- Formal unit/UI test targets

The website’s current Google flow is browser-oriented. Native remembered context should be added as a separate backend feature rather than attempting to reuse the website cookie flow invisibly.

## Change the server URL

Edit `Stabilize/AppConfiguration.swift`.

## Before TestFlight

- Review every urgent-help path with qualified clinical/crisis reviewers.
- Verify the included privacy manifest and App Store privacy answers against the production provider settings.
- Verify the icon and screenshots.
- Test VoiceOver, larger text, low connectivity, server errors, and repeated urgent routes.
- Add rate limiting and production monitoring on the Worker without logging prompt bodies.

Draft listing copy, privacy answers, review notes, and the release checklist are in
`AppStore/metadata.md`.

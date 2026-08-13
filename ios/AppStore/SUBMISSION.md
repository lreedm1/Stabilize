# App Store submission checklist

## Already prepared in this repository

- Native iPhone SwiftUI app rather than a web wrapper
- Bundle ID: `info.stabilize.app`
- Version/build: `1.0.0 (1)`
- App icon source and asset catalog
- Privacy manifest and an app-switcher privacy cover
- Explicit pre-send OpenAI permission with revocation under About
- Unit tests and macOS 26 / Xcode 26 CI
- App Store description, subtitle, keywords, URLs, review notes, and release notes
- No Google login, external paid-plan link, analytics SDK, ads, tracking, HealthKit, location, camera, microphone, contacts, or notifications in version 1
- In-app privacy, safety, support, and project links

## Apple-account work that cannot be stored in a public repository

1. Enroll in the Apple Developer Program and accept current agreements.
2. Register `info.stabilize.app` in Certificates, Identifiers & Profiles.
3. Create the App Store Connect record:
   - Preferred name: Stabilize
   - Fallback if the exact name is unavailable: Stabilize: One Next Step
   - Primary language: English (U.S.)
   - SKU: `stabilize-ios-1`
   - Bundle ID: `info.stabilize.app`
4. Enter an App Review contact phone number and email.
5. Complete the current age-rating questionnaire honestly. The product is intended for adults 18+; App Store Connect determines the displayed rating from the answers.
6. Complete App Privacy answers to match `privacy.html` and the implementation. Declare Other User Content collected for App Functionality, not linked to an in-app identity and not used for tracking. User-entered text is sent off-device and OpenAI currently stores resulting Responses API data for at least 30 days because the Worker uses `store: true`, unless project data controls override the request.
7. Answer export compliance: the app uses only Apple's standard HTTPS networking and declares `ITSAppUsesNonExemptEncryption = NO`.
8. Choose Lifestyle as the primary category. Avoid medical-device, therapy, diagnosis, or suicide-prevention outcome claims.
9. Limit version 1 availability to the United States. The native urgent-action buttons and fixed response text use U.S. 988 and 911 resources; add localized resources before expanding storefront availability.
10. Capture at least one accepted iPhone screenshot. Recommended: three portrait screenshots at an accepted 6.9-inch size, showing:
    - the starter screen;
    - a normal floor-first reply;
    - an urgent response with 988/911 actions.

    For deterministic screenshot data, launch with `--ui-testing`. Enter `Review safety check`, choose **Allow & Send Message** if prompted, then enter `Unsure` to reach the urgent screen without using a real person's information.
11. In Xcode, select the developer team, archive with Xcode 26+, upload to App Store Connect, and test through TestFlight.
12. Keep `https://stabilize.info`, `privacy.html`, `safety.html`, `support.html`, and the API live during App Review.
13. Paste the prepared review notes and submit manually only after on-device safety, accessibility, first-send consent, and consent-revocation checks.

## Suggested review sequence

1. Internal TestFlight
2. Small external TestFlight group
3. Fix crashes, layout issues, VoiceOver problems, and backend errors
4. Independent privacy/security/safety review appropriate to the product's risk
5. App Review submission with manual release selected

## Stop conditions before submission

Do not submit if the backend is in demo mode unexpectedly, urgent fixed routes fail, consent can be bypassed, revocation does not restore the consent prompt, the privacy page is inaccurate, support contact does not work, the app crashes, or a real-device test has not been completed.

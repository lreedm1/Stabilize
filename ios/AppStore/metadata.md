# Stabilize: Smaller Next Step 1.0 App Store metadata

## App information

- Name: `Stabilize: Smaller Next Step`
- Subtitle: `A smaller next step`
- Primary category: `Health & Fitness`
- Secondary category: `Lifestyle`
- Bundle ID: `info.stabilize.app`
- SKU suggestion: `stabilize-ios-1`
- Copyright: confirm the legal seller name before submission
- Initial availability: United States only, because the urgent-help screen currently provides U.S. 911 and 988 resources
- Price: Free

## URLs

- Privacy policy: `https://stabilize.info/privacy.html`
- Support: `https://github.com/lreedm1/Stabilize/issues`
- Marketing: `https://stabilize.info`

## Localized listing (English, U.S.)

### Promotional text

When everything feels large, start with one safe, manageable next step.

### Description

Stabilize is a free, floor-first AI check-in for adults in overloaded moments.

Describe what is happening and get a concise response aimed at reducing cognitive load, protecting immediate needs, and identifying one safe, reversible next step.

Stabilize can help you:

- make an overwhelming task smaller
- separate what is urgent from what can wait
- identify a practical next action
- find immediate U.S. crisis and emergency contact options when the situation may be urgent

Guest conversations are not saved on your device or remembered by the Stabilize server. Messages are transmitted to Stabilize's Cloudflare-hosted service and processed by OpenAI to generate a response. Review the privacy policy for provider-processing details.

Stabilize is not therapy, diagnosis, medical treatment, emergency monitoring, or a substitute for a qualified professional or emergency service. AI responses can be incomplete or wrong. In immediate danger or a medical emergency, contact a person or service able to respond now.

For adults 18+.

### Keywords

`overwhelm,grounding,stress,next step,self care,decision support,check in`

### What's New

Initial release.

## App privacy

Conservative disclosure based on the current production path:

- Data type: Other User Content
- Purpose: App Functionality
- Linked to user: No
- Used for tracking: No

Reason: free-form chat text is sent to the backend and OpenAI. The app and Stabilize backend do not retain guest conversation history, but OpenAI's default abuse-monitoring logs may retain customer content for up to 30 days unless the API organization is approved for Modified Abuse Monitoring or Zero Data Retention.

Do not select Health data merely because a user might type health information into the generic free-form field; Apple's guidance uses Other User Content for a generic text field unless the app specifically asks for a particular data type.

## Review notes

Stabilize is a guest-only AI check-in; no account or demo credentials are required. The app sends messages to `https://stabilize.info/api/chat` and displays the returned response. The backend is live.

The app does not diagnose, prescribe, provide therapy, monitor users, or contact emergency responders. A deterministic server-side safety route can display a clearly labeled urgent-help sheet with U.S. 911 and 988 call/text links. The app also explains these limitations in its About and Safety screens.

The app uses only system-provided HTTPS encryption and declares that it does not use non-exempt encryption.

## Submission checklist

- Confirm the Apple Developer legal entity and copyright.
- Verify App Store Connect has a Bundle ID and app record for `info.stabilize.app`.
- Select the signing team and let Xcode create the distribution certificate/profile.
- Run release build and archive validation on Xcode 26.6.
- Upload the validated archive with `AppStore/ExportOptions.plist` or Xcode Organizer.
- Test the live chat, error handling, Dynamic Type, VoiceOver, dark mode, iPhone, and iPad.
- Capture current iPhone and iPad screenshots from the signed release candidate.
- Complete the age-rating questionnaire accurately and keep the listing adults-only.
- Set availability to the United States for version 1.0.
- Confirm the privacy answers above against the actual OpenAI and Cloudflare production account settings.
- Add review contact information and submit only after the safety/privacy owner approves the release candidate.

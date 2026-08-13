import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("native iOS sends only after explicit OpenAI sharing permission", async () => {
  const [checkIn, consent, info, config, manifest, publicPrivacy, reviewNotes] =
    await Promise.all([
      read("ios/Stabilize/Features/CheckIn/CheckInView.swift"),
      read("ios/Stabilize/Features/CheckIn/AIProcessingConsentView.swift"),
      read("ios/Stabilize/Features/Info/InfoView.swift"),
      read("ios/Stabilize/API/AppConfiguration.swift"),
      read("ios/Stabilize/Resources/PrivacyInfo.xcprivacy"),
      read("public/privacy.html"),
      read("ios/fastlane/review_information/notes.txt"),
    ]);

  assert.match(config, /aiProcessingConsentKey/);
  assert.match(checkIn, /@AppStorage\(AppConfiguration\.aiProcessingConsentKey\)/);
  assert.match(
    checkIn,
    /guard hasAllowedThirdPartyAIProcessing else \{[\s\S]*presentedSheet = \.aiProcessingConsent[\s\S]*return[\s\S]*\}/,
  );
  assert.match(checkIn, /\.sheet\(item: \$presentedSheet\)/);

  assert.match(consent, /Allow & Send Message/);
  assert.match(consent, /Choosing Not now sends nothing/);
  assert.match(consent, /OpenAI, a third-party AI provider/);
  assert.match(consent, /store: true/);
  assert.match(consent, /at least 30 days/);
  assert.ok(
    consent.indexOf("hasAllowedThirdPartyAIProcessing = true") <
      consent.indexOf("sendAction()"),
    "permission must be recorded before the network action runs",
  );

  assert.match(info, /Revoke AI sharing permission/);
  assert.match(info, /hasAllowedThirdPartyAIProcessing = false/);
  assert.match(manifest, /NSPrivacyAccessedAPICategoryUserDefaults/);
  assert.match(manifest, /CA92\.1/);

  assert.match(publicPrivacy, /Nothing is sent until the user allows that sharing/);
  assert.match(publicPrivacy, /store: true/);
  assert.match(publicPrivacy, /at least 30 days/);
  assert.match(reviewNotes, /requires Allow & Send Message/);
});

test("iOS CI builds the generated project and enforces simulator tests", async () => {
  const workflow = await read(".github/workflows/ios.yml");

  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /xcodegen generate/);
  assert.match(workflow, /generic\/platform=iOS Simulator/);
  assert.match(workflow, /xcodebuild[\s\S]*test/);
  assert.match(workflow, /Enforce unit-test result/);
});

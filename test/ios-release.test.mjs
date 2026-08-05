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

test("Stabilize 1.1 reserves all iOS build and distribution work for Xcode Cloud", async () => {
  const [workflow, project, fastfile, readme, submission, cloudPlan, notes] =
    await Promise.all([
      read(".github/workflows/ios.yml"),
      read("ios/project.yml"),
      read("ios/fastlane/Fastfile"),
      read("ios/README.md"),
      read("ios/AppStore/SUBMISSION.md"),
      read("ios/AppStore/XCODE_CLOUD_1_1.md"),
      read("ios/fastlane/metadata/en-US/release_notes.txt"),
    ]);

  assert.match(project, /CURRENT_PROJECT_VERSION: 2/);
  assert.match(project, /MARKETING_VERSION: 1\.1/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER: info\.stabilize\.app/);
  assert.match(project, /CODE_SIGN_STYLE: Automatic/);

  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /Validate Xcode Cloud release configuration/);
  assert.doesNotMatch(workflow, /runs-on: macos/);
  assert.doesNotMatch(workflow, /xcodebuild/);
  assert.doesNotMatch(workflow, /simctl/);
  assert.doesNotMatch(workflow, /iOS Simulator/);

  assert.match(fastfile, /STABILIZE_XCODE_CLOUD_RELEASE/);
  assert.match(fastfile, /app_version: "1\.1"/);
  assert.match(fastfile, /skip_binary_upload: true/);
  assert.match(fastfile, /submit_for_review: true/);
  assert.doesNotMatch(fastfile, /build_app\(/);
  assert.doesNotMatch(fastfile, /upload_to_testflight\(/);

  assert.match(readme, /Xcode Cloud is the only iOS build system/);
  assert.match(submission, /must not merge until an Xcode Cloud/);
  assert.match(cloudPlan, /Pull Request Verification/);
  assert.match(cloudPlan, /Stabilize 1\.1 Release/);
  assert.match(cloudPlan, /physical iPhone/);
  assert.match(notes, /Stabilize 1\.1/);
});

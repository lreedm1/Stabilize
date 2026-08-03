import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/feedback-worker.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
} from "../src/auth.js";

const TEST_ENV = {
  ...env,
  PUBLIC_ORIGIN: "https://stabilize.info",
  GOOGLE_CLIENT_ID:
    "1234567890-stabilize-feedback-tests.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  AUTH_SECRET: "test-auth-secret-with-at-least-thirty-two-characters",
  GITHUB_FEEDBACK_TOKEN: "github_pat_1234567890abcdefghijklmnop",
  FEEDBACK_REPOSITORY: "lreedm1/Stabilize",
  FEEDBACK_BRANCH: "feedback-inbox",
  FEEDBACK_PATH: "feedback",
};

async function signedCookie() {
  const token = await createAuthSessionTokenForGoogleSubject(
    "feedback-test-user",
    TEST_ENV,
  );
  return `${AUTH_COOKIE_NAME}=${token}`;
}

test("signed-in users see the public-storage and automated-review warning", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: await signedCookie() },
    }),
    TEST_ENV,
    {},
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /action="\/api\/feedback"/);
  assert.match(html, /saved in a public GitHub repository/i);
  assert.match(html, /reviewed by automated AI tooling/i);
  assert.match(html, /name="public_ack"[\s\S]*required/);
  assert.doesNotMatch(html, /feedback-test-user/);
});

test("feedback submission requires sign-in and public-storage acknowledgement", async () => {
  const signedOut = await worker.fetch(
    new Request("https://stabilize.info/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://stabilize.info",
      },
      body: new URLSearchParams({
        category: "idea",
        message: "Make the model labels clearer.",
        public_ack: "yes",
      }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(signedOut.status, 303);
  assert.equal(signedOut.headers.get("location"), "/auth/google");

  const missingConsent = await worker.fetch(
    new Request("https://stabilize.info/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: await signedCookie(),
        Origin: "https://stabilize.info",
      },
      body: new URLSearchParams({
        category: "idea",
        message: "Make the model labels clearer.",
      }),
    }),
    TEST_ENV,
    {},
  );
  assert.equal(missingConsent.status, 303);
  assert.equal(missingConsent.headers.get("location"), "/?feedback=invalid");
});

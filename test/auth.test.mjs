import { test } from "vitest";
import assert from "node:assert/strict";
import {
  AUTH_COOKIE_NAME,
  GoogleAuthConfigurationError,
  beginGoogleSignIn,
  completeGoogleSignIn,
  createAuthSessionTokenForGoogleSubject,
  googleAuthConfigured,
  readAuthSession,
  signOut,
} from "../src/auth.js";

const GOOGLE_CLIENT_ID =
  "1234567890-stabilize-auth-tests.apps.googleusercontent.com";

function createEnv(overrides = {}) {
  return {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    AUTH_SECRET: "test-auth-secret-with-at-least-thirty-two-characters",
    PUBLIC_ORIGIN: "https://stabilize.test",
    ...overrides,
  };
}

function cookiePair(setCookie, name) {
  const match = String(setCookie || "").match(
    new RegExp(`(?:^|,\\s*)${name}=([^;,\\s]*)`),
  );
  assert.ok(match, `Missing ${name} cookie`);
  return `${name}=${match[1]}`;
}

function encodeJwtPart(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fakeIdToken(payload) {
  return `${encodeJwtPart({ alg: "RS256", typ: "JWT" })}.${encodeJwtPart(payload)}.signature`;
}

test("Google sign-in starts with state, nonce, PKCE, and a protected cookie", async () => {
  const response = await beginGoogleSignIn(
    new Request("https://stabilize.test/auth/google"),
    createEnv(),
  );
  const location = new URL(response.headers.get("location"));
  const setCookie = response.headers.get("set-cookie");

  assert.equal(response.status, 302);
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.pathname, "/o/oauth2/v2/auth");
  assert.equal(location.searchParams.get("client_id"), GOOGLE_CLIENT_ID);
  assert.equal(
    location.searchParams.get("redirect_uri"),
    "https://stabilize.test/auth/google/callback",
  );
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.equal(location.searchParams.get("scope"), "openid");
  assert.match(location.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(location.searchParams.get("nonce"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.match(
    location.searchParams.get("code_challenge"),
    /^[A-Za-z0-9_-]{43}$/,
  );
  assert.match(setCookie, /stabilize_oauth=/);
  assert.match(setCookie, /Path=\/auth\/google\/callback/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);
});

test("sign-in always begins on the configured canonical origin", async () => {
  const response = await beginGoogleSignIn(
    new Request("https://stabilize-preview.workers.dev/auth/google"),
    createEnv(),
  );

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    "https://stabilize.test/auth/google",
  );
  assert.equal(response.headers.get("set-cookie"), null);
});

test("the callback exchanges the code and creates an account session", async () => {
  const env = createEnv();
  const start = await beginGoogleSignIn(
    new Request("https://stabilize.test/auth/google"),
    env,
  );
  const authorizationUrl = new URL(start.headers.get("location"));
  const state = authorizationUrl.searchParams.get("state");
  const nonce = authorizationUrl.searchParams.get("nonce");
  const oauthCookie = cookiePair(start.headers.get("set-cookie"), "stabilize_oauth");
  const originalFetch = globalThis.fetch;
  let tokenRequest;

  globalThis.fetch = async (input, init) => {
    tokenRequest = { input: String(input), init };
    const now = Math.floor(Date.now() / 1_000);
    return Response.json({
      access_token: "transient-access-token",
      id_token: fakeIdToken({
        iss: "https://accounts.google.com",
        aud: GOOGLE_CLIENT_ID,
        azp: GOOGLE_CLIENT_ID,
        sub: "google-account-123",
        nonce,
        iat: now,
        exp: now + 3_600,
      }),
      token_type: "Bearer",
    });
  };

  try {
    const response = await completeGoogleSignIn(
      new Request(
        `https://stabilize.test/auth/google/callback?code=test-code&state=${state}`,
        { headers: { Cookie: oauthCookie } },
      ),
      env,
    );
    const setCookie = response.headers.get("set-cookie");
    const authCookie = cookiePair(setCookie, AUTH_COOKIE_NAME);
    const tokenBody = new URLSearchParams(tokenRequest.init.body);
    const session = await readAuthSession(
      new Request("https://stabilize.test/", {
        headers: { Cookie: authCookie },
      }),
      env,
    );

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://stabilize.test/");
    assert.equal(tokenRequest.input, "https://oauth2.googleapis.com/token");
    assert.equal(tokenRequest.init.method, "POST");
    assert.equal(tokenBody.get("code"), "test-code");
    assert.equal(tokenBody.get("client_id"), GOOGLE_CLIENT_ID);
    assert.equal(tokenBody.get("client_secret"), "test-google-client-secret");
    assert.equal(
      tokenBody.get("redirect_uri"),
      "https://stabilize.test/auth/google/callback",
    );
    assert.equal(tokenBody.get("grant_type"), "authorization_code");
    assert.match(tokenBody.get("code_verifier"), /^[A-Za-z0-9_-]{64}$/);
    assert.match(setCookie, /stabilize_oauth=;/);
    assert.match(setCookie, /stabilize_session=;/);
    assert.ok(session);
    assert.match(session.accountKey, /^[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(setCookie, /google-account-123|transient-access-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a mismatched state is rejected before the Google token request", async () => {
  const env = createEnv();
  const start = await beginGoogleSignIn(
    new Request("https://stabilize.test/auth/google"),
    env,
  );
  const oauthCookie = cookiePair(start.headers.get("set-cookie"), "stabilize_oauth");
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({});
  };
  console.error = () => {};

  try {
    const response = await completeGoogleSignIn(
      new Request(
        "https://stabilize.test/auth/google/callback?code=test-code&state=wrong",
        { headers: { Cookie: oauthCookie } },
      ),
      env,
    );

    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      "https://stabilize.test/?auth=failed",
    );
    assert.equal(fetchCalls, 0);
    assert.doesNotMatch(response.headers.get("set-cookie"), /stabilize_auth=/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("provider cancellation is accepted only with matching flow state", async () => {
  const env = createEnv();
  const start = await beginGoogleSignIn(
    new Request("https://stabilize.test/auth/google"),
    env,
  );
  const authorizationUrl = new URL(start.headers.get("location"));
  const state = authorizationUrl.searchParams.get("state");
  const oauthCookie = cookiePair(start.headers.get("set-cookie"), "stabilize_oauth");
  const originalError = console.error;
  console.error = () => {};

  try {
    const cancelled = await completeGoogleSignIn(
      new Request(
        `https://stabilize.test/auth/google/callback?error=access_denied&state=${state}`,
        { headers: { Cookie: oauthCookie } },
      ),
      env,
    );
    const forged = await completeGoogleSignIn(
      new Request(
        "https://stabilize.test/auth/google/callback?error=access_denied&state=wrong",
        { headers: { Cookie: oauthCookie } },
      ),
      env,
    );

    assert.equal(
      cancelled.headers.get("location"),
      "https://stabilize.test/?auth=cancelled",
    );
    assert.equal(
      forged.headers.get("location"),
      "https://stabilize.test/?auth=failed",
    );
  } finally {
    console.error = originalError;
  }
});

test("Google subjects resolve to stable, isolated memory identities", async () => {
  const env = createEnv();
  const firstToken = await createAuthSessionTokenForGoogleSubject(
    "stable-google-subject",
    env,
    Date.now(),
  );
  const secondToken = await createAuthSessionTokenForGoogleSubject(
    "stable-google-subject",
    env,
    Date.now() + 1_000,
  );
  const otherToken = await createAuthSessionTokenForGoogleSubject(
    "different-google-subject",
    env,
    Date.now() + 1_000,
  );
  const [first, second, other] = await Promise.all([
    readAuthSession(
      new Request("https://stabilize.test/", {
        headers: { Cookie: `${AUTH_COOKIE_NAME}=${firstToken}` },
      }),
      env,
    ),
    readAuthSession(
      new Request("https://stabilize.test/", {
        headers: { Cookie: `${AUTH_COOKIE_NAME}=${secondToken}` },
      }),
      env,
      Date.now() + 1_000,
    ),
    readAuthSession(
      new Request("https://stabilize.test/", {
        headers: { Cookie: `${AUTH_COOKIE_NAME}=${otherToken}` },
      }),
      env,
      Date.now() + 1_000,
    ),
  ]);

  assert.ok(first);
  assert.ok(second);
  assert.ok(other);
  assert.equal(first.accountKey, second.accountKey);
  assert.notEqual(first.accountKey, other.accountKey);
});

test("tampered sessions are rejected and sign-out clears both cookie formats", async () => {
  const env = createEnv();
  const token = await createAuthSessionTokenForGoogleSubject("test-user", env);
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  const session = await readAuthSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${tampered}` },
    }),
    env,
  );
  const response = signOut(
    new Request("https://stabilize.test/auth/logout", { method: "POST" }),
    env,
  );

  assert.equal(session, null);
  assert.equal(response.status, 303);
  assert.match(response.headers.get("set-cookie"), /stabilize_auth=;/);
  assert.match(response.headers.get("set-cookie"), /stabilize_session=;/);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("missing Google secrets keep sign-in unavailable", async () => {
  const env = createEnv({ GOOGLE_CLIENT_SECRET: "" });
  assert.equal(googleAuthConfigured(env), false);
  await assert.rejects(
    beginGoogleSignIn(
      new Request("https://stabilize.test/auth/google"),
      env,
    ),
    GoogleAuthConfigurationError,
  );

  assert.equal(
    googleAuthConfigured(createEnv({ PUBLIC_ORIGIN: "http://example.com" })),
    false,
  );
  assert.equal(googleAuthConfigured(createEnv({ PUBLIC_ORIGIN: "" })), false);
});

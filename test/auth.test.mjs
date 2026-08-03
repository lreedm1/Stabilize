import { test } from "vitest";
import assert from "node:assert/strict";
import {
  AUTH_COOKIE_NAME,
  GUEST_COOKIE_NAME,
  GoogleAuthConfigurationError,
  MEMORY_DELETION_COOKIE_NAME,
  beginGoogleSignIn,
  completeGoogleSignIn,
  createAuthSessionTokenForGoogleSubject,
  createGuestSession,
  createGuestResetGrant,
  createMemoryDeletionReceiptCookie,
  googleAuthConfigured,
  readAuthSession,
  readGuestResetGrant,
  readGuestSession,
  readMemoryDeletionReceipt,
  refreshLegacyAuthSession,
  rotateAuthSession,
  signOut,
} from "../src/auth.js";

const GOOGLE_CLIENT_ID =
  "1234567890-stabilize-auth-tests.apps.googleusercontent.com";

function createEnv(overrides = {}) {
  return {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    AUTH_SECRET: "test-auth-secret-with-at-least-thirty-two-characters",
    SESSION_SECRET: "test-session-secret-with-at-least-thirty-two-characters",
    GUEST_SESSION_SECRET:
      "test-guest-session-secret-with-at-least-thirty-two-characters",
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

function base64UrlBytes(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function legacyAuthToken(payload, secret) {
  const encoded = encodeJwtPart(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`stabilize:auth-session:v1\u0000${encoded}`),
  );
  return `${encoded}.${base64UrlBytes(signature)}`;
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
    assert.match(session.continuityToken, /^[A-Za-z0-9_-]{43}$/);
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
  assert.notEqual(first.continuityToken, second.continuityToken);
});

test("session-key rotation revokes cookies without changing account identity", async () => {
  const before = createEnv({
    SESSION_SECRET: "before-rotation-session-secret-with-thirty-two-characters",
  });
  const after = createEnv({
    SESSION_SECRET: "after-rotation-session-secret-with-thirty-two-characters",
  });
  const subject = "stable-across-cookie-key-rotation";
  const beforeToken = await createAuthSessionTokenForGoogleSubject(subject, before);
  const afterToken = await createAuthSessionTokenForGoogleSubject(subject, after);
  const cookieRequest = (token) =>
    new Request("https://stabilize.test/", {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });

  const beforeSession = await readAuthSession(cookieRequest(beforeToken), before);
  const afterSession = await readAuthSession(cookieRequest(afterToken), after);

  assert.equal(await readAuthSession(cookieRequest(beforeToken), after), null);
  assert.equal(beforeSession.accountKey, afterSession.accountKey);
  assert.notEqual(beforeSession.continuityToken, afterSession.continuityToken);
  assert.equal(googleAuthConfigured(createEnv({ SESSION_SECRET: "" })), false);
  assert.equal(
    googleAuthConfigured(
      createEnv({
        SESSION_SECRET:
          "test-auth-secret-with-at-least-thirty-two-characters",
      }),
    ),
    false,
  );
});

test("legacy v1 auth cookies have a fixed issuance cutoff and sunset", async () => {
  const env = createEnv();
  const sessionSeconds = 30 * 24 * 60 * 60;
  const cutoff = Math.floor(Date.parse("2026-08-04T00:00:00Z") / 1_000);
  const cookieRequest = (token) =>
    new Request("https://stabilize.test/", {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });

  const issuedBefore = cutoff - 60;
  const accepted = await legacyAuthToken(
    {
      v: 1,
      a: "A".repeat(43),
      iat: issuedBefore,
      exp: issuedBefore + sessionSeconds,
    },
    env.AUTH_SECRET,
  );
  const issuedAtCutoff = cutoff;
  const rejectedAtCutoff = await legacyAuthToken(
    {
      v: 1,
      a: "B".repeat(43),
      iat: issuedAtCutoff,
      exp: issuedAtCutoff + sessionSeconds,
    },
    env.AUTH_SECRET,
  );

  assert.ok(
    await readAuthSession(
      cookieRequest(accepted),
      env,
      (issuedBefore + 1) * 1_000,
    ),
  );
  assert.equal(
    await readAuthSession(
      cookieRequest(rejectedAtCutoff),
      env,
      (issuedAtCutoff + 1) * 1_000,
    ),
    null,
  );

  const acceptedSession = await readAuthSession(
    cookieRequest(accepted),
    env,
    (issuedBefore + 1) * 1_000,
  );
  assert.equal(acceptedSession.needsRefresh, true);
  assert.equal(
    await readAuthSession(
      cookieRequest(accepted),
      env,
      (issuedBefore + sessionSeconds) * 1_000,
    ),
    null,
  );

  const refreshed = await refreshLegacyAuthSession(
    cookieRequest(accepted),
    env,
    acceptedSession,
    (issuedBefore + 1) * 1_000,
  );
  const refreshedCookie = cookiePair(refreshed.setCookie, AUTH_COOKIE_NAME);
  const refreshedSession = await readAuthSession(
    cookieRequest(refreshedCookie.split("=")[1]),
    env,
    (issuedBefore + 2) * 1_000,
  );
  assert.equal(refreshedSession.accountKey, acceptedSession.accountKey);
  assert.notEqual(
    refreshedSession.continuityToken,
    acceptedSession.continuityToken,
  );
  assert.equal(refreshedSession.expiresAt, acceptedSession.expiresAt);
  assert.equal(refreshedSession.needsRefresh, false);
});

test("rotating an account session preserves identity and changes continuity", async () => {
  const env = createEnv();
  const now = Date.parse("2026-08-03T20:00:00Z");
  const token = await createAuthSessionTokenForGoogleSubject(
    "rotation-account",
    env,
    now,
  );
  const request = new Request("https://stabilize.test/", {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
  });
  const original = await readAuthSession(request, env, now);
  const rotated = await rotateAuthSession(request, env, original, now + 1_000);
  const rotatedCookie = cookiePair(rotated.setCookie, AUTH_COOKIE_NAME);
  const replacement = await readAuthSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: rotatedCookie },
    }),
    env,
    now + 1_000,
  );

  assert.equal(replacement.accountKey, original.accountKey);
  assert.notEqual(replacement.continuityToken, original.continuityToken);
  assert.equal(replacement.needsRefresh, false);
  assert.match(rotated.setCookie, /HttpOnly/);
  assert.match(rotated.setCookie, /SameSite=Lax/);
});

test("guest sessions use an opaque signed host cookie and a separate public binding", async () => {
  const env = createEnv();
  const now = Date.parse("2026-08-03T20:00:00Z");
  const issued = await createGuestSession(
    new Request("https://stabilize.test/"),
    env,
    now,
  );
  const guestCookie = cookiePair(issued.setCookie, GUEST_COOKIE_NAME);
  const restored = await readGuestSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: guestCookie },
    }),
    env,
    now + 1_000,
  );

  assert.match(issued.setCookie, /^__Host-stabilize_guest=/);
  assert.match(issued.setCookie, /Path=\//);
  assert.match(issued.setCookie, /HttpOnly/);
  assert.match(issued.setCookie, /SameSite=Lax/);
  assert.match(issued.setCookie, /Secure/);
  assert.match(issued.setCookie, /Max-Age=31536000/);
  assert.ok(issued.session);
  assert.match(issued.session.guestKey, /^[A-Za-z0-9_-]{43}$/);
  assert.match(issued.session.continuityToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(
    issued.session.continuityToken,
    issued.session.guestKey,
  );
  assert.deepEqual(restored, issued.session);
});

test("guest sessions are isolated and fail closed on tampering, expiry, key rotation, and duplicate cookies", async () => {
  const env = createEnv();
  const now = Date.parse("2026-08-03T20:00:00Z");
  const [first, second] = await Promise.all([
    createGuestSession(new Request("https://stabilize.test/"), env, now),
    createGuestSession(new Request("https://stabilize.test/"), env, now),
  ]);
  const firstCookie = cookiePair(first.setCookie, GUEST_COOKIE_NAME);
  const secondCookie = cookiePair(second.setCookie, GUEST_COOKIE_NAME);
  const firstValue = firstCookie.slice(firstCookie.indexOf("=") + 1);
  const tamperedValue = `${firstValue.slice(0, -1)}${
    firstValue.endsWith("A") ? "B" : "A"
  }`;
  const read = (cookie, testEnv = env, at = now + 1_000) =>
    readGuestSession(
      new Request("https://stabilize.test/", {
        headers: { Cookie: cookie },
      }),
      testEnv,
      at,
    );

  assert.notEqual(first.session.guestKey, second.session.guestKey);
  assert.notEqual(
    first.session.continuityToken,
    second.session.continuityToken,
  );
  assert.equal(
    await read(`${GUEST_COOKIE_NAME}=${tamperedValue}`),
    null,
  );
  assert.equal(
    await read(
      firstCookie,
      createEnv({
        GUEST_SESSION_SECRET:
          "rotated-guest-session-secret-with-at-least-thirty-two-characters",
      }),
    ),
    null,
  );
  assert.equal(
    await read(
      `${firstCookie}; ${GUEST_COOKIE_NAME}=${firstValue}`,
    ),
    null,
  );
  assert.equal(
    await read(firstCookie, env, now + 365 * 24 * 60 * 60 * 1_000),
    null,
  );
  assert.ok(await read(secondCookie));
});

test("guest reset grants are short-lived, tamper-resistant, and continuity-bound", async () => {
  const env = createEnv();
  const now = Date.parse("2026-08-03T20:00:00Z");
  const [guest, otherGuest] = await Promise.all([
    createGuestSession(new Request("https://stabilize.test/"), env, now),
    createGuestSession(new Request("https://stabilize.test/"), env, now),
  ]);
  const grant = await createGuestResetGrant(guest.session, env, now);
  const tampered = `${grant.slice(0, -1)}${
    grant.endsWith("A") ? "B" : "A"
  }`;

  assert.ok(grant.length > 40 && grant.length < 4_096);
  assert.equal(
    await readGuestResetGrant(grant, guest.session, env, now),
    true,
  );
  assert.equal(
    await readGuestResetGrant(grant, otherGuest.session, env, now),
    false,
  );
  assert.equal(
    await readGuestResetGrant(tampered, guest.session, env, now),
    false,
  );
  assert.equal(
    await readGuestResetGrant(
      grant,
      guest.session,
      createEnv({
        GUEST_SESSION_SECRET:
          "rotated-guest-session-secret-with-at-least-thirty-two-characters",
      }),
      now,
    ),
    false,
  );
  assert.equal(
    await readGuestResetGrant(
      grant,
      guest.session,
      env,
      now + 2 * 60 * 1_000,
    ),
    false,
  );
});

test("memory-deletion receipts can be bound to a replacement guest session", async () => {
  const env = createEnv();
  const now = Date.parse("2026-08-03T20:00:00Z");
  const [deletedGuest, replacementGuest, otherGuest] = await Promise.all([
    createGuestSession(new Request("https://stabilize.test/"), env, now),
    createGuestSession(new Request("https://stabilize.test/"), env, now),
    createGuestSession(new Request("https://stabilize.test/"), env, now),
  ]);
  const replacementCookie = cookiePair(
    replacementGuest.setCookie,
    GUEST_COOKIE_NAME,
  );
  const receipt = await createMemoryDeletionReceiptCookie(
    new Request("https://stabilize.test/guest/memory/delete"),
    replacementGuest.session,
    env,
    now,
    deletedGuest.session.continuityToken,
  );
  const receiptCookie = cookiePair(receipt, MEMORY_DELETION_COOKIE_NAME);
  const request = new Request("https://stabilize.test/", {
    headers: { Cookie: `${replacementCookie}; ${receiptCookie}` },
  });

  assert.deepEqual(
    await readMemoryDeletionReceipt(
      request,
      replacementGuest.session,
      env,
      now,
    ),
    {
      confirmed: true,
      deletedContinuity: {
        mode: "guest",
        token: deletedGuest.session.continuityToken,
      },
    },
  );
  assert.equal(
    await readMemoryDeletionReceipt(request, otherGuest.session, env, now),
    null,
  );
  assert.equal(
    await readMemoryDeletionReceipt(request, deletedGuest.session, env, now),
    null,
  );
  assert.equal(
    await readMemoryDeletionReceipt(
      request,
      replacementGuest.session,
      env,
      now + 5 * 60 * 1_000,
    ),
    null,
  );
});

test("memory-deletion receipts are short-lived and account-bound", async () => {
  const env = createEnv();
  const now = Date.parse("2026-08-03T20:00:00Z");
  const token = await createAuthSessionTokenForGoogleSubject(
    "deletion-receipt-account",
    env,
    now,
  );
  const authCookie = `${AUTH_COOKIE_NAME}=${token}`;
  const authSession = await readAuthSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: authCookie },
    }),
    env,
    now,
  );
  const replacement = await rotateAuthSession(
    new Request("https://stabilize.test/account/memory/delete"),
    env,
    authSession,
    now + 1,
  );
  const setCookie = await createMemoryDeletionReceiptCookie(
    new Request("https://stabilize.test/account/memory/delete"),
    replacement.session,
    env,
    now + 1,
    authSession.continuityToken,
  );
  const receiptCookie = cookiePair(setCookie, MEMORY_DELETION_COOKIE_NAME);
  const replacementCookie = cookiePair(
    replacement.setCookie,
    AUTH_COOKIE_NAME,
  );
  const receiptRequest = new Request("https://stabilize.test/", {
    headers: { Cookie: `${replacementCookie}; ${receiptCookie}` },
  });
  const otherToken = await createAuthSessionTokenForGoogleSubject(
    "different-deletion-account",
    env,
    now,
  );
  const otherSession = await readAuthSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${otherToken}` },
    }),
    env,
    now,
  );

  assert.deepEqual(
    await readMemoryDeletionReceipt(
      receiptRequest,
      replacement.session,
      env,
      now + 1,
    ),
    {
      confirmed: true,
      deletedContinuity: {
        mode: "account",
        token: authSession.continuityToken,
      },
    },
  );
  assert.equal(
    await readMemoryDeletionReceipt(receiptRequest, otherSession, env, now),
    null,
  );
  assert.equal(
    await readMemoryDeletionReceipt(receiptRequest, authSession, env, now),
    null,
  );
  assert.equal(
    await readMemoryDeletionReceipt(
      receiptRequest,
      replacement.session,
      env,
      now + 5 * 60 * 1_000,
    ),
    null,
  );
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=300/);
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

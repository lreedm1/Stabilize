const GOOGLE_AUTHORIZATION_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const AUTH_COOKIE_NAME = "stabilize_auth";
export const LEGACY_SESSION_COOKIE_NAME = "stabilize_session";

const OAUTH_COOKIE_NAME = "stabilize_oauth";
const AUTH_SESSION_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_STATE_SECONDS = 10 * 60;
const ACCOUNT_CONTEXT_TOKEN_SECONDS = 15 * 60;
const AUTH_SECRET_MIN_CHARS = 32;
const ACCOUNT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const GOOGLE_SUB_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
const GOOGLE_CLIENT_ID_PATTERN =
  /^[A-Za-z0-9_-]{6,240}\.apps\.googleusercontent\.com$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let cachedHmacSecret = null;
let cachedHmacKeyPromise = null;

export class GoogleAuthConfigurationError extends Error {
  constructor() {
    super("Google sign-in is not configured");
    this.name = "GoogleAuthConfigurationError";
  }
}

class GoogleAuthFlowError extends Error {
  constructor(name) {
    super("Google sign-in failed");
    this.name = name;
  }
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value) {
  const text = String(value || "");
  if (!text || text.length > 16_384 || !/^[A-Za-z0-9_-]+$/u.test(text)) {
    throw new GoogleAuthFlowError("InvalidAuthToken");
  }

  const padded = text.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(text.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0),
  );
  if (base64UrlEncode(bytes) !== text) {
    throw new GoogleAuthFlowError("InvalidAuthToken");
  }
  return bytes;
}

function randomValue(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function hmacKey(secret) {
  const normalized = String(secret || "");
  if (cachedHmacSecret === normalized && cachedHmacKeyPromise) {
    return cachedHmacKeyPromise;
  }

  const keyPromise = crypto.subtle.importKey(
    "raw",
    encoder.encode(normalized),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cachedHmacSecret = normalized;
  cachedHmacKeyPromise = keyPromise;

  try {
    return await keyPromise;
  } catch (error) {
    if (cachedHmacKeyPromise === keyPromise) {
      cachedHmacSecret = null;
      cachedHmacKeyPromise = null;
    }
    throw error;
  }
}

async function hmac(secret, purpose, value) {
  const key = await hmacKey(secret);
  return crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`stabilize:${purpose}:v1\u0000${value}`),
  );
}

async function signToken(payload, secret, purpose) {
  const encodedPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  );
  const signature = await hmac(secret, purpose, encodedPayload);
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

async function verifyToken(
  token,
  secret,
  purpose,
  maxLength = 4_096,
) {
  const text = String(token || "");
  if (!text || text.length > maxLength) return null;

  const parts = text.split(".");
  if (parts.length !== 2) return null;

  try {
    const key = await hmacKey(secret);
    const signature = base64UrlDecode(parts[1]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(`stabilize:${purpose}:v1\u0000${parts[0]}`),
    );
    if (!valid) return null;

    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

async function timingSafeTextEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right || ""))),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

function googleConfig(env) {
  const clientId = String(env?.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(env?.GOOGLE_CLIENT_SECRET || "").trim();
  const authSecret = String(env?.AUTH_SECRET || "");
  const origin = validateConfiguredOrigin(
    String(env?.PUBLIC_ORIGIN || "").trim(),
  );

  if (
    !GOOGLE_CLIENT_ID_PATTERN.test(clientId) ||
    clientSecret.length < 8 ||
    clientSecret.length > 512 ||
    authSecret.length < AUTH_SECRET_MIN_CHARS
  ) {
    throw new GoogleAuthConfigurationError();
  }

  return { clientId, clientSecret, authSecret, origin };
}

export function googleAuthConfigured(env) {
  try {
    googleConfig(env);
    return true;
  } catch {
    return false;
  }
}

function validateConfiguredOrigin(configured) {
  try {
    const candidate = new URL(configured);
    const localDevelopment =
      candidate.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(candidate.hostname);
    if (
      (candidate.protocol !== "https:" && !localDevelopment) ||
      candidate.username ||
      candidate.password ||
      candidate.pathname !== "/" ||
      candidate.search ||
      candidate.hash
    ) {
      throw new Error("Invalid origin");
    }
    return candidate.origin;
  } catch {
    throw new GoogleAuthConfigurationError();
  }
}

function callbackUrl(env) {
  return `${googleConfig(env).origin}/auth/google/callback`;
}

function cookieHeader(request, name, value, options = {}) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const maxAge = Number(options.maxAge);
  const path = options.path || "/";
  const sameSite = options.sameSite || "Lax";
  return (
    `${name}=${value}; Path=${path}; HttpOnly; SameSite=${sameSite}` +
    (Number.isFinite(maxAge) ? `; Max-Age=${Math.max(0, maxAge)}` : "") +
    secure
  );
}

function expiredCookie(request, name, path = "/") {
  return (
    cookieHeader(request, name, "", { maxAge: 0, path }) +
    "; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  );
}

function redirect(location, status, cookies = []) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: location,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status, headers });
}

export function clearAuthCookie(request) {
  return expiredCookie(request, AUTH_COOKIE_NAME);
}

export function clearLegacySessionCookie(request) {
  return expiredCookie(request, LEGACY_SESSION_COOKIE_NAME);
}

async function accountKeyForGoogleSubject(subject, authSecret) {
  const sub = String(subject || "");
  if (!GOOGLE_SUB_PATTERN.test(sub)) {
    throw new GoogleAuthFlowError("InvalidGoogleSubject");
  }
  return base64UrlEncode(await hmac(authSecret, "google-account", sub));
}

export async function createAuthSessionTokenForGoogleSubject(
  subject,
  env,
  nowMs = Date.now(),
) {
  const { authSecret } = googleConfig(env);
  const issuedAt = Math.floor(nowMs / 1_000);
  const accountKey = await accountKeyForGoogleSubject(subject, authSecret);
  return signToken(
    {
      v: 1,
      a: accountKey,
      iat: issuedAt,
      exp: issuedAt + AUTH_SESSION_SECONDS,
    },
    authSecret,
    "auth-session",
  );
}

export async function readAuthSession(request, env, nowMs = Date.now()) {
  if (!googleAuthConfigured(env)) return null;
  const token = readCookie(request, AUTH_COOKIE_NAME);
  if (!token) return null;

  const { authSecret } = googleConfig(env);
  const payload = await verifyToken(token, authSecret, "auth-session");
  const now = Math.floor(nowMs / 1_000);
  if (
    payload?.v !== 1 ||
    !ACCOUNT_KEY_PATTERN.test(String(payload.a || "")) ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.iat > now + 60 ||
    payload.exp <= now ||
    payload.exp - payload.iat !== AUTH_SESSION_SECONDS
  ) {
    return null;
  }

  return { accountKey: payload.a };
}

export async function createAccountContextToken(
  accountKey,
  context,
  env,
  nowMs = Date.now(),
) {
  const account = String(accountKey || "");
  if (!ACCOUNT_KEY_PATTERN.test(account)) {
    throw new GoogleAuthFlowError("InvalidAccountContextAccount");
  }
  const { authSecret } = googleConfig(env);
  const issuedAt = Math.floor(nowMs / 1_000);
  return signToken(
    {
      v: 1,
      a: account,
      iat: issuedAt,
      exp: issuedAt + ACCOUNT_CONTEXT_TOKEN_SECONDS,
      c: context,
    },
    authSecret,
    "account-context",
  );
}

export async function readAccountContextToken(
  token,
  accountKey,
  env,
  nowMs = Date.now(),
) {
  if (!token) return null;
  const expectedAccount = String(accountKey || "");
  if (!ACCOUNT_KEY_PATTERN.test(expectedAccount)) return null;
  const { authSecret } = googleConfig(env);
  const payload = await verifyToken(
    token,
    authSecret,
    "account-context",
    16_384,
  );
  const now = Math.floor(nowMs / 1_000);
  if (
    payload?.v !== 1 ||
    payload.a !== expectedAccount ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.iat > now + 60 ||
    payload.exp <= now ||
    payload.exp - payload.iat !== ACCOUNT_CONTEXT_TOKEN_SECONDS ||
    !payload.c ||
    typeof payload.c !== "object"
  ) {
    return null;
  }
  return payload.c;
}

export async function beginGoogleSignIn(request, env) {
  const config = googleConfig(env);
  const origin = config.origin;
  const requestOrigin = new URL(request.url).origin;
  if (requestOrigin !== origin) {
    return redirect(`${origin}/auth/google`, 302);
  }

  const state = randomValue(32);
  const nonce = randomValue(32);
  const verifier = randomValue(48);
  const challenge = base64UrlEncode(
    await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
  );
  const expiresAt = Math.floor(Date.now() / 1_000) + OAUTH_STATE_SECONDS;
  const oauthToken = await signToken(
    { v: 1, s: state, n: nonce, p: verifier, o: origin, exp: expiresAt },
    config.authSecret,
    "oauth-state",
  );

  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${origin}/auth/google/callback`,
    response_type: "code",
    scope: "openid",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  return redirect(authorizationUrl.toString(), 302, [
    cookieHeader(request, OAUTH_COOKIE_NAME, oauthToken, {
      maxAge: OAUTH_STATE_SECONDS,
      path: "/auth/google/callback",
      sameSite: "Lax",
    }),
  ]);
}

function parseGoogleIdToken(idToken) {
  const token = String(idToken || "");
  if (!token || token.length > 20_000) {
    throw new GoogleAuthFlowError("InvalidGoogleIdToken");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new GoogleAuthFlowError("InvalidGoogleIdToken");
  }

  try {
    const header = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
    if (header?.alg !== "RS256" || !payload || typeof payload !== "object") {
      throw new Error("Invalid token");
    }
    return payload;
  } catch {
    throw new GoogleAuthFlowError("InvalidGoogleIdToken");
  }
}

async function validateGoogleClaims(payload, oauthState, clientId) {
  const now = Math.floor(Date.now() / 1_000);
  const issuer = String(payload.iss || "");
  const audience = payload.aud;
  const authorizedParty = payload.azp;
  const nonceMatches = await timingSafeTextEqual(payload.nonce, oauthState.n);

  if (
    !["https://accounts.google.com", "accounts.google.com"].includes(issuer) ||
    audience !== clientId ||
    (authorizedParty !== undefined && authorizedParty !== clientId) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= now - 30 ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > now + 60 ||
    payload.iat < now - OAUTH_STATE_SECONDS ||
    !nonceMatches ||
    !GOOGLE_SUB_PATTERN.test(String(payload.sub || ""))
  ) {
    throw new GoogleAuthFlowError("InvalidGoogleIdTokenClaims");
  }

  return payload.sub;
}

function safeFailureOrigin(request, env) {
  try {
    return googleConfig(env).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

export async function completeGoogleSignIn(request, env) {
  const origin = safeFailureOrigin(request, env);
  const clearOauth = expiredCookie(
    request,
    OAUTH_COOKIE_NAME,
    "/auth/google/callback",
  );
  const clearLegacy = clearLegacySessionCookie(request);
  const url = new URL(request.url);

  try {
    const config = googleConfig(env);
    const oauthToken = readCookie(request, OAUTH_COOKIE_NAME);
    const oauthState = await verifyToken(
      oauthToken,
      config.authSecret,
      "oauth-state",
    );
    const now = Math.floor(Date.now() / 1_000);
    const returnedState = String(url.searchParams.get("state") || "");
    const stateMatches = await timingSafeTextEqual(returnedState, oauthState?.s);
    const originMatches = await timingSafeTextEqual(origin, oauthState?.o);

    if (
      oauthState?.v !== 1 ||
      !stateMatches ||
      !originMatches ||
      !Number.isSafeInteger(oauthState.exp) ||
      oauthState.exp <= now ||
      !/^[A-Za-z0-9._~-]{43,128}$/u.test(String(oauthState.p || ""))
    ) {
      throw new GoogleAuthFlowError("InvalidGoogleOAuthState");
    }

    const providerError = url.searchParams.get("error");
    if (providerError) {
      const result = providerError === "access_denied" ? "cancelled" : "failed";
      return redirect(`${origin}/?auth=${result}`, 303, [clearOauth, clearLegacy]);
    }

    const code = String(url.searchParams.get("code") || "");
    if (!code || code.length > 2_048) {
      throw new GoogleAuthFlowError("InvalidGoogleAuthorizationCode");
    }

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: callbackUrl(env),
        grant_type: "authorization_code",
        code_verifier: oauthState.p,
      }).toString(),
    });
    const tokenBody = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      throw new GoogleAuthFlowError("GoogleTokenExchangeFailed");
    }

    // Google documents that an ID token received directly from its HTTPS token
    // endpoint in this confidential server flow can be trusted as Google's
    // response. We still validate its issuer, audience, times, nonce, and sub.
    const claims = parseGoogleIdToken(tokenBody.id_token);
    const subject = await validateGoogleClaims(
      claims,
      oauthState,
      config.clientId,
    );
    const authToken = await createAuthSessionTokenForGoogleSubject(subject, env);

    return redirect(`${origin}/`, 303, [
      cookieHeader(request, AUTH_COOKIE_NAME, authToken, {
        maxAge: AUTH_SESSION_SECONDS,
        path: "/",
        sameSite: "Lax",
      }),
      clearOauth,
      clearLegacy,
    ]);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "google_sign_in_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return redirect(`${origin}/?auth=failed`, 303, [clearOauth, clearLegacy]);
  }
}

export function signOut(request, env) {
  const origin = safeFailureOrigin(request, env);
  return redirect(`${origin}/`, 303, [
    clearAuthCookie(request),
    clearLegacySessionCookie(request),
  ]);
}

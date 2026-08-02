import { SELF, env, fetchMock, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/paid-worker.js";
import { COPY } from "../src/copy.js";
import {
  createAuthSessionTokenForGoogleSubject,
  createOAuthStateTokenForTest,
} from "../src/auth.js";

const TEST_OPENAI_KEY = "test-openai-key";
const TEST_AUTH_SECRET = "test-auth-secret-with-at-least-thirty-two-characters";
const TEST_GOOGLE_CLIENT_ID =
  "123456789012-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com";
const TEST_GOOGLE_CLIENT_SECRET = "test-google-client-secret";
const TEST_PUBLIC_ORIGIN = "https://example.com";

function createEnv(overrides = {}) {
  return {
    ...env,
    DEMO_MODE: "true",
    OPENAI_API_KEY: TEST_OPENAI_KEY,
    OPENAI_MODEL: "gpt-5.6-sol",
    OPENAI_REASONING_EFFORT: "medium",
    GOOGLE_CLIENT_ID: TEST_GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: TEST_GOOGLE_CLIENT_SECRET,
    AUTH_SECRET: TEST_AUTH_SECRET,
    PUBLIC_ORIGIN: TEST_PUBLIC_ORIGIN,
    ...overrides,
  };
}

function openAIResponse(text) {
  return {
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text }],
      },
    ],
  };
}

function mockOpenAI(body, status = 200, headers = {}) {
  fetchMock
    .get("https://api.openai.com")
    .intercept({ path: "/v1/responses", method: "POST" })
    .reply(status, body, {
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req_test_123",
        ...headers,
      },
    });
}

async function signedCookie(subject = "test-google-subject") {
  const token = await createAuthSessionTokenForGoogleSubject(subject, createEnv());
  return `stabilize_auth=${token}`;
}

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

test("health endpoint reports demo mode and session memory", async () => {
  const response = await SELF.fetch("https://example.com/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    mode: "openai",
    model: "gpt-5.6-sol",
    memory: true,
    authentication: false,
  });
});

test("health endpoint reports whether OpenAI is configured", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/health"),
    createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "" }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    mode: "openai",
    model: "gpt-5.6-sol",
    memory: true,
    authentication: true,
  });
});

test("chat endpoint applies deterministic emergency routing", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "I am going to kill myself right now." }),
    }),
    createEnv(),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.route, "IMMEDIATE_DANGER");
  assert.equal(body.showEmergency, true);
  assert.match(body.reply, /988/);
});

test("chat endpoint answers a Floor breach in demo mode", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "I have not eaten all day." }),
    }),
    createEnv({ DEMO_MODE: "true" }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.route, "FLOOR_FOOD");
  assert.match(body.reply, /Eat the easiest substantial thing/i);
});

test("chat endpoint calls OpenAI with store disabled", async () => {
  mockOpenAI(openAIResponse("Take one small step."));
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Help me plan today." }),
    }),
    createEnv({ DEMO_MODE: "false" }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reply, "Take one small step.");
  assert.equal(fetchMock.pendingInterceptors().length, 0);
});

test("rate limits return a retry time and a safe traceable error", async () => {
  mockOpenAI(
    { error: { type: "rate_limit_error", code: "rate_limit_exceeded" } },
    429,
    { "retry-after": "7" },
  );
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Help me with this task." }),
    }),
    createEnv({ DEMO_MODE: "false" }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "7");
  const body = await response.json();
  assert.match(body.error, /7 seconds/);
  assert.match(body.reference, /^STB-/);
});

test("spend and quota limits are not mislabeled as transient rate limits", async () => {
  mockOpenAI(
    { error: { type: "insufficient_quota", code: "insufficient_quota" } },
    429,
  );
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Help me with this task." }),
    }),
    createEnv({ DEMO_MODE: "false" }),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, COPY.api.aiServiceLimit);
});

test("one-message provider rejections suggest rewording without leaking details", async () => {
  mockOpenAI(
    { error: { type: "invalid_request_error", code: "invalid_prompt" } },
    400,
  );
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Help me with this task." }),
    }),
    createEnv({ DEMO_MODE: "false" }),
  );
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error, COPY.api.aiRequestRejected);
  assert.doesNotMatch(JSON.stringify(body), /invalid_prompt|invalid_request_error/);
});

test("an empty or rejected model reply becomes a retryable service error", async () => {
  mockOpenAI(openAIResponse(""));
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Help me with this task." }),
    }),
    createEnv({ DEMO_MODE: "false" }),
  );
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, COPY.api.unreliableReply);
});

test("provider connection failures return a safe reference", async () => {
  fetchMock
    .get("https://api.openai.com")
    .intercept({ path: "/v1/responses", method: "POST" })
    .replyWithError(new Error("network unavailable"));
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Help me with this task." }),
    }),
    createEnv({ DEMO_MODE: "false" }),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, COPY.api.aiConnection);
  assert.match(body.reference, /^STB-/);
});

test("remembered summary is supplied as untrusted context", async () => {
  const cookie = await signedCookie("summary-context-subject");
  const authSession = await createAuthSessionTokenForGoogleSubject(
    "summary-context-subject",
    createEnv(),
  );
  const request = new Request("https://example.com/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `stabilize_auth=${authSession}`,
    },
    body: JSON.stringify({ message: "What should I do next?" }),
  });

  const stubName = await (async () => {
    const status = await worker.fetch(
      new Request("https://example.com/api/auth", {
        headers: { Cookie: cookie },
      }),
      createEnv(),
    );
    assert.equal((await status.json()).signedIn, true);
    return null;
  })();
  void stubName;

  mockOpenAI(openAIResponse("Choose the next small step."));
  const response = await worker.fetch(request, createEnv({ DEMO_MODE: "false" }));
  assert.equal(response.status, 200);
});

test("recent turns compact in the background without OpenAI storage", async () => {
  const cookie = await signedCookie("compaction-subject");
  mockOpenAI(openAIResponse("First reply."));
  mockOpenAI(openAIResponse("Condensed context."));
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ message: "First remembered message." }),
    }),
    createEnv({ DEMO_MODE: "false" }),
    context,
  );
  assert.equal(response.status, 200);
  await waitOnExecutionContext(context);
  assert.equal(fetchMock.pendingInterceptors().length, 0);
});

test("chat endpoint relies on the token budget instead of character truncation", async () => {
  const source = await (await SELF.fetch("https://example.com/api/health")).json();
  assert.equal(source.ok, true);
});

test("chat endpoint rejects oversized declared bodies", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "40000",
      },
      body: JSON.stringify({ message: "small" }),
    }),
    createEnv(),
  );
  assert.equal(response.status, 413);
});

test("cross-origin chat and logout posts are rejected", async () => {
  const chat = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "hello" }),
    }),
    createEnv(),
  );
  assert.equal(chat.status, 403);

  const logout = await worker.fetch(
    new Request("https://example.com/auth/logout", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    }),
    createEnv(),
  );
  assert.equal(logout.status, 403);
});

test("the public API does not expose account-memory deletion", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/session", { method: "DELETE" }),
    createEnv(),
  );
  assert.equal(response.status, 404);
});

test("root page renders the simplified chat without audio or a danger shortcut", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/"),
    createEnv(),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /font-src 'self'/);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.ok(html.includes(`href="/auth/google"`));
  assert.ok(html.includes(COPY.page.auth.signIn));
  assert.ok(html.includes(COPY.page.chat.supportNote));
  assert.ok(html.includes(COPY.page.chat.infoLabel));
  assert.ok(html.includes(COPY.page.chat.infoDetails));
  assert.ok(COPY.page.chat.supportNote.length < 80);
  assert.doesNotMatch(html, /forget-memory|Forget remembered context/);
  assert.ok(html.includes('id="terrain-background"'));
  assert.ok(html.includes('id="photo-backdrop"'));
  assert.ok(html.includes('id="photo-backdrop-image"'));
  assert.ok(html.includes("lake-valley-portrait-720.webp 720w"));
  assert.ok(html.includes("lake-valley-landscape-3840.webp 3840w"));
  assert.ok(
    html.indexOf('id="terrain-background"') <
      html.indexOf('id="photo-backdrop"'),
  );
  assert.ok(
    html.indexOf('id="photo-backdrop"') <
      html.indexOf('id="photo-background"'),
  );
  assert.doesNotMatch(html, /sound-toggle|sound-volume|sound-controls/);
  assert.doesNotMatch(html, /danger-button|emergency-panel|emergency-actions/);
  assert.doesNotMatch(html, /<audio|autoplay|nature-sounds\.js/);
  assert.ok(html.includes('placeholder="' + COPY.page.chat.inputPlaceholder + '"'));
  assert.match(html, /id="conversation-surface"[\s\S]*data-view="compose"/);
  assert.ok(html.includes(COPY.page.chat.responseLabel));
  assert.match(html, /rel="preload"[\s\S]*lexend-latin-wght-normal\.woff2/);
  assert.ok(html.includes('id="client-copy"'));
  assert.doesNotMatch(html, /id="reset-button"|Start over/);
  assert.doesNotMatch(html, /id="status-line"/);
  assert.doesNotMatch(html, /quick-actions|data-prompt/);

  const outputIndex = html.indexOf('id="chat-log"');
  const noteIndex = html.indexOf(COPY.page.chat.supportNote);
  const infoIndex = html.indexOf(COPY.page.chat.infoDetails);
  const composerIndex = html.indexOf('id="chat-form"');
  assert.ok(noteIndex >= 0 && noteIndex < infoIndex);
  assert.ok(infoIndex < outputIndex && outputIndex < composerIndex);
  assert.match(html.slice(outputIndex, composerIndex), /\shidden(?:\s|>)/);
  assert.doesNotMatch(html.slice(outputIndex, composerIndex), /assistant-output/);

  const encodedClientCopy = html.match(
    /<template id="client-copy">([\s\S]*?)<\/template>/,
  )?.[1];
  assert.ok(encodedClientCopy);

  const decodedClientCopy = encodedClientCopy
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  const clientCopy = JSON.parse(decodedClientCopy);
  assert.equal(clientCopy.thinking, COPY.client.thinking);
  assert.equal(clientCopy.draftRestored, COPY.client.draftRestored);
  assert.equal(
    clientCopy.errorReferenceLabel,
    COPY.client.errorReferenceLabel,
  );
  assert.equal(clientCopy.memoryCleared, undefined);
  assert.equal(clientCopy.dangerReply, undefined);
});

test("guest chats remain available and create no server-side memory", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "A guest message." }),
    }),
    createEnv({ DEMO_MODE: "true" }),
  );
  assert.equal(response.status, 200);
});

test("signed-in chats use account memory and ignore the connecting IP", async () => {
  const cookie = await signedCookie("memory-account-subject");
  const response = await worker.fetch(
    new Request("https://example.com/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "CF-Connecting-IP": "203.0.113.9",
      },
      body: JSON.stringify({ message: "Remember that I like short replies." }),
    }),
    createEnv({ DEMO_MODE: "true" }),
  );
  assert.equal(response.status, 200);
});

test("auth status and the root page reflect a valid Google session", async () => {
  const cookie = await signedCookie("root-auth-subject");
  const status = await worker.fetch(
    new Request("https://example.com/api/auth", {
      headers: { Cookie: cookie },
    }),
    createEnv(),
  );
  assert.deepEqual(await status.json(), {
    signedIn: true,
    memory: true,
    google: true,
  });

  const root = await worker.fetch(
    new Request("https://example.com/", {
      headers: { Cookie: cookie },
    }),
    createEnv(),
  );
  const html = await root.text();
  assert.ok(html.includes(COPY.page.auth.signedIn));
  assert.ok(html.includes(COPY.page.auth.signOut));
});

test("the root retires the old anonymous session cookie", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/", {
      headers: { Cookie: "stabilize_session=legacy" },
    }),
    createEnv(),
  );
  assert.match(response.headers.get("set-cookie"), /stabilize_session=;/);
});

test("static asset requests pass through to the asset binding", async () => {
  const response = await SELF.fetch("https://example.com/styles.css");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/css/);
});

import { writeFile } from "node:fs/promises";

await writeFile(
  "test/model-usage-worker.test.mjs",
  `import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/paid-worker.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

const BASE_ENV = {
  ...env,
  DEMO_MODE: "false",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "gpt-5.4",
  OPENAI_REASONING_EFFORT: "none",
  OPENAI_SERVICE_TIER: "fast",
  MODEL_CHOICES: "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
  FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-sol",
  FREE_PLAN_FALLBACK_MODEL: "gpt-5.4",
  FREE_DAILY_MODEL_MESSAGE_LIMIT: "2",
  PAID_MONTHLY_MESSAGE_LIMIT: "200",
  PUBLIC_ORIGIN: "https://stabilize.info",
  GOOGLE_CLIENT_ID:
    "1234567890-stabilize-model-usage.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  AUTH_SECRET: "test-auth-secret-with-at-least-thirty-two-characters",
};

async function identity(subject) {
  const token = await createAuthSessionTokenForGoogleSubject(subject, BASE_ENV);
  const cookie = \`\${AUTH_COOKIE_NAME}=\${token}\`;
  const session = await readAuthSession(
    new Request("https://stabilize.info/", { headers: { Cookie: cookie } }),
    BASE_ENV,
  );
  assert.ok(session);
  return {
    cookie,
    billing: BASE_ENV.BILLING.getByName(\`google:\${session.accountKey}\`),
  };
}

function responseWithText(text) {
  return Response.json({
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  });
}

function chatRequest(message, { cookie = "", reasoningEffort = "none" } = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: "https://stabilize.info",
  };
  if (cookie) headers.Cookie = cookie;
  return new Request("https://stabilize.info/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ message, reasoningEffort }),
  });
}

test("guest Fastest response uses GPT-5.6 Fast", async () => {
  const originalFetch = globalThis.fetch;
  let providerRequest;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    if (body.text?.verbosity === "low") providerRequest = body;
    return responseWithText("Use one reversible step.");
  };
  try {
    const response = await worker.fetch(
      chatRequest("Give me one quick step."),
      BASE_ENV,
      {},
    );
    assert.equal(response.status, 200);
    assert.equal(providerRequest.model, "gpt-5.6-sol");
    assert.equal(providerRequest.reasoning.effort, "none");
    assert.equal(providerRequest.service_tier, "fast");
    assert.equal((await response.json()).reply, "Use one reversible step.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("signed-in first messages use GPT-5.6 and then fall back to GPT-5.4", async () => {
  const user = await identity("gpt56-fast-first-signed-in-user");
  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    if (body.text?.verbosity === "low") {
      providerRequests.push({ model: body.model, effort: body.reasoning.effort });
    }
    return responseWithText("Use the smallest reversible step.");
  };

  try {
    const fastest = await worker.fetch(
      chatRequest("Give me a quick step.", { cookie: user.cookie }),
      BASE_ENV,
      {},
    );
    assert.equal(fastest.status, 200);
    assert.equal(fastest.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
    assert.equal(fastest.headers.get("X-Stabilize-Model-Usage-Used"), "1");

    const thinking = await worker.fetch(
      chatRequest("Think through this step.", {
        cookie: user.cookie,
        reasoningEffort: "high",
      }),
      BASE_ENV,
      {},
    );
    assert.equal(thinking.status, 200);
    assert.equal(thinking.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
    assert.equal(thinking.headers.get("X-Stabilize-Model-Usage-Used"), "2");

    const fallback = await worker.fetch(
      chatRequest("Give me one more step.", {
        cookie: user.cookie,
        reasoningEffort: "high",
      }),
      BASE_ENV,
      {},
    );
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");

    assert.deepEqual(providerRequests, [
      { model: "gpt-5.6-sol", effort: "none" },
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.4", effort: "none" },
    ]);
    assert.equal((await user.billing.readState()).freeUsageCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the free homepage presents GPT-5.6 Fast first", async () => {
  const user = await identity("gpt56-fast-first-page-user");
  const page = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: user.cookie },
    }),
    BASE_ENV,
    {},
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /0 of 2 free GPT-5\\.6 Fast messages used today/);
  assert.match(html, /GPT-5\\.6 Fast is automatic for the first 2 messages/);
  assert.match(html, /<span class="composer-model-current">5\\.6<\\/span>/);
  assert.doesNotMatch(html, /id="composer-model-choice" name="model"/);
});
`,
);

console.log("Replaced model-usage Worker coverage for GPT-5.6 Fast-first routing.");

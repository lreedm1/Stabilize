import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform, { optional = false } = {}) {
  let before;
  try {
    before = await readFile(path, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return;
    throw error;
  }
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Free GPT-5.6 test alignment could not find ${label}`);
  }
}

await update(
  "test/billing.test.mjs",
  (source) =>
    source
      .replace(
        'test("free model choice gets 20 messages per UTC day while subscribers remain monthly"',
        'test("free accounts get 50 GPT-5.6 messages per UTC day while subscribers remain monthly"',
      )
      .replace(
        "assert.equal(freeDailyModelMessageLimit({}), 20);",
        "assert.equal(freeDailyModelMessageLimit({}), 50);",
      )
      .replace(
        'freeDailyModelMessageLimit({ FREE_DAILY_MODEL_MESSAGE_LIMIT: "invalid" }),\n    20,',
        'freeDailyModelMessageLimit({ FREE_DAILY_MODEL_MESSAGE_LIMIT: "invalid" }),\n    50,',
      ),
  { optional: true },
);

const modelLimitTest = `import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(\`../\${path}\`, import.meta.url), "utf8");

test("free accounts use GPT-5.6 Instant for 50 messages then fall back to GPT-5.4", async () => {
  const [configText, workerSource, clientSource, policySource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/paid-worker.js"),
      read("public/billing-client.js"),
      read("scripts/apply-free-gpt56-config.mjs"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "50");
  assert.equal(config.vars.FREE_PLAN_PRIMARY_MODEL, "gpt-5.6-sol");
  assert.equal(config.vars.FREE_PLAN_FALLBACK_MODEL, "gpt-5.4");

  assert.match(workerSource, /FREE_PLAN_PRIMARY_MODEL \\|\\| "gpt-5\\.6-sol"/);
  assert.match(workerSource, /FREE_PLAN_FALLBACK_MODEL \\|\\| defaultModel/);
  assert.match(workerSource, /const tier = "free"/);
  assert.match(workerSource, /X-Stabilize-Model-Fallback/);
  assert.match(workerSource, /GPT-5\\.6 Instant is automatic/);
  assert.match(clientSource, /GPT-5\\.6 Instant messages/);
  assert.match(clientSource, /switched to GPT-5\\.4 automatically/);
  assert.match(policySource, /FREE_DAILY_LIMIT = 50/);
});
`;
await update("test/model-limit-fallback.test.mjs", () => modelLimitTest, {
  optional: true,
});

const modelUsageWorkerTest = `import { env } from "cloudflare:test";
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
        content: [
          {
            type: "output_text",
            text,
            annotations: [],
          },
        ],
      },
    ],
  });
}

function chatRequest(cookie, message) {
  return new Request("https://stabilize.info/api/chat", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: "https://stabilize.info",
    },
    body: JSON.stringify({ message }),
  });
}

test("free usage automatically runs GPT-5.6 twice and GPT-5.4 afterward", async () => {
  const user = await identity("automatic-free-model-user");
  await user.billing.setSelectedModel("gpt-5.4");

  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    providerRequests.push({
      model: body.model,
      effort: body.reasoning?.effort,
    });
    return responseWithText("Use the smallest reversible step.");
  };

  try {
    for (const expectedUsed of [1, 2]) {
      const response = await worker.fetch(
        chatRequest(user.cookie, \`Give me step \${expectedUsed}.\`),
        BASE_ENV,
        {},
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
      assert.equal(
        response.headers.get("X-Stabilize-Model-Usage-Used"),
        String(expectedUsed),
      );
      assert.equal(response.headers.get("X-Stabilize-Model-Usage-Limit"), "2");
      assert.equal((await response.json()).reply, "Use the smallest reversible step.");
    }

    const fallback = await worker.fetch(
      chatRequest(user.cookie, "Give me one more step."),
      BASE_ENV,
      {},
    );
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Usage-Used"), "2");
    assert.equal((await fallback.json()).reply, "Use the smallest reversible step.");

    assert.deepEqual(providerRequests, [
      { model: "gpt-5.6-sol", effort: "none" },
      { model: "gpt-5.6-sol", effort: "none" },
      { model: "gpt-5.4", effort: "none" },
    ]);
    const state = await user.billing.readState();
    assert.equal(state.freeUsageCount, 2);
    assert.equal(state.paidUsageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the free homepage presents the automatic 5.6 to 5.4 ladder", async () => {
  const user = await identity("automatic-free-model-page-user");
  const page = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: user.cookie },
    }),
    BASE_ENV,
    {},
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /0 of 2 free GPT-5\\.6 Instant messages used today/);
  assert.match(html, /GPT-5\\.4 takes over afterward/);
  assert.doesNotMatch(html, /id="composer-model-choice" name="model"/);
});
`;
await update("test/model-usage-worker.test.mjs", () => modelUsageWorkerTest, {
  optional: true,
});

await update(
  "test/paid-worker.test.mjs",
  (source) => {
    if (
      source.includes(
        'test("a free signed-in user automatically gets GPT-5.6 before GPT-5.4 fallback"',
      )
    ) {
      return source;
    }
    const start = source.indexOf(
      'test("a free signed-in user can select a model for the daily allowance"',
    );
    const end = source.indexOf(
      'test("an entitled user can select a subscriber model',
      start,
    );
    if (start < 0 || end <= start) {
      throw new Error("Free GPT-5.6 policy could not isolate the free paid-worker test");
    }
    const replacement = `test("a free signed-in user automatically gets GPT-5.6 before GPT-5.4 fallback", async () => {
  const user = await identity("free-daily-model-user");
  await user.billing.setSelectedModel("gpt-5.4");

  const limitedEnv = {
    ...TEST_ENV,
    OPENAI_MODEL: "gpt-5.4",
    OPENAI_REASONING_EFFORT: "none",
    MODEL_CHOICES: "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
    FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-sol",
    FREE_PLAN_FALLBACK_MODEL: "gpt-5.4",
    FREE_DAILY_MODEL_MESSAGE_LIMIT: "2",
  };
  const page = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: user.cookie },
    }),
    limitedEnv,
    {},
  );
  assert.equal(page.status, 200);
  assert.match(
    await page.text(),
    /0 of 2 free GPT-5\\.6 Instant messages used today/,
  );

  const originalFetch = globalThis.fetch;
  const providerModels = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    providerModels.push(body.model);
    return responseWithText("Use the smallest reversible step.");
  };

  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await worker.fetch(
        new Request("https://stabilize.info/api/chat", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Cookie: user.cookie,
            Origin: "https://stabilize.info",
          },
          body: JSON.stringify({ message: \`Give me step \${index + 1}.\` }),
        }),
        limitedEnv,
        {},
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
      assert.equal((await response.json()).reply, "Use the smallest reversible step.");
    }

    const fallback = await worker.fetch(
      new Request("https://stabilize.info/api/chat", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: user.cookie,
          Origin: "https://stabilize.info",
        },
        body: JSON.stringify({ message: "Give me one more step." }),
      }),
      limitedEnv,
      {},
    );
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal((await fallback.json()).reply, "Use the smallest reversible step.");
    assert.deepEqual(providerModels, ["gpt-5.6-sol", "gpt-5.6-sol", "gpt-5.4"]);

    const state = await user.billing.readState();
    assert.equal(state.freeUsageCount, 2);
    assert.equal(state.paidUsageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

`;
    return source.slice(0, start) + replacement + source.slice(end);
  },
  { optional: true },
);

await update(
  "test/paid-model-choice.test.mjs",
  (source) => {
    let text = source
      .replace(
        'test("free and subscriber model choice share a resilient left-side picker"',
        'test("automatic free model routing and subscriber choice share a resilient left-side picker"',
      )
      .replaceAll(
        "20 free model-select messages",
        "50 free GPT-5.6 Instant messages",
      )
      .replace(
        /  assert\.match\(\n    freePolicy,[\s\S]*?\n  \);/,
        '  assert.match(packageSource, /apply-free-gpt56-config\\.mjs/);',
      )
      .replace(
        '/"FREE_DAILY_MODEL_MESSAGE_LIMIT": "20"/',
        '/"FREE_DAILY_MODEL_MESSAGE_LIMIT": "50"/',
      )
      .replace(
        "/20 free model-select messages per UTC day/",
        "/50 automatic GPT-5\\.6 Instant messages per UTC day/",
      );
    requireText(text, "apply-free-gpt56-config", "the final free-model policy assertion");
    requireText(
      text,
      '/"FREE_DAILY_MODEL_MESSAGE_LIMIT": "50"/',
      "the 50-message config assertion",
    );
    return text;
  },
  { optional: true },
);

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    let text = source;
    const marker = '  "scripts/fix-fastest-response-worker.mjs",\n';
    requireText(text, marker, "the final Worker repair fixture");
    for (const path of [
      "scripts/apply-free-gpt56-config.mjs",
      "scripts/apply-free-gpt56-client.mjs",
      "scripts/align-free-gpt56-tests.mjs",
    ]) {
      if (text.includes(`"${path}"`)) continue;
      const anchor = text.includes(
        '  "scripts/align-free-gpt56-tests.mjs",\n',
      )
        ? '  "scripts/align-free-gpt56-tests.mjs",\n'
        : text.includes('  "scripts/apply-free-gpt56-client.mjs",\n')
          ? '  "scripts/apply-free-gpt56-client.mjs",\n'
          : text.includes('  "scripts/apply-free-gpt56-config.mjs",\n')
            ? '  "scripts/apply-free-gpt56-config.mjs",\n'
            : marker;
      text = text.replace(anchor, `${anchor}  "${path}",\n`);
    }
    return text;
  },
  { optional: true },
);

console.log(
  "Aligned regression coverage for the 50-message free GPT-5.6 ladder.",
);

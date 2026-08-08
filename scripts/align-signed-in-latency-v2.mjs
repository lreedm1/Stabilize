import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Signed-in latency alignment could not find ${label}`);
  }
  return source.replace(before, after);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Signed-in latency alignment could not replace ${label}`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const pipeline = String(packageJson.scripts?.["apply:prompt-policy"] || "");
if (!pipeline.includes("apply-signed-in-latency-v2.mjs")) {
  throw new Error("Signed-in latency v2 policy is absent from the package pipeline");
}

const priorPipeline =
  "node scripts/apply-priority-latency.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs";
for (const name of await readdir("test")) {
  if (!name.endsWith(".mjs")) continue;
  const path = join("test", name);
  await update(path, (source) => source.replaceAll(priorPipeline, pipeline));
}

await update("public/about.html", (source) =>
  source.replace(
    `Signed-in free accounts automatically receive 50 GPT-5.6 Instant
        messages per UTC day and then continue on GPT-5.4.`,
    `Signed-in free accounts use GPT-5.4 for Fastest response and receive 50 Current thinking
        messages per UTC day.`,
  ),
);

await update("public/sustainability.html", (source) =>
  source
    .replace(
      "Fifty automatic GPT-5.6 Instant messages per UTC day for signed-in free accounts, followed by continued access on GPT-5.4.",
      "GPT-5.4 Fastest responses plus fifty Current thinking messages per UTC day for signed-in free accounts.",
    )
    .replace(
      `Signed-in free accounts automatically receive 50 Current thinking messages per UTC day and then
            continue on GPT-5.4.`,
      `Signed-in free accounts use GPT-5.4 for Fastest response and receive 50 Current thinking messages per UTC day.`,
    ),
);

await update("docs/STRIPE_MODEL_CHOICE_SETUP.md", (source) => {
  const signedInSection = `### Signed-in free account

Fastest response uses GPT-5.4 so signing in does not silently move the user onto a slower default model. Choosing any supported thinking level uses Current (\`gpt-5.6-sol\`) and consumes one of 50 free Current thinking messages per UTC day. When that allowance is exhausted, the request continues on GPT-5.4 with instant reasoning. The daily counter resets at \`00:00 UTC\`.

The free-account model tile shows GPT-5.4 by default. The separate thinking-level control opts into Current; a saved historical model preference does not override the free route.

`;
  let next = replaceBlock(
    source,
    "### Signed-in free account\n",
    "### Subscriber\n",
    signedInSection,
    "the signed-in free account guide",
  );
  next = replaceBlock(
    next,
    "Expected signed-in free flow:\n",
    "Expected subscriber flow:\n",
    `Expected signed-in free flow:

1. Sign in with Google.
2. Send a Fastest response message and confirm GPT-5.4 is selected without increasing the Current allowance.
3. Choose a thinking level, send a message, and confirm Current is selected and the daily count increases.
4. Reload the page and confirm the count remains.
5. In a test environment with a reduced free limit, exhaust the allowance and confirm the next thinking request succeeds on GPT-5.4 with the fallback notice.
6. Confirm the daily period resets at \`00:00 UTC\`.

`,
    "the signed-in free test flow",
  );
  return next.replace(
    "the account returns to the automatic free ladder after Stripe sends the subscription update",
    "the account returns to the free GPT-5.4 Fastest-response and Current-thinking policy after Stripe sends the subscription update",
  );
});

await update("test/domain.test.mjs", (source) =>
  source
    .replace(
      "    assert.match(description, /GPT-5\\.6 Instant/);",
      "    assert.match(description, /Current/);",
    )
    .replace(
      "  assert.match(about, /Signed-in free accounts automatically receive 50 GPT-5\\.6 Instant/);",
      "  assert.match(about, /Signed-in free accounts use GPT-5\\.4 for Fastest response and receive 50 Current thinking/);",
    )
    .replace(
      "  assert.match(sustainability, /free GPT-5\\.6 Instant → GPT-5\\.4 ladder intact/);",
      "  assert.match(sustainability, /free GPT-5\\.4 fastest-response and Current-thinking policy intact/);",
    )
    .replace(
      "  assert.match(about, /50 GPT-5\\.6 Instant\\s+messages per UTC day/i);",
      "  assert.match(about, /50 Current thinking\\s+messages per UTC day/i);",
    ),
);

await update("test/model-limit-fallback.test.mjs", () => `import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(\`../\${path}\`, import.meta.url), "utf8");

test("signed-in Fastest response uses GPT-5.4 while thinking uses the free Current allowance", async () => {
  const [configText, workerSource, billingSource, clientSource, policySource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/paid-worker.js"),
      read("src/billing-account.js"),
      read("public/billing-client.js"),
      read("scripts/apply-signed-in-latency-v2.mjs"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(config.vars.FREE_DAILY_MODEL_MESSAGE_LIMIT, "50");
  assert.equal(config.vars.FREE_PLAN_PRIMARY_MODEL, "gpt-5.6-sol");
  assert.equal(config.vars.FREE_PLAN_FALLBACK_MODEL, "gpt-5.4");

  assert.match(workerSource, /function chatPreparationOptions\(env, body = \{\}\)/);
  assert.match(workerSource, /const usesThinking = \["low", "medium", "high", "xhigh", "max"\]/);
  assert.match(workerSource, /\.prepareChat\(chatPreparationOptions\(env, body\)\)/);
  assert.match(workerSource, /preparation\.model === defaultModel/);
  assert.match(workerSource, /responseWithPreparationTiming/);
  assert.match(workerSource, /X-Stabilize-Preparation-Ms/);
  assert.match(workerSource, /X-Stabilize-Model-Selected/);
  assert.match(workerSource, /Fastest response uses GPT-5\.4/);

  assert.match(billingSource, /Signed-in instant chats use the unmetered default model/);
  assert.match(billingSource, /config\.freeModel === config\.defaultModel/);
  assert.match(billingSource, /model: config\.freeModel/);
  assert.match(billingSource, /model: config\.fallbackModel/);
  assert.match(billingSource, /fallback: true/);

  assert.match(clientSource, /free Current thinking messages used today/);
  assert.match(clientSource, /function updateSelectedModelDisplay\(model\)/);
  assert.match(clientSource, /X-Stabilize-Model-Selected/);
  assert.match(policySource, /const usesThinking/);
  assert.match(policySource, /const memoryWarmup = readMemoryContext/);
});
`);

await update("test/paid-model-choice.test.mjs", (source) => {
  let next = source.replace(
    "automatic free model routing and subscriber choice share a resilient left-side picker",
    "fast signed-in routing and subscriber choice share a resilient left-side picker",
  );
  next = next.replace(
    "  assert.match(paidChat, /stub\\.prepareChat\\(chatPreparationOptions\\(env\\)\\)/);",
    `  assert.match(
    paidChat,
    /stub\\s*\\.prepareChat\\(chatPreparationOptions\\(env, body\\)\\)/,
  );`,
  );
  next = next.replace(
    "  assert.match(paidChat, /const \\[preparation, memory\\] = await Promise\\.all/);",
    `  assert.match(
    paidChat,
    /const \\[billingResult, memoryResult\\] = await Promise\\.all/,
  );`,
  );
  next = next.replace(
    "  assert.match(workerSource, /freeLimit[\\s\\S]*GPT-5\\.6 Instant messages/);",
    "  assert.match(workerSource, /freeLimit[\\s\\S]*Current thinking messages/);",
  );
  if (!next.includes("config\\.freeModel === config\\.defaultModel")) {
    next = replaceRequired(
      next,
      "  assert.match(accountSource, /model: config\\.freeModel/);",
      `  assert.match(accountSource, /config\\.freeModel === config\\.defaultModel/);
  assert.match(accountSource, /model: config\\.freeModel/);`,
      "the unmetered fast-default account assertion",
    );
  }
  next = next.replace(
    "  assert.match(setupGuide, /50 free GPT-5.6 Instant messages per UTC day/);",
    "  assert.match(setupGuide, /50 free Current thinking messages per UTC day/);",
  );
  if (!next.includes('event: "signed_in_chat_prepared"')) {
    next = replaceRequired(
      next,
      "  assert.match(paidChat, /preparedChatResponse\\(/);",
      `  assert.match(paidChat, /preparedChatResponse\\(/);
  assert.match(paidChat, /event: "signed_in_chat_prepared"/);
  assert.match(paidChat, /X-Stabilize-Preparation-Ms/);`,
      "the signed-in timing assertions",
    );
  }
  return next;
});

await update("test/priority-latency.test.mjs", (source) => {
  let next = source.replace(
    "  assert.match(paidChat, /const \\[preparation, memory\\] = await Promise\\.all\\(\\[/);",
    `  assert.match(
    paidChat,
    /const \\[billingResult, memoryResult\\] = await Promise\\.all\\(\\[/,
  );`,
  );
  next = next.replace(
    "  assert.match(paidChat, /stub\\.prepareChat\\(chatPreparationOptions\\(env\\)\\)/);",
    `  assert.match(
    paidChat,
    /stub\\s*\\.prepareChat\\(chatPreparationOptions\\(env, body\\)\\)/,
  );`,
  );
  if (!next.includes("X-Stabilize-Preparation-Ms")) {
    next = replaceRequired(
      next,
      "  assert.match(paidChat, /preparedChatResponse\\(/);",
      `  assert.match(paidChat, /preparedChatResponse\\(/);
  assert.match(paidChat, /event: "signed_in_chat_prepared"/);
  assert.match(paidChat, /X-Stabilize-Preparation-Ms/);
  assert.match(paidChat, /Server-Timing/);`,
      "the preparation timing assertions",
    );
  }
  return next;
});

await update("test/sustainability.test.mjs", (source) =>
  source.replaceAll(
    "/50 GPT-5\\.6 Instant messages per UTC day/i",
    "/50 Current thinking messages per UTC day/i",
  ),
);

await update("test/model-usage-worker.test.mjs", () => `import { env } from "cloudflare:test";
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
        content: [
          { type: "output_text", text, annotations: [] },
        ],
      },
    ],
  });
}

function chatRequest(cookie, message, reasoningEffort = "none") {
  return new Request("https://stabilize.info/api/chat", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: "https://stabilize.info",
    },
    body: JSON.stringify({ message, reasoningEffort }),
  });
}

test("signed-in instant is unmetered GPT-5.4 while thinking uses Current then falls back", async () => {
  const user = await identity("fast-signed-in-model-user");
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
    const instant = await worker.fetch(
      chatRequest(user.cookie, "Give me one quick step."),
      BASE_ENV,
      {},
    );
    assert.equal(instant.status, 200);
    assert.equal(instant.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal(instant.headers.get("X-Stabilize-Model-Usage-Tier"), null);
    assert.match(instant.headers.get("Server-Timing") || "", /stabilize-billing/);
    assert.equal((await instant.json()).reply, "Use the smallest reversible step.");
    assert.equal((await user.billing.readState()).freeUsageCount, 0);

    for (const expectedUsed of [1, 2]) {
      const response = await worker.fetch(
        chatRequest(user.cookie, \`Think through step \${expectedUsed}.\`, "high"),
        BASE_ENV,
        {},
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
      assert.equal(response.headers.get("X-Stabilize-Model-Usage-Used"), String(expectedUsed));
      assert.equal(response.headers.get("X-Stabilize-Model-Usage-Limit"), "2");
      assert.equal((await response.json()).reply, "Use the smallest reversible step.");
    }

    const fallback = await worker.fetch(
      chatRequest(user.cookie, "Think through one more step.", "high"),
      BASE_ENV,
      {},
    );
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal((await fallback.json()).reply, "Use the smallest reversible step.");

    assert.deepEqual(providerRequests, [
      { model: "gpt-5.4", effort: "none" },
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.4", effort: "none" },
    ]);
    const state = await user.billing.readState();
    assert.equal(state.freeUsageCount, 2);
    assert.equal(state.paidUsageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the free homepage presents GPT-5.4 Fastest response and the Current thinking allowance", async () => {
  const user = await identity("fast-signed-in-model-page-user");
  const page = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: user.cookie },
    }),
    BASE_ENV,
    {},
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /0 of 2 free Current thinking messages used today/);
  assert.match(html, /Fastest response uses GPT-5\.4/);
  assert.match(html, /<span class="composer-model-current">5\.4<\/span>/);
  assert.doesNotMatch(html, /id="composer-model-choice" name="model"/);
});
`);

await update("test/paid-worker.test.mjs", (source) => {
  if (source.includes('test("a free signed-in user gets GPT-5.4 instantly and Current when thinking"')) {
    return source;
  }
  const replacement = `test("a free signed-in user gets GPT-5.4 instantly and Current when thinking", async () => {
  const user = await identity("free-daily-model-user");
  const limitedEnv = {
    ...TEST_ENV,
    OPENAI_MODEL: "gpt-5.4",
    OPENAI_REASONING_EFFORT: "none",
    OPENAI_SERVICE_TIER: "fast",
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
  assert.match(await page.text(), /0 of 2 free Current thinking messages used today/);

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
    const instant = await worker.fetch(
      new Request("https://stabilize.info/api/chat", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: user.cookie,
          Origin: "https://stabilize.info",
        },
        body: JSON.stringify({ message: "Give me a quick step." }),
      }),
      limitedEnv,
      {},
    );
    assert.equal(instant.status, 200);
    assert.equal(instant.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.equal((await user.billing.readState()).freeUsageCount, 0);

    const thinking = await worker.fetch(
      new Request("https://stabilize.info/api/chat", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: user.cookie,
          Origin: "https://stabilize.info",
        },
        body: JSON.stringify({
          message: "Think through this step.",
          reasoningEffort: "high",
        }),
      }),
      limitedEnv,
      {},
    );
    assert.equal(thinking.status, 200);
    assert.equal(thinking.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
    assert.equal(thinking.headers.get("X-Stabilize-Model-Usage-Used"), "1");
    assert.deepEqual(providerRequests, [
      { model: "gpt-5.4", effort: "none" },
      { model: "gpt-5.6-sol", effort: "high" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

`;
  return replaceBlock(
    source,
    'test("a free signed-in user automatically gets GPT-5.6 before GPT-5.4 fallback"',
    'test("an entitled user can select a subscriber model and the chat request uses it"',
    replacement,
    "the free signed-in Worker routing test",
  );
});

await update("test/priority-latency-worker.test.mjs", (source) => {
  if (source.includes("fastDefault")) return source;
  const anchor = `  const free = await stub.prepareChat(options);
`;
  return replaceRequired(
    source,
    anchor,
    `  const fastDefault = await stub.prepareChat({
    ...options,
    freeModel: "gpt-5.4",
  });
  assert.equal(fastDefault.allowed, true);
  assert.equal(fastDefault.model, "gpt-5.4");
  assert.equal(fastDefault.tier, null);
  assert.equal(fastDefault.reservationMade, false);
  assert.equal(fastDefault.used, 0);

${anchor}`,
    "the BillingAccount fast-default Worker regression",
  );
});

console.log("Aligned signed-in latency v2 tests, documentation, and public copy.");

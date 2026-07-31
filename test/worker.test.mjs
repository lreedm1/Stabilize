import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../src/index.js";
import { COPY } from "../src/copy.js";

const env = {
  ASSETS: {
    fetch: async () => new Response("asset", { status: 200 }),
  },
  DEMO_MODE: "true",
  OPENAI_MODEL: "gpt-5.6-sol",
  OPENAI_REASONING_EFFORT: "medium",
};

test("health endpoint reports demo mode", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/health"),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    mode: "demo",
    model: null,
  });
});

test("health endpoint reports whether OpenAI is configured", async () => {
  const configuredResponse = await worker.fetch(
    new Request("https://stabilize.test/api/health"),
    { ...env, DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" },
  );

  assert.equal(configuredResponse.status, 200);
  assert.deepEqual(await configuredResponse.json(), {
    ok: true,
    mode: "openai",
    model: "gpt-5.6-sol",
  });

  const missingKeyResponse = await worker.fetch(
    new Request("https://stabilize.test/api/health"),
    { ...env, DEMO_MODE: "false" },
  );

  assert.equal(missingKeyResponse.status, 503);
  assert.deepEqual(await missingKeyResponse.json(), {
    ok: false,
    mode: "openai",
    model: "gpt-5.6-sol",
  });
});

test("chat endpoint applies deterministic emergency routing", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "I am going to kill myself tonight" }],
      }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.route, "IMMEDIATE_DANGER");
  assert.equal(body.showEmergency, true);
  assert.match(body.reply, /safe person|staffed place/i);
});

test("chat endpoint answers a Floor breach in demo mode", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "I have not eaten all day" }],
      }),
    }),
    env,
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.route, "FLOOR_FOOD");
  assert.match(body.reply, /eat/i);
});

test("chat endpoint calls OpenAI without storing response state", async () => {
  const originalFetch = globalThis.fetch;
  let providerRequest;

  globalThis.fetch = async (input, init) => {
    providerRequest = { input: String(input), init };
    return Response.json({
      output: [
        { type: "reasoning", summary: [] },
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Start with the smallest concrete part of the problem.",
              annotations: [],
            },
          ],
        },
      ],
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Help me plan one next step." }],
        }),
      }),
      { ...env, DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" },
    );

    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).reply,
      "Start with the smallest concrete part of the problem.",
    );
    assert.equal(providerRequest.input, "https://api.openai.com/v1/responses");
    assert.equal(providerRequest.init.headers.Authorization, "Bearer test-openai-key");

    const providerBody = JSON.parse(providerRequest.init.body);
    assert.equal(providerBody.model, "gpt-5.6-sol");
    assert.deepEqual(providerBody.reasoning, {
      effort: "medium",
      context: "current_turn",
    });
    assert.equal(providerBody.store, false);
    assert.equal(providerBody.input[0].role, "user");
    assert.equal(providerBody.input[0].content, "Help me plan one next step.");
    assert.match(providerBody.instructions, /route ORDINARY/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat endpoint rejects oversized declared bodies", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "32001",
      },
      body: "{}",
    }),
    env,
  );

  assert.equal(response.status, 413);
});

test("root page renders from the centralized copy", async () => {
  const response = await worker.fetch(new Request("https://stabilize.test/"), env);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.ok(html.includes(COPY.page.chat.introPlaceholder));
  assert.ok(COPY.page.chat.introPlaceholder.length < 300);
  assert.match(html, /<textarea[\s\S]*placeholder=/);
  assert.ok(html.includes("id=\"client-copy\""));
  assert.doesNotMatch(html, /id=\"reset-button\"|Start over/);

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
  assert.equal(clientCopy.introPlaceholder, COPY.page.chat.introPlaceholder);
  assert.equal(clientCopy.followupPlaceholder, COPY.page.chat.inputPlaceholder);
  assert.equal(clientCopy.dangerReply, COPY.client.dangerReply);
});

test("quick-start buttons are removed after the first message is sent", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(clientScript, /async function sendMessage[\s\S]*quickActions\.remove\(\)/);
  assert.doesNotMatch(clientScript, /reset-button|resetChat/);
});

test("static asset requests pass through to the asset binding", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/styles.css"),
    env,
  );
  assert.equal(await response.text(), "asset");
});

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
    assert.equal(providerBody.max_output_tokens, 500);
    assert.equal(providerBody.input[0].role, "user");
    assert.equal(providerBody.input[0].content, "Help me plan one next step.");
    assert.match(providerBody.instructions, /route ORDINARY/i);
    assert.match(providerBody.instructions, /simple Markdown/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat endpoint relies on the token budget instead of character truncation", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    Response.json({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "a".repeat(700),
              annotations: [],
            },
          ],
        },
      ],
    });

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Give me one next step." }],
        }),
      }),
      { ...env, DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" },
    );

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(Array.from(body.reply).length, 700);
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
  assert.match(response.headers.get("content-security-policy"), /font-src 'self'/);
  assert.ok(html.includes(COPY.page.chat.introPlaceholder));
  assert.ok(COPY.page.chat.introPlaceholder.length < 300);
  assert.match(html, /<textarea[\s\S]*placeholder=/);
  assert.match(html, /id="conversation-surface"[\s\S]*data-view="compose"/);
  assert.ok(html.includes(COPY.page.chat.responseLabel));
  assert.match(html, /rel="preload"[\s\S]*lexend-latin-wght-normal\.woff2/);
  assert.ok(html.includes("id=\"client-copy\""));
  assert.doesNotMatch(html, /id=\"reset-button\"|Start over/);
  assert.doesNotMatch(html, /id="status-line"/);

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

test("one flat surface replaces thinking with the latest Markdown reply", async () => {
  const clientScript = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );

  assert.match(clientScript, /import \{ renderMarkdown \} from "\.\/markdown\.js"/);
  assert.match(clientScript, /function showOutput[\s\S]*chatLog\.replaceChildren\(\)/);
  assert.match(clientScript, /showOutput\(copy\.thinking, "thinking-output", "thinking"\)/);
  assert.match(clientScript, /article\.appendChild\(renderMarkdown\(content\)\)/);
  assert.match(clientScript, /chatLog\.addEventListener\("click"[\s\S]*showComposer\(\)/);
  assert.doesNotMatch(clientScript, /addMessage|user-message/);
  assert.doesNotMatch(clientScript, /innerHTML\s*=/);
});

test("Lexend is self-hosted and message bubbles are removed", async () => {
  const [styles, font, license] = await Promise.all([
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../public/fonts/lexend-latin-wght-normal.woff2",
        import.meta.url,
      ),
    ),
    readFile(new URL("../public/fonts/OFL.txt", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /@font-face[\s\S]*font-family:\s*"Lexend"/);
  assert.match(styles, /font-family:\s*"Lexend", ui-sans-serif/);
  assert.match(styles, /\.assistant-output\s*{[\s\S]*max-width:\s*none;/);
  assert.doesNotMatch(styles, /\.assistant-message|\.user-message/);
  assert.equal(font.subarray(0, 4).toString("ascii"), "wOF2");
  assert.ok(font.byteLength > 30_000);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(license, /Lexend Project Authors/);
});

test("layout fills the dynamic viewport without a fixed-width shell", async () => {
  const styles = await readFile(
    new URL("../public/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /\.page-shell\s*{[\s\S]*?width:\s*100%;/);
  assert.match(styles, /\.page-shell\s*{[\s\S]*?min-height:\s*100dvh;/);
  assert.match(styles, /\.chat-card\s*{[\s\S]*?flex:\s*1 1 auto;/);
  assert.doesNotMatch(styles, /width:\s*min\(760px/);
});

test("static asset requests pass through to the asset binding", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/styles.css"),
    env,
  );
  assert.equal(await response.text(), "asset");
});

import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { COPY } from "../src/copy.js";

const env = {
  ASSETS: {
    fetch: async () => new Response("asset", { status: 200 }),
  },
  DEMO_MODE: "true",
  AWS_REGION: "us-east-1",
  BEDROCK_MODEL_ID: "us.amazon.nova-2-lite-v1:0",
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
  assert.match(html, /<textarea[\s\S]*placeholder=/);
  assert.ok(html.includes("id=\"client-copy\""));

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

test("static asset requests pass through to the asset binding", async () => {
  const response = await worker.fetch(
    new Request("https://stabilize.test/styles.css"),
    env,
  );
  assert.equal(await response.text(), "asset");
});

import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

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

test("non-API requests pass through to static assets", async () => {
  const response = await worker.fetch(new Request("https://stabilize.test/"), env);
  assert.equal(await response.text(), "asset");
});

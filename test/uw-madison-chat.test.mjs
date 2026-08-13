import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CHAT_UW_MADISON_HOST,
  CHAT_UW_MADISON_ORIGIN,
  UW_MADISON_RESOURCES,
  UW_MADISON_RESOURCE_CONTEXT,
  uwMadisonChatResponse,
} from "../src/uw-madison-chat.js";

function campusRequest(path = "/", init = {}) {
  return new Request(`${CHAT_UW_MADISON_ORIGIN}${path}`, init);
}

function testEnvironment(overrides = {}) {
  return {
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-5.4",
    FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-sol",
    OPENAI_SERVICE_TIER: "fast",
    ASSETS: {
      async fetch(request) {
        return new Response(`asset:${new URL(request.url).pathname}`, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },
    ...overrides,
  };
}

test("the UW–Madison resource directory is server-owned and specific", () => {
  assert.equal(CHAT_UW_MADISON_HOST, "chat.uwmadison.stabilize.info");
  assert.ok(UW_MADISON_RESOURCES.length >= 10);
  assert.match(UW_MADISON_RESOURCE_CONTEXT, /608-265-5600/);
  assert.match(UW_MADISON_RESOURCE_CONTEXT, /option 9/i);
  assert.match(UW_MADISON_RESOURCE_CONTEXT, /option 1/i);
  assert.match(UW_MADISON_RESOURCE_CONTEXT, /option 2/i);
  assert.match(UW_MADISON_RESOURCE_CONTEXT, /basic\.needs@finaid\.wisc\.edu/i);
  assert.match(UW_MADISON_RESOURCE_CONTEXT, /608-263-5700/);
  assert.match(UW_MADISON_RESOURCE_CONTEXT, /The Open Seat Food Pantry/);
  assert.match(UW_MADISON_RESOURCE_CONTEXT, /not affiliated with, operated by, or endorsed/i);
  assert.match(UW_MADISON_RESOURCE_CONTEXT, /verified.*August 13, 2026/i);
});

test("the campus chat homepage is branded, independent, and resource-forward", async () => {
  const response = await uwMadisonChatResponse(
    campusRequest("/"),
    testEnvironment(),
    {},
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.match(html, /data-campus-chat="uwmadison"/);
  assert.match(
    html,
    /rel="canonical" href="https:\/\/chat\.uwmadison\.stabilize\.info\/"/,
  );
  assert.match(html, /UW–Madison support, one step at a time/);
  assert.match(html, /Independent from UW–Madison/i);
  assert.match(html, /Not operated or endorsed by UW/i);
  assert.match(html, /UW resources/);
  assert.match(html, /Urgent help/);
  assert.match(html, /Do not wait on this chat during an emergency/);
  assert.match(html, /Call 911/);
  assert.match(html, /UHS option 9/);
  assert.match(html, /Call or text 988/);
  assert.match(
    html,
    /uwmadison-chat\.css\?v=20260813-first-screen-1/,
  );
  assert.match(html, /What is happening at UW–Madison\?/);
});

test("the campus stylesheet keeps the composer above the fold with compact urgent help", async () => {
  const css = await readFile(
    new URL("../public/uwmadison-chat.css", import.meta.url),
    "utf8",
  );

  assert.match(css, /\.uw-campus-strip/);
  assert.match(css, /\.uw-urgent-disclosure/);
  assert.match(css, /\.uw-urgent-panel/);
  assert.match(
    css,
    /html\[data-campus-chat="uwmadison"\]\s+\.page-shell[\s\S]*?height:\s*100dvh\s*!important[\s\S]*?overflow:\s*hidden\s*!important/,
  );
  assert.match(
    css,
    /html\[data-campus-chat="uwmadison"\]\s+\.chat-card[\s\S]*?flex:\s*1 1 auto[\s\S]*?min-height:\s*0/,
  );
  assert.match(css, /position:\s*absolute/);
  assert.match(css, /max-height:\s*calc\(100dvh - 120px\)/);
  assert.doesNotMatch(css, /\.uw-chat-banner/);
  assert.doesNotMatch(css, /\.uw-emergency-links/);
});

test("immediate-danger routing uses UW crisis contacts without calling OpenAI", async () => {
  const response = await uwMadisonChatResponse(
    campusRequest("/api/chat", {
      method: "POST",
      headers: {
        Origin: CHAT_UW_MADISON_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "I am going to kill myself now" }),
    }),
    testEnvironment({ OPENAI_API_KEY: "" }),
    {},
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.route, "IMMEDIATE_DANGER");
  assert.equal(body.showEmergency, true);
  assert.match(body.reply, /911/);
  assert.match(body.reply, /608-265-5600/);
  assert.match(body.reply, /option 9/i);
  assert.match(body.reply, /988/);
});

test("medication-change routing uses UHS medical advice without prescribing", async () => {
  const response = await uwMadisonChatResponse(
    campusRequest("/api/chat", {
      method: "POST",
      headers: {
        Origin: CHAT_UW_MADISON_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "Should I increase my medication dose?" }),
    }),
    testEnvironment({ OPENAI_API_KEY: "" }),
    {},
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.route, "MEDICATION_CHANGE");
  assert.match(body.reply, /pharmacist or prescriber/i);
  assert.match(body.reply, /608-265-5600/);
  assert.match(body.reply, /option 1/i);
  assert.doesNotMatch(body.reply, /increase your dose|take \d+ ?mg/i);
});

test("ordinary chat requests send the hardcoded directory as system instructions", async () => {
  const originalFetch = globalThis.fetch;
  let providerPayload = null;
  globalThis.fetch = async (_url, init) => {
    providerPayload = JSON.parse(String(init?.body || "{}"));
    return new Response(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "Start with Basic Needs Student Support: https://basicneeds.students.wisc.edu/",
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const response = await uwMadisonChatResponse(
      campusRequest("/api/chat", {
        method: "POST",
        headers: {
          Origin: CHAT_UW_MADISON_ORIGIN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "I cannot afford groceries this week. Where should I start?",
        }),
      }),
      testEnvironment(),
      {},
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.match(body.reply, /Basic Needs Student Support/);
    assert.match(providerPayload?.instructions || "", /UW–MADISON RESOURCE-AWARE MODE/);
    assert.match(providerPayload?.instructions || "", /The Open Seat Food Pantry/);
    assert.match(providerPayload?.instructions || "", /608-263-5700/);
    assert.equal(providerPayload?.store, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the campus chat rejects cross-origin browser posts", async () => {
  const response = await uwMadisonChatResponse(
    campusRequest("/api/chat", {
      method: "POST",
      headers: {
        Origin: "https://example.com",
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "hello" }),
    }),
    testEnvironment(),
    {},
  );
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.match(body.error, /Cross-origin request rejected/);
});

test("the campus chat publishes host-specific robots, sitemap, health, and assets", async () => {
  const [robotsResponse, sitemapResponse, healthResponse, assetResponse] =
    await Promise.all([
      uwMadisonChatResponse(campusRequest("/robots.txt"), testEnvironment(), {}),
      uwMadisonChatResponse(campusRequest("/sitemap.xml"), testEnvironment(), {}),
      uwMadisonChatResponse(campusRequest("/api/health"), testEnvironment(), {}),
      uwMadisonChatResponse(
        campusRequest("/uwmadison-chat.css"),
        testEnvironment(),
        {},
      ),
    ]);

  assert.equal(robotsResponse.status, 200);
  assert.match(
    await robotsResponse.text(),
    /Sitemap: https:\/\/chat\.uwmadison\.stabilize\.info\/sitemap\.xml/,
  );
  assert.equal(sitemapResponse.status, 200);
  assert.match(
    await sitemapResponse.text(),
    /<loc>https:\/\/chat\.uwmadison\.stabilize\.info\/<\/loc>/,
  );
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    experience: "uwmadison-resource-aware-chat",
    resourceDirectory: "hardcoded-server-side",
    resourceVerifiedDate: "2026-08-13",
    resourceCount: UW_MADISON_RESOURCES.length,
  });
  assert.equal(assetResponse.status, 200);
  assert.equal(await assetResponse.text(), "asset:/uwmadison-chat.css");
});

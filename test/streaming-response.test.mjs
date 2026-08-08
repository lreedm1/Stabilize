import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("model replies stream through NDJSON while fixed routes remain deterministic", async () => {
  const [workerSource, clientSource, packageSource] = await Promise.all([
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(workerSource, /function streamChatReply\(/);
  assert.match(workerSource, /application\/x-ndjson/);
  assert.match(workerSource, /stream:\s*true/);
  assert.match(workerSource, /response\.output_text\.delta/);
  assert.match(workerSource, /type:\s*"delta"/);
  assert.match(workerSource, /type:\s*"done"/);
  assert.match(workerSource, /await recordExchange\(stub/);
  assert.match(workerSource, /selectReasoningEffort/);
  assert.match(workerSource, /ORDINARY_OUTPUT_TOKEN_LIMIT = 360/);
  assert.match(workerSource, /LONG_FORM_OUTPUT_TOKEN_LIMIT = 900/);
  assert.match(workerSource, /service_tier: serviceTier/);
  assert.match(workerSource, /text: \{ verbosity: "low" \}/);
  assert.match(workerSource, /reasoningEffort: String\(/);
  assert.ok(
    (workerSource.match(/turnReasoningEffort/g) || []).length >= 2,
    "adaptive turn reasoning should remain present in both reply paths",
  );
  assert.match(
    workerSource,
    /async function generateFallbackReply[\s\S]*?chatRequestPayload\([\s\S]*?async function writeReplyDeltas/,
  );
  assert.match(
    workerSource,
    /if \(fixed\)[\s\S]*return jsonResponse\(\{ route, \.\.\.fixed \}\)/,
  );
  assert.match(
    workerSource,
    /return streamChatReply\(messages, route, env, latestText, stub, ctx\)/,
  );

  assert.match(clientSource, /async function readStreamingResponse\(/);
  assert.match(clientSource, /response\.body\.getReader\(\)/);
  assert.match(clientSource, /contentType\.includes\("application\/x-ndjson"\)/);
  assert.match(clientSource, /renderStreamingOutput\(article, accumulated\)/);
  assert.match(clientSource, /requestAnimationFrame\(flushStreamingOutput\)/);
  assert.match(clientSource, /text\.textContent = content/);
  assert.doesNotMatch(
    clientSource,
    /function renderStreamingOutput[\s\S]*renderMarkdown\(content/,
  );
  assert.match(clientSource, /finalizeStreamingOutput\(/);
  assert.match(clientSource, /function pendingReplyCopy\(/);
  assert.match(clientSource, /copy\.responding/);
  assert.match(
    clientSource,
    /const pendingOutput = showOutput\(pendingReplyCopy\(\)/,
  );

  assert.match(packageSource, /apply-priority-latency\.mjs/);
  assert.doesNotMatch(packageSource, /apply-streaming-policy\.mjs/);
});

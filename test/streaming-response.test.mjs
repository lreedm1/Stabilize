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
  assert.match(workerSource, /await recordExchange\(\s*stub/);
  assert.match(workerSource, /selectReasoningEffort/);
  assert.equal(
    (workerSource.match(/max_output_tokens: 500/g) || []).length,
    2,
  );
  assert.match(workerSource, /reasoningEffort: String\(/);
  assert.equal(
    (
      workerSource.match(
        /reasoning:\s*\{ effort: turnReasoningEffort \}/g,
      ) || []
    ).length,
    2,
  );
  assert.match(
    workerSource,
    /async function generateFallbackReply[\s\S]*?reasoning:\s*\{ effort: reasoningEffort \}[\s\S]*?async function writeReplyDeltas/,
  );
  assert.match(
    workerSource,
    /if \(fixed\)[\s\S]*return jsonResponse\(\{ route, \.\.\.fixed \}\)/,
  );
  assert.match(
    workerSource,
    /return streamChatReply\([\s\S]*?messages,[\s\S]*?route,[\s\S]*?env,[\s\S]*?latestText,[\s\S]*?stub,[\s\S]*?ctx,[\s\S]*?memory\.generation,[\s\S]*?\);/,
  );

  assert.match(clientSource, /async function readStreamingResponse\(/);
  assert.match(clientSource, /response\.body\.getReader\(\)/);
  assert.match(clientSource, /contentType\.includes\("application\/x-ndjson"\)/);
  assert.match(clientSource, /renderStreamingOutput\(article, accumulated\)/);
  assert.match(clientSource, /finalizeStreamingOutput\(/);
  assert.match(clientSource, /function pendingReplyCopy\(/);
  assert.match(clientSource, /copy\.responding/);
  assert.match(
    clientSource,
    /const pendingOutput = showOutput\(pendingReplyCopy\(\)/,
  );

  assert.match(packageSource, /apply-streaming-policy\.mjs/);
  assert.match(packageSource, /use-supported-openai-model\.mjs/);
  assert.match(packageSource, /apply-adaptive-reasoning\.mjs/);
});

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
  assert.equal(
    (
      workerSource.match(
        /reasoning:\s*\{ effort: turnReasoningEffort \}/g,
      ) || []
    ).length,
    2,
  );
  assert.doesNotMatch(
    workerSource,
    /reasoning:\s*\{ effort: reasoningEffort \}/,
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
  assert.match(clientSource, /finalizeStreamingOutput\(/);
  assert.match(clientSource, /const pendingOutput = showOutput\(copy\.thinking/);

  assert.match(packageSource, /apply-streaming-policy\.mjs/);
  assert.match(packageSource, /apply-adaptive-reasoning\.mjs/);
});

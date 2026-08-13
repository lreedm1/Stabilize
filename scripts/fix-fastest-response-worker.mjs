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
    throw new Error(`Fastest-response Worker repair could not find ${label}`);
  }
}

function occurrences(value, expected) {
  return value.split(expected).length - 1;
}

await update("src/index.js", (source) => {
  let text = source;
  const effortSelection = `  env = reasoningEnvironment(
    env,
    requestedReasoningEffort(
      body,
      env.OPENAI_MODEL,
      env.OPENAI_REASONING_EFFORT,
    ),
  );
`;

  requireText(
    text,
    "function requestedReasoningEffort(body, model, fallbackEffort)",
    "the request-level reasoning validator",
  );
  requireText(
    text,
    "function reasoningEnvironment(env, effort)",
    "the request-level reasoning environment",
  );

  // Earlier generation attached the request effort to whichever JSON handler
  // appeared first. Remove that misplaced copy and bind it to chat itself.
  text = text.replaceAll(effortSelection, "");
  const chatStart = `async function handleChat(request, env, ctx, accountKey) {
  const body = await readBoundedJson(request);
`;
  requireText(text, chatStart, "the chat request body");
  text = text.replace(chatStart, chatStart + effortSelection);

  const fallbackStart = text.indexOf(
    "async function generateFallbackReply(messages, route, env) {",
  );
  const fallbackEnd = text.indexOf(
    "\nasync function writeReplyDeltas(",
    fallbackStart,
  );
  if (fallbackStart < 0 || fallbackEnd <= fallbackStart) {
    throw new Error("Fastest-response Worker repair could not isolate the fallback generator");
  }

  let fallback = text.slice(fallbackStart, fallbackEnd);
  fallback = fallback.replace(
    "  const { apiKey, model } = openAIConfig(env);",
    "  const { apiKey, model, reasoningEffort } = openAIConfig(env);",
  );
  fallback = fallback.replace(
    '      reasoning: { effort: "medium" },',
    "      reasoning: { effort: reasoningEffort },",
  );
  text = text.slice(0, fallbackStart) + fallback + text.slice(fallbackEnd);

  if (occurrences(text, effortSelection) !== 1) {
    throw new Error("Request reasoning must be selected exactly once in the chat handler");
  }
  const chatSectionEnd = text.indexOf("\nfunction authNotice(", text.indexOf(chatStart));
  const chatSection = text.slice(text.indexOf(chatStart), chatSectionEnd);
  requireText(chatSection, effortSelection, "chat-local reasoning selection");
  requireText(
    fallback,
    "const { apiKey, model, reasoningEffort } = openAIConfig(env);",
    "the fallback reasoning configuration",
  );
  requireText(
    fallback,
    "reasoning: { effort: reasoningEffort },",
    "the fallback selected effort",
  );
  return text;
});

await update(
  "test/impact-worker.test.mjs",
  (source) => {
    const text = source.replace(
      "/prior conversation helped the user move forward/",
      "/prior conversation helped\\s+the\\s+user move forward/",
    );
    requireText(
      text,
      "/prior conversation helped\\s+the\\s+user move forward/",
      "the whitespace-tolerant privacy disclosure assertion",
    );
    return text;
  },
  { optional: true },
);

await update(
  "test/streaming-response.test.mjs",
  (source) => {
    let text = source;
    const staleAssertion = `  assert.doesNotMatch(
    workerSource,
    /reasoning:\\s*\\{ effort: reasoningEffort \\}/,
  );`;
    const fallbackAssertion = `  assert.match(
    workerSource,
    /async function generateFallbackReply[\\s\\S]*?reasoning:\\s*\\{ effort: reasoningEffort \\}[\\s\\S]*?async function writeReplyDeltas/,
  );`;
    if (text.includes(staleAssertion)) {
      text = text.replace(staleAssertion, fallbackAssertion);
    }

    text = text.replace(
      `  assert.match(clientSource, /const pendingOutput = showOutput\\(copy\\.thinking/);`,
      `  assert.match(clientSource, /function pendingReplyCopy\\(/);
  assert.match(clientSource, /copy\\.responding/);
  assert.match(
    clientSource,
    /const pendingOutput = showOutput\\(pendingReplyCopy\\(\\)/,
  );`,
    );

    requireText(
      text,
      "async function generateFallbackReply[\\s\\S]*?reasoning:",
      "the selected-effort fallback assertion",
    );
    if (text.includes("assert.doesNotMatch(\n    workerSource,\n    /reasoning:")) {
      throw new Error("Streaming regression test still rejects selected fallback effort");
    }
    return text;
  },
  { optional: true },
);

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    let text = source;
    if (!text.includes('"scripts/fix-fastest-response-worker.mjs"')) {
      const marker = '  "scripts/fix-fastest-response-release.mjs",\n';
      requireText(text, marker, "the release-repair fixture");
      text = text.replace(
        marker,
        `${marker}  "scripts/fix-fastest-response-worker.mjs",\n`,
      );
    }
    return text;
  },
  { optional: true },
);

console.log(
  "Preserved instant-by-default responses while honoring selected thinking levels and fallback delivery.",
);

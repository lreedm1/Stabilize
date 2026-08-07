import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}

function replaceReasoningExpectation(text, testTitle, effort) {
  const start = text.indexOf(`test("${testTitle}"`);
  if (start < 0) {
    throw new Error(`Adaptive reasoning could not find test: ${testTitle}`);
  }
  const next = text.indexOf('\ntest("', start + 6);
  const end = next < 0 ? text.length : next;
  const block = text.slice(start, end);
  const pattern =
    /assert\.deepEqual\(providerBody\.reasoning,\s*\{[\s\S]*?\}\);/;
  if (!pattern.test(block)) {
    throw new Error(
      `Adaptive reasoning could not find the expectation in: ${testTitle}`,
    );
  }
  const updated = block.replace(
    pattern,
    `assert.deepEqual(providerBody.reasoning, { effort: "${effort}" });`,
  );
  return text.slice(0, start) + updated + text.slice(end);
}

await update("src/index.js", (source) => {
  let text = source;
  const importLine =
    'import { selectReasoningEffort } from "./reasoning-policy.js";\n';
  if (!text.includes(importLine.trim())) {
    const importAnchor =
      'import { classifyInput, fixedReplyForRoute } from "./safety.js";\n';
    if (!text.includes(importAnchor)) {
      throw new Error("Adaptive reasoning could not find the safety import");
    }
    text = text.replace(importAnchor, importAnchor + importLine);
  }

  const replyAnchor = `  const { apiKey, model, reasoningEffort } = openAIConfig(env);
  const result = await callOpenAI(`;
  const replyReplacement = `  const { apiKey, model, reasoningEffort } = openAIConfig(env);
  const turnReasoningEffort = selectReasoningEffort({
    latestText,
    route,
    messages,
    ceiling: reasoningEffort,
  });
  const result = await callOpenAI(`;
  if (text.includes(replyAnchor)) {
    text = text.replace(replyAnchor, replyReplacement);
  }

  const streamAnchor = `        const { apiKey, model, reasoningEffort } = openAIConfig(env);
        const result = await openAIStream(`;
  const streamReplacement = `        const { apiKey, model, reasoningEffort } = openAIConfig(env);
        const turnReasoningEffort = selectReasoningEffort({
          latestText,
          route,
          messages,
          ceiling: reasoningEffort,
        });
        const result = await openAIStream(`;
  if (text.includes(streamAnchor)) {
    text = text.replace(streamAnchor, streamReplacement);
  }

  text = text.replaceAll(
    'reasoning: { effort: reasoningEffort },',
    'reasoning: { effort: turnReasoningEffort },',
  );

  if (
    countOccurrences(
      text,
      "const turnReasoningEffort = selectReasoningEffort({",
    ) !== 2
  ) {
    throw new Error("Adaptive reasoning did not wire both reply paths");
  }
  if (
    countOccurrences(
      text,
      "reasoning: { effort: turnReasoningEffort },",
    ) !== 2
  ) {
    throw new Error("Adaptive reasoning did not update both OpenAI payloads");
  }
  return text;
});

await update("test/worker.test.mjs", (source) => {
  let text = replaceReasoningExpectation(
    source,
    "chat endpoint calls OpenAI with store enabled",
    "low",
  );
  text = replaceReasoningExpectation(
    text,
    "legacy internal model alias maps to the supported API model",
    "low",
  );

  text = text.replace(
    'body: JSON.stringify({ message: "Help me choose a next step." }),',
    `body: JSON.stringify({
          message:
            "I am deciding whether to accept a job in Madison or Milwaukee. Compare pay, housing costs, commute, career growth, and stability.",
        }),`,
  );

  const marker =
    'test("rate limits return a retry time and a safe traceable error"';
  if (
    !text.includes(
      'test("complex decisions use the strongest supported reasoning"',
    )
  ) {
    const integrationTest = `test("complex decisions use the strongest supported reasoning", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Compare the options against the factors that matter most.");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:
            "I am deciding whether to accept a job in Madison or Milwaukee. Compare pay, housing costs, commute, career growth, and stability.",
        }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(providerBody.reasoning, { effort: "xhigh" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

`;
    if (!text.includes(marker)) {
      throw new Error(
        "Adaptive reasoning could not find the integration-test anchor",
      );
    }
    text = text.replace(marker, integrationTest + marker);
  }

  if (
    countOccurrences(
      text,
      'assert.deepEqual(providerBody.reasoning, { effort: "low" });',
    ) < 2
  ) {
    throw new Error(
      "Adaptive reasoning did not align the lightweight-turn tests",
    );
  }

  // The final Current-model pass upgrades the strongest assertion from xhigh
  // to max. Accept either state so running the complete generation pipeline a
  // second time remains a no-op instead of blocking deployment.
  const strongestExpectationPresent = ["xhigh", "max"].some((effort) =>
    text.includes(
      `assert.deepEqual(providerBody.reasoning, { effort: "${effort}" });`,
    ),
  );
  if (!strongestExpectationPresent) {
    throw new Error(
      "Adaptive reasoning did not retain the complex-decision test",
    );
  }
  return text;
});

console.log("Applied adaptive per-turn reasoning.");

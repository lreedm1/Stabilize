import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/index.js", (source) => {
  let text = source;

  // `context` is not part of the Responses API reasoning object. Sending it
  // causes the provider to reject both streamed and non-streamed requests.
  text = text.replaceAll(
    'reasoning: { effort: reasoningEffort, context: "current_turn" },',
    'reasoning: { effort: reasoningEffort },',
  );
  text = text.replaceAll(
    'reasoning: { effort: "low", context: "current_turn" },',
    'reasoning: { effort: "low" },',
  );

  if (text.includes('context: "current_turn"')) {
    throw new Error("Unsupported Responses API reasoning.context remains");
  }
  return text;
});

await update("test/worker.test.mjs", (source) => {
  let text = source;
  text = text.replaceAll(
    'assert.deepEqual(providerBody.reasoning, {\n      effort: "max",\n      context: "current_turn",\n    });',
    'assert.deepEqual(providerBody.reasoning, { effort: "max" });',
  );
  text = text.replaceAll(
    'assert.deepEqual(providerBody.reasoning, {\n      effort: "high",\n      context: "current_turn",\n    });',
    'assert.deepEqual(providerBody.reasoning, { effort: "high" });',
  );
  text = text.replaceAll(
    'assert.deepEqual(providerBody.reasoning, {\n      effort: "low",\n      context: "current_turn",\n    });',
    'assert.deepEqual(providerBody.reasoning, { effort: "low" });',
  );
  return text;
});

await update("test/streaming-response.test.mjs", (source) =>
  source
    .replaceAll('effort: "max", context: "current_turn"', 'effort: "max"')
    .replaceAll('effort: "high", context: "current_turn"', 'effort: "high"')
    .replaceAll('effort: "low", context: "current_turn"', 'effort: "low"'),
);

console.log("Normalized OpenAI Responses API reasoning schema.");

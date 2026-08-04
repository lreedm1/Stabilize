import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/index.js", (source) => {
  let text = source;

  // The Responses API accepts effort through xhigh. Keep the public "max"
  // setting as a product preference, but map it to the strongest valid API value.
  text = text.replace(
    '    if (/^gpt-5\\.6(?:-|$)/.test(model)) return "max";',
    '    if (/^gpt-5\\.6(?:-|$)/.test(model)) return "xhigh";',
  );

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
  if (!text.includes('if (/^gpt-5\\.6(?:-|$)/.test(model)) return "xhigh";')) {
    throw new Error("Could not normalize max reasoning to xhigh");
  }
  return text;
});

await update("test/worker.test.mjs", (source) => {
  let text = source;
  text = text.replaceAll(
    'assert.deepEqual(providerBody.reasoning, {\n      effort: "max",\n      context: "current_turn",\n    });',
    'assert.deepEqual(providerBody.reasoning, { effort: "xhigh" });',
  );
  text = text.replaceAll(
    'assert.deepEqual(providerBody.reasoning, {\n      effort: "low",\n      context: "current_turn",\n    });',
    'assert.deepEqual(providerBody.reasoning, { effort: "low" });',
  );
  return text;
});

await update("test/streaming-response.test.mjs", (source) =>
  source
    .replaceAll('effort: "max", context: "current_turn"', 'effort: "xhigh"')
    .replaceAll('effort: "low", context: "current_turn"', 'effort: "low"'),
);

console.log("Normalized OpenAI Responses API reasoning schema.");

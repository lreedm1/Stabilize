import { readFileSync, writeFileSync } from "node:fs";
function replaceExact(path, before, after, label) {
  const source = readFileSync(path, "utf8");
  if (source.includes(after) && !source.includes(before)) return;
  const first = source.indexOf(before), last = source.lastIndexOf(before);
  if (first < 0 || first !== last) throw new Error(`Could not locate exactly one ${label} in ${path}`);
  writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length), "utf8");
}
const oldFallback = `          const fallbackModel =
            selection?.adaptive &&
            selectedModel === selection.lunaModel
              ? selection.solModel
              : selectedModel;
          selectedModel = fallbackModel;
          reply = await generateFallbackReply(
            messages,
            route,
            modelOverrideEnvironment(env, fallbackModel),
            latestText,
          );
          if (selection?.adaptive && fallbackModel === selection.solModel) {
            selection = {
              ...selection,
              decision: "sol",
              decisionSource: "sol-fallback-after-luna-stream-error",
              model: fallbackModel,
            };
            logAdaptiveRouting(selection);
          }
`;
const newFallback = `          const fallbackFromLuna =
            selection?.adaptive &&
            selectedModel === selection.lunaModel;
          const fallbackModel = fallbackFromLuna
            ? selection.solModel
            : selectedModel;
          selectedModel = fallbackModel;
          reply = await generateFallbackReply(
            messages,
            route,
            modelOverrideEnvironment(env, fallbackModel),
            latestText,
          );
          if (fallbackFromLuna) {
            selection = {
              ...selection,
              decision: "sol",
              decisionSource: "sol-fallback-after-luna-stream-error",
              model: fallbackModel,
            };
            logAdaptiveRouting(selection);
          }
`;
const oldWorkerEnv = `    OPENAI_MODEL: "gpt-5.6-sol",
    OPENAI_REASONING_EFFORT: "max",
    GOOGLE_CLIENT_ID,
`;
const newWorkerEnv = `    OPENAI_MODEL: "gpt-5.6-sol",
    OPENAI_REASONING_EFFORT: "max",
    OPENAI_ADAPTIVE_ROUTING: "false",
    GOOGLE_CLIENT_ID,
`;
const oldPrivateAssertions = `    assert.equal(providerBody.input.length, 1);
    assert.equal(
      providerBody.input[0].content,
      "Answer this without using or updating memory.",
    );
    assert.doesNotMatch(JSON.stringify(providerBody.input), /remembered/i);
`;
const newPrivateAssertions = `    assert.equal(providerBody.input.length, 2);
    assert.equal(providerBody.input[0].role, "system");
    assert.equal(providerBody.input.at(-1).role, "user");
    assert.equal(
      providerBody.input.at(-1).content,
      "Answer this without using or updating memory.",
    );
    assert.doesNotMatch(
      JSON.stringify(providerBody.input),
      /I prefer remembered concise plans|Remember this active thread|This is remembered recent context/i,
    );
`;
const oldProviderAssertions = `    assert.equal(providerBody.input[0].role, "user");
    assert.equal(providerBody.input[0].content, "Help me plan one next step.");
    assert.match(providerBody.instructions, /route ORDINARY/i);
    assert.match(providerBody.instructions, /Floor supports; answer leads/i);
    assert.match(providerBody.instructions, /current evidence wins/i);
    assert.match(providerBody.instructions, /Systems > willpower/i);
    assert.ok(COPY.model.systemPrompt.length < 3_200);
    assert.match(providerBody.instructions, /220 words or fewer/i);
    assert.match(providerBody.instructions, /document-ready content/i);
    assert.match(providerBody.instructions, /PRIOR CONTEXT MEMORY/i);
`;
const newProviderAssertions = `    assert.equal(providerBody.prompt_cache_key, "stabilize-floor-first-v1");
    assert.deepEqual(providerBody.prompt_cache_options, {
      mode: "explicit",
      ttl: "30m",
    });
    assert.equal(providerBody.input[0].role, "system");
    assert.equal(providerBody.input.at(-1).role, "user");
    assert.equal(
      providerBody.input.at(-1).content,
      "Help me plan one next step.",
    );
    const stableInstructions = providerBody.input[0].content[0].text;
    const variableInstructions = providerBody.input[0].content[1].text;
    assert.match(variableInstructions, /route ORDINARY/i);
    assert.match(stableInstructions, /Floor supports; answer leads/i);
    assert.match(stableInstructions, /current evidence wins/i);
    assert.match(stableInstructions, /Systems > willpower/i);
    assert.ok(COPY.model.systemPrompt.length < 3_200);
    assert.match(stableInstructions, /220 words or fewer/i);
    assert.match(stableInstructions, /document-ready content/i);
    assert.match(variableInstructions, /PRIOR CONTEXT MEMORY/i);
`;
const oldMemoryAssertions = `    assert.match(providerBody.input[0].content, /PRIOR CONTEXT MEMORY/);
    assert.match(providerBody.input[0].content, /prefers short plans/);
    assert.match(
      providerBody.input.at(-1).content,
      /What should I do next\\?$/,
    );
`;
const newMemoryAssertions = `    assert.equal(providerBody.input[0].role, "system");
    const conversationInput = providerBody.input.slice(1);
    assert.match(conversationInput[0].content, /PRIOR CONTEXT MEMORY/);
    assert.match(conversationInput[0].content, /prefers short plans/);
    assert.match(
      conversationInput.at(-1).content,
      /What should I do next\\?$/,
    );
`;
const oldLunaAssertion = `    assert.equal(
      calls.filter((call) => call.body.model === "gpt-5.6-luna").length,
      1,
    );
`;
const newLunaAssertion = `    assert.equal(
      calls.filter(
        (call) =>
          call.body.model === "gpt-5.6-luna" && call.body.stream === true,
      ).length,
      1,
    );
`;
const replacements = [
  ["src/index.js", oldFallback, newFallback, "adaptive stream fallback block"],
  ["test/worker.test.mjs", oldWorkerEnv, newWorkerEnv, "legacy Worker test environment"],
  ["test/worker.test.mjs", oldPrivateAssertions, newPrivateAssertions, "private prompt-cache assertions"],
  ["test/worker.test.mjs", oldProviderAssertions, newProviderAssertions, "provider prompt-cache assertions"],
  ["test/worker.test.mjs", oldMemoryAssertions, newMemoryAssertions, "memory prompt-cache assertions"],
  ["test/adaptive-model-routing-worker.test.mjs", oldLunaAssertion, newLunaAssertion, "Luna candidate assertion"],
];
for (const args of replacements) replaceExact(...args);
const transformPath = "scripts/luna-adaptive-routing-transforms.mjs";
let transforms = readFileSync(transformPath, "utf8");
const additions = [
  { path: "src/index.js", before: oldFallback, after: newFallback, label: "src/index.js hunk fallback provenance" },
  { path: "test/worker.test.mjs", before: oldWorkerEnv, after: newWorkerEnv, label: "test/worker.test.mjs hunk isolate legacy Worker coverage" },
  { path: "test/worker.test.mjs", before: oldPrivateAssertions, after: newPrivateAssertions, label: "test/worker.test.mjs hunk private prompt caching" },
  { path: "test/worker.test.mjs", before: oldProviderAssertions, after: newProviderAssertions, label: "test/worker.test.mjs hunk provider prompt caching" },
  { path: "test/worker.test.mjs", before: oldMemoryAssertions, after: newMemoryAssertions, label: "test/worker.test.mjs hunk memory prompt caching" },
];
const missing = additions.filter(({ label }) => !transforms.includes(label));
if (missing.length) {
  const serialized = missing.map((value) => JSON.stringify(value, null, 2).split("\n").map((line) => `  ${line}`).join("\n")).join(",\n");
  const marker = "\n]);\n\nfunction replaceExact";
  if (!transforms.includes(marker)) throw new Error("Could not locate adaptive transform list terminator");
  transforms = transforms.replace(marker, `,\n${serialized}\n]);\n\nfunction replaceExact`);
  writeFileSync(transformPath, transforms, "utf8");
}
console.log("Patched adaptive fallback and aligned legacy Worker tests with explicit prompt caching.");

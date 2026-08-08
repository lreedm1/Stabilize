import { readFileSync, writeFileSync } from "node:fs";

function replaceExact(path, before, after, label) {
  const source = readFileSync(path, "utf8");
  if (source.includes(after) && !source.includes(before)) return;
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0 || first !== last) {
    throw new Error(`Could not locate exactly one ${label} in ${path}`);
  }
  writeFileSync(
    path,
    source.slice(0, first) + after + source.slice(first + before.length),
    "utf8",
  );
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
replaceExact(
  "src/index.js",
  oldFallback,
  newFallback,
  "adaptive stream fallback block",
);

const oldWorkerEnv = `    OPENAI_MODEL: "gpt-5.6-sol",
    OPENAI_REASONING_EFFORT: "max",
    GOOGLE_CLIENT_ID,
`;
const newWorkerEnv = `    OPENAI_MODEL: "gpt-5.6-sol",
    OPENAI_REASONING_EFFORT: "max",
    OPENAI_ADAPTIVE_ROUTING: "false",
    GOOGLE_CLIENT_ID,
`;
replaceExact(
  "test/worker.test.mjs",
  oldWorkerEnv,
  newWorkerEnv,
  "legacy Worker test environment",
);

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
replaceExact(
  "test/adaptive-model-routing-worker.test.mjs",
  oldLunaAssertion,
  newLunaAssertion,
  "Luna candidate assertion",
);

const transformPath = "scripts/luna-adaptive-routing-transforms.mjs";
let transforms = readFileSync(transformPath, "utf8");
const transformLabel = "src/index.js hunk fallback provenance";
if (!transforms.includes(transformLabel)) {
  const additions = [
    {
      path: "src/index.js",
      before: oldFallback,
      after: newFallback,
      label: transformLabel,
    },
    {
      path: "test/worker.test.mjs",
      before: oldWorkerEnv,
      after: newWorkerEnv,
      label: "test/worker.test.mjs hunk isolate legacy Worker coverage",
    },
  ];
  const serialized = additions
    .map((value) =>
      JSON.stringify(value, null, 2)
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    )
    .join(",\n");
  const marker = "\n]);\n\nfunction replaceExact";
  if (!transforms.includes(marker)) {
    throw new Error("Could not locate adaptive transform list terminator");
  }
  transforms = transforms.replace(
    marker,
    `,\n${serialized}\n]);\n\nfunction replaceExact`,
  );
  writeFileSync(transformPath, transforms, "utf8");
}

console.log("Patched adaptive routing fallback and isolated legacy Worker tests.");

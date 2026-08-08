import { readFileSync, writeFileSync } from "node:fs";
import { applyLunaAdaptiveTransforms } from "./luna-adaptive-routing-transforms.mjs";

const EXPECTED_PIPELINE =
  "node scripts/prepare-luna-adaptive-routing.mjs && " +
  "node scripts/prepare-signed-in-latency-v2.mjs && " +
  "node scripts/apply-priority-latency.mjs && " +
  "node scripts/prepare-gpt56-fast-generators.mjs && " +
  "node scripts/add-memory-deletion-and-guest-session.mjs && " +
  "node scripts/finalize-memory-controls.mjs && " +
  "node scripts/apply-signed-in-latency-v2.mjs && " +
  "node scripts/align-signed-in-latency-v2.mjs && " +
  "node scripts/finalize-signed-in-latency-v2.mjs && " +
  "node scripts/apply-gpt56-fast-runtime.mjs && " +
  "node scripts/apply-gpt56-fast-copy.mjs && " +
  "node scripts/apply-gpt56-fast-node-tests.mjs && " +
  "node scripts/apply-gpt56-fast-model-usage-test.mjs && " +
  "node scripts/apply-gpt56-fast-paid-worker-test.mjs && " +
  "node scripts/apply-gpt56-fast-priority-worker-test.mjs && " +
  "node scripts/add-guest-summary.mjs && " +
  "node scripts/apply-luna-adaptive-routing.mjs";

function read(path) {
  return readFileSync(path, "utf8");
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`Adaptive model routing is missing ${label}`);
  }
}

function ensurePackageScripts() {
  const path = "package.json";
  const packageJson = JSON.parse(read(path));
  packageJson.scripts["apply:prompt-policy"] = EXPECTED_PIPELINE;

  const nodeTest = "test/adaptive-model-routing.test.mjs";
  if (!packageJson.scripts["test:node"].includes(nodeTest)) {
    packageJson.scripts["test:node"] = packageJson.scripts["test:node"].replace(
      "node --test ",
      `node --test ${nodeTest} `,
    );
  }

  const workerTest = "test/adaptive-model-routing-worker.test.mjs";
  if (!packageJson.scripts["test:worker"].includes(workerTest)) {
    packageJson.scripts["test:worker"] += ` ${workerTest}`;
  }

  const next = JSON.stringify(packageJson, null, 2) + "\n";
  if (next !== read(path)) writeFileSync(path, next, "utf8");
}

applyLunaAdaptiveTransforms("forward");
ensurePackageScripts();

const config = JSON.parse(read("wrangler.jsonc"));
const vars = config.vars || {};
for (const [name, expected] of Object.entries({
  FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-luna",
  OPENAI_COMPLEX_MODEL: "gpt-5.6-sol",
  OPENAI_COMPLEXITY_MODEL: "gpt-5.6-luna",
  OPENAI_ADAPTIVE_ROUTING: "true",
  FREE_PLAN_FALLBACK_MODEL: "gpt-5.4",
})) {
  if (vars[name] !== expected) {
    throw new Error(`${name} must be ${expected}`);
  }
}

const router = read("src/adaptive-model-routing.js");
for (const [expected, label] of [
  ['DEFAULT_LUNA_MODEL = "gpt-5.6-luna"', "the Luna model"],
  ['DEFAULT_SOL_MODEL = "gpt-5.6-sol"', "the Sol model"],
  ["Return exactly SOL or LUNA", "the bounded gate output contract"],
  ["When genuinely uncertain, choose SOL", "the conservative uncertainty rule"],
  ["fallbackComplexityDecision", "the deterministic gate fallback"],
]) {
  requireText(router, expected, label);
}

const core = read("src/index.js");
for (const [expected, label] of [
  ['from "./adaptive-model-routing.js"', "the adaptive routing import"],
  ["const lunaCandidate = settledOpenAIRequest(", "the parallel Luna candidate"],
  ["const decisionPromise = decideAdaptiveModel({", "the parallel complexity decision"],
  ["discardOpenAIStream(lunaController, lunaCandidate)", "discarded streaming Luna output"],
  ['lunaController.abort("sol-selected")', "discarded buffered Luna output"],
  ["selection.model === adaptive.solModel", "the Sol escalation branch"],
  ["for await (const delta of openAITextDeltas(selection.result))", "selected-only streaming"],
  ["assistant: validated", "selected-only account memory"],
]) {
  requireText(core, expected, label);
}

const candidateIndex = core.indexOf("const lunaCandidate = settledOpenAIRequest(");
const decisionIndex = core.indexOf("const decisionPromise = decideAdaptiveModel({");
if (candidateIndex < 0 || decisionIndex < 0 || candidateIndex >= decisionIndex) {
  throw new Error("Luna and the complexity decision must be started in parallel");
}

const packageJson = JSON.parse(read("package.json"));
if (packageJson.scripts["apply:prompt-policy"] !== EXPECTED_PIPELINE) {
  throw new Error("The adaptive routing generator must remain last in the canonical pipeline");
}

console.log(
  "Applied adaptive model routing: Luna starts with a parallel Luna complexity gate, and only the selected answer is shown or remembered.",
);

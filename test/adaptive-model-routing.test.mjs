import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LUNA_MODEL,
  DEFAULT_SOL_MODEL,
  adaptiveRoutingConfig,
  decideAdaptiveModel,
  fallbackComplexityDecision,
} from "../src/adaptive-model-routing.js";

const adaptiveEnv = {
  FREE_PLAN_PRIMARY_MODEL: DEFAULT_LUNA_MODEL,
  OPENAI_COMPLEX_MODEL: DEFAULT_SOL_MODEL,
  OPENAI_COMPLEXITY_MODEL: DEFAULT_LUNA_MODEL,
  OPENAI_ADAPTIVE_ROUTING: "true",
};

test("adaptive routing is limited to the automatic Luna path", () => {
  assert.deepEqual(
    adaptiveRoutingConfig(adaptiveEnv, DEFAULT_LUNA_MODEL),
    {
      lunaModel: DEFAULT_LUNA_MODEL,
      solModel: DEFAULT_SOL_MODEL,
      routerModel: DEFAULT_LUNA_MODEL,
    },
  );
  assert.equal(adaptiveRoutingConfig(adaptiveEnv, DEFAULT_SOL_MODEL), null);
  assert.equal(
    adaptiveRoutingConfig(
      { ...adaptiveEnv, OPENAI_ADAPTIVE_ROUTING: "false" },
      DEFAULT_LUNA_MODEL,
    ),
    null,
  );
});

test("the deterministic fallback keeps simple work on Luna and escalates complex work", () => {
  assert.equal(
    fallbackComplexityDecision({ latestText: "Help me make lunch." }),
    "luna",
  );
  assert.equal(
    fallbackComplexityDecision({
      latestText:
        "Compare these housing options across cost, safety, commute, support, and lease risk.",
    }),
    "sol",
  );
  assert.equal(
    fallbackComplexityDecision({
      latestText: "Give me a simple answer.",
      reasoningEffort: "high",
    }),
    "sol",
  );
});

test("the parallel model decision accepts only exact Luna or Sol output", async () => {
  const calls = [];
  const result = await decideAdaptiveModel({
    env: adaptiveEnv,
    configuredModel: DEFAULT_LUNA_MODEL,
    messages: [{ role: "user", content: "Compare my options." }],
    route: "ORDINARY",
    latestText: "Compare my options.",
    reasoningEffort: "medium",
    apiKey: "test-key",
    serviceTier: "fast",
    callOpenAI: async (payload) => {
      calls.push(payload);
      return {
        text: "SOL",
        usage: { input_tokens: 80, output_tokens: 1 },
        serviceTier: "fast",
      };
    },
  });

  assert.equal(result.adaptive, true);
  assert.equal(result.decision, "sol");
  assert.equal(result.model, DEFAULT_SOL_MODEL);
  assert.equal(result.decisionSource, "model-router");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, DEFAULT_LUNA_MODEL);
  assert.equal(calls[0].max_output_tokens, 8);
  assert.equal(calls[0].store, false);
  assert.match(calls[0].instructions, /Return exactly SOL or LUNA/);
  assert.doesNotMatch(calls[0].instructions, /Compare my options/);
});

test("invalid or failed router output falls back conservatively", async () => {
  const invalid = await decideAdaptiveModel({
    env: adaptiveEnv,
    configuredModel: DEFAULT_LUNA_MODEL,
    messages: [],
    route: "ORDINARY",
    latestText: "Draft a short grocery list.",
    reasoningEffort: "none",
    apiKey: "test-key",
    serviceTier: "fast",
    callOpenAI: async () => ({ text: "maybe" }),
  });
  assert.equal(invalid.decision, "sol");
  assert.equal(invalid.model, DEFAULT_SOL_MODEL);
  assert.equal(
    invalid.decisionSource,
    "conservative-invalid-router-output",
  );

  const failed = await decideAdaptiveModel({
    env: adaptiveEnv,
    configuredModel: DEFAULT_LUNA_MODEL,
    messages: [],
    route: "ORDINARY",
    latestText: "Do a comprehensive legal analysis of this filing.",
    reasoningEffort: "none",
    apiKey: "test-key",
    serviceTier: "fast",
    callOpenAI: async () => {
      throw new Error("router unavailable");
    },
  });
  assert.equal(failed.decision, "sol");
  assert.equal(failed.model, DEFAULT_SOL_MODEL);
  assert.equal(failed.decisionSource, "conservative-router-error");
});

test("deterministic complexity overrides an under-escalating router", async () => {
  const result = await decideAdaptiveModel({
    env: adaptiveEnv,
    configuredModel: DEFAULT_LUNA_MODEL,
    messages: [],
    route: "ORDINARY",
    latestText: "Debug this production incident and trace the root cause.",
    reasoningEffort: "none",
    apiKey: "test-key",
    serviceTier: "fast",
    callOpenAI: async () => ({ text: "LUNA" }),
  });

  assert.equal(result.decision, "sol");
  assert.equal(result.model, DEFAULT_SOL_MODEL);
  assert.equal(
    result.decisionSource,
    "deterministic-complexity-override",
  );
});

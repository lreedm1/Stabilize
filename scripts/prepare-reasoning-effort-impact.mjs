import { readFile, writeFile } from "node:fs/promises";

async function prepareRuntimeGenerator() {
  const path = "scripts/apply-gpt56-fast-runtime.mjs";
  const anchor = "  if (source.includes(after)) return source;\n";
  const priorGuard = `  if (
    label === "the JSON-mode usage log" &&
    source.includes("logInteractiveUsage(result, model, serviceTier, reasoningEffort);") &&
    source.includes("reasoningEffort: analytics.reasoningEffort")
  ) {
    return source;
  }
`;
  const guard = `  if (
    label === "the JSON-mode usage log" &&
    source.includes("logInteractiveUsage(result, model, serviceTier,") &&
    source.includes("analytics: interactiveUsageSnapshot(")
  ) {
    return source;
  }
`;
  let source = await readFile(path, "utf8");
  if (source.includes(guard)) {
    console.log("The GPT-5.6 runtime generator already accepts reasoning analytics.");
    return;
  }
  if (source.includes(priorGuard)) {
    source = source.replace(priorGuard, guard);
    await writeFile(path, source);
    console.log("Updated the GPT-5.6 runtime compatibility guard for reasoning analytics.");
    return;
  }
  if (!source.includes(anchor)) {
    throw new Error(`Could not find the compatibility anchor in ${path}.`);
  }
  await writeFile(path, source.replace(anchor, anchor + guard));
  console.log("Prepared the GPT-5.6 runtime generator for reasoning analytics.");
}

async function prepareDecisionGradeGenerator() {
  const path = "scripts/apply-decision-grade-impact.mjs";
  const anchor = "  if (source.includes(after)) return source;\n";
  const guard = `  if (
    label === "provider stream analytics" &&
    source.includes("analytics = interactiveUsageSnapshot(")
  ) {
    return source;
  }
`;
  let source = await readFile(path, "utf8");
  if (source.includes(guard)) {
    console.log("The decision-grade generator already accepts reasoning stream analytics.");
    return;
  }
  if (!source.includes(anchor)) {
    throw new Error(`Could not find the compatibility anchor in ${path}.`);
  }
  await writeFile(path, source.replace(anchor, anchor + guard));
  console.log("Prepared the decision-grade generator for reasoning stream analytics.");
}

async function prepareFullGuestFinalizer() {
  const path = "scripts/finalize-full-guest-conversation.mjs";
  const anchor = `]) {
  const fullGuestExpectation =
`;
  const guard = `  const reasoningImpactSource = read(path);
  if (
    reasoningImpactSource.includes("add-reasoning-effort-impact.mjs") &&
    reasoningImpactSource.includes("reasoningImpactIndex > decisionGradeIndex")
  ) {
    continue;
  }
`;
  const corrected = `]) {
${guard}  const fullGuestExpectation =
`;
  const malformed = `]) {
  const fullGuestExpectation =
${guard}`;
  let source = await readFile(path, "utf8");
  if (source.includes(malformed)) {
    source = source.replace(malformed, corrected);
    await writeFile(path, source);
    console.log("Repaired the full-guest reasoning-impact compatibility guard.");
    return;
  }
  if (source.includes(corrected)) {
    console.log("The full-guest finalizer already accepts relative policy ordering.");
    return;
  }
  if (!source.includes(anchor)) {
    throw new Error(`Could not find the compatibility anchor in ${path}.`);
  }
  await writeFile(path, source.replace(anchor, corrected));
  console.log("Prepared the full-guest finalizer for relative reasoning-impact ordering.");
}

async function prepareClientResponseTimeGenerator() {
  const path = "scripts/apply-client-response-time.mjs";
  const anchor = "  if (source.includes(after)) return source;\n";
  const guard = `  if (
    label === "the privacy timing disclosure" &&
    source.includes("selected model and resolved") &&
    source.includes("foreground browser timing")
  ) {
    return source;
  }
`;
  let source = await readFile(path, "utf8");
  if (source.includes(guard)) {
    console.log("The client response-time generator already accepts reasoning privacy copy.");
    return;
  }
  if (!source.includes(anchor)) {
    throw new Error(`Could not find the compatibility anchor in ${path}.`);
  }
  await writeFile(path, source.replace(anchor, anchor + guard));
  console.log("Prepared the client response-time generator for reasoning privacy copy.");
}

await prepareRuntimeGenerator();
await prepareDecisionGradeGenerator();
await prepareFullGuestFinalizer();
await prepareClientResponseTimeGenerator();

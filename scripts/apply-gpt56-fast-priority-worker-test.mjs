import { readFile, writeFile } from "node:fs/promises";

const priorityPath = "test/priority-latency-worker.test.mjs";
const prioritySource = await readFile(priorityPath, "utf8");
const startMarker = `  const fastDefault = await stub.prepareChat({
`;
const endMarker = `  const free = await stub.prepareChat(options);
`;
const start = prioritySource.indexOf(startMarker);
const end = prioritySource.indexOf(endMarker, start + startMarker.length);

if (start >= 0) {
  if (end < 0 || end <= start) {
    throw new Error("Could not find the end of the obsolete fast-default assertion");
  }
  await writeFile(
    priorityPath,
    prioritySource.slice(0, start) + prioritySource.slice(end),
  );
}

const modelUsagePath = "test/model-usage-worker.test.mjs";
let modelUsageSource = await readFile(modelUsagePath, "utf8");
const singleCapture = `  let providerRequest;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    if (body.text?.verbosity === "low") providerRequest = body;
    return responseWithText("Use one reversible step.");
  };`;
const multiCapture = `  const providerRequests = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    if (body.text?.verbosity === "low") providerRequests.push(body);
    return responseWithText("Use one reversible step.");
  };`;
if (modelUsageSource.includes(singleCapture)) {
  modelUsageSource = modelUsageSource.replace(singleCapture, multiCapture);
}

const brittleAssertions = `    assert.equal(providerRequest.model, "gpt-5.6-sol");
    assert.equal(providerRequest.reasoning.effort, "none");
    assert.equal(providerRequest.service_tier, "fast");`;
const routedAssertions = `    const providerRequest = providerRequests.find(
      (candidate) =>
        candidate.model === "gpt-5.6-sol" &&
        candidate.service_tier === "fast",
    );
    assert.ok(providerRequest, "guest chat did not issue a GPT-5.6 Fast request");
    assert.equal(providerRequest.reasoning.effort, "none");`;
if (modelUsageSource.includes(brittleAssertions)) {
  modelUsageSource = modelUsageSource.replace(
    brittleAssertions,
    routedAssertions,
  );
}

const signedInCapture = `      providerRequests.push({ model: body.model, effort: body.reasoning.effort });`;
const signedInTierCapture = `      providerRequests.push({
        model: body.model,
        effort: body.reasoning.effort,
        tier: body.service_tier,
      });`;
if (modelUsageSource.includes(signedInCapture)) {
  modelUsageSource = modelUsageSource.replace(
    signedInCapture,
    signedInTierCapture,
  );
}

const signedInExpected = `      { model: "gpt-5.6-sol", effort: "none" },
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.4", effort: "none" },`;
const signedInTierExpected = `      { model: "gpt-5.6-sol", effort: "none", tier: "fast" },
      { model: "gpt-5.6-sol", effort: "high", tier: "fast" },
      { model: "gpt-5.4", effort: "none", tier: "fast" },`;
if (modelUsageSource.includes(signedInExpected)) {
  modelUsageSource = modelUsageSource.replace(
    signedInExpected,
    signedInTierExpected,
  );
}

await writeFile(modelUsagePath, modelUsageSource);

console.log("Aligned GPT-5.6 Fast Worker coverage with quota and explicit Fast tier.");

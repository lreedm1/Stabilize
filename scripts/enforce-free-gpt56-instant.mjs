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
    throw new Error(`Free Instant enforcement could not find ${label}`);
  }
}

await update("src/paid-worker.js", (source) => {
  let text = source;
  const helper = `async function requestWithReasoningEffort(request, effort) {
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request, {
    headers,
    body: JSON.stringify({ ...body, reasoningEffort: effort }),
  });
}

`;
  const paidChatMarker = "async function paidChatResponse(request, env, ctx) {";
  if (!text.includes("async function requestWithReasoningEffort(")) {
    requireText(text, paidChatMarker, "the paid chat handler");
    text = text.replace(paidChatMarker, helper + paidChatMarker);
  }

  const freeStart = text.indexOf('  const tier = "free";', text.indexOf(paidChatMarker));
  const freeEnd = text.indexOf("\n}\n\nconst worker =", freeStart);
  if (freeStart < 0 || freeEnd <= freeStart) {
    throw new Error("Free Instant enforcement could not isolate the free routing branch");
  }
  let freeSection = text.slice(freeStart, freeEnd);
  if (!freeSection.includes('const freeRequest = await requestWithReasoningEffort(')) {
    freeSection = freeSection.replace(
      '  const tier = "free";\n',
      '  const tier = "free";\n  const freeRequest = await requestWithReasoningEffort(request, "none");\n',
    );
  }
  freeSection = freeSection.replaceAll(
    `      request,
      modelEnvironment(env, fallbackModel),`,
    `      freeRequest,
      modelEnvironment(env, fallbackModel),`,
  );
  freeSection = freeSection.replaceAll(
    `    request,
    modelEnvironment(env, freeModel),`,
    `    freeRequest,
    modelEnvironment(env, freeModel),`,
  );
  text = text.slice(0, freeStart) + freeSection + text.slice(freeEnd);

  requireText(
    text,
    'const freeRequest = await requestWithReasoningEffort(request, "none")',
    "the forced Instant request",
  );
  requireText(text, "modelEnvironment(env, freeModel)", "the GPT-5.6 route");
  requireText(text, "modelEnvironment(env, fallbackModel)", "the GPT-5.4 route");
  return text;
});

await update(
  "test/model-usage-worker.test.mjs",
  (source) => {
    let text = source;
    text = text.replace(
      "    body: JSON.stringify({ message }),",
      '    body: JSON.stringify({ message, reasoningEffort: "high" }),',
    );
    requireText(
      text,
      'reasoningEffort: "high"',
      "the attempted free-plan reasoning override",
    );
    requireText(
      text,
      '{ model: "gpt-5.6-sol", effort: "none" }',
      "the enforced Instant expectation",
    );
    return text;
  },
  { optional: true },
);

await update(
  "test/model-limit-fallback.test.mjs",
  (source) => {
    let text = source;
    if (!text.includes("requestWithReasoningEffort")) {
      const marker = "  assert.match(workerSource, /const tier = \"free\"/);";
      requireText(text, marker, "the free-tier routing assertion");
      text = text.replace(
        marker,
        `${marker}\n  assert.match(workerSource, /requestWithReasoningEffort\\(request, \"none\"\\)/);`,
      );
    }
    return text;
  },
  { optional: true },
);

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    const path = "scripts/enforce-free-gpt56-instant.mjs";
    if (source.includes(`"${path}"`)) return source;
    const marker = '  "scripts/align-free-gpt56-tests.mjs",\n';
    requireText(source, marker, "the free-plan test-alignment fixture");
    return source.replace(marker, `${marker}  "${path}",\n`);
  },
  { optional: true },
);

console.log("Forced free-plan GPT-5.6 and GPT-5.4 routing to Instant.");

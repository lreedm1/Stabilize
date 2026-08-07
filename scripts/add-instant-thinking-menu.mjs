import { readFile, writeFile } from "node:fs/promises";

const MODEL_CHOICES = "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current";
const REASONING_ASSET_VERSION = "20260807-instant-thinking-1";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Instant-thinking update could not find ${label}`);
  }
}

await update("wrangler.jsonc", (source) => {
  let text = source;
  text = text.replace(
    /"OPENAI_REASONING_EFFORT"\s*:\s*"[^"]+"/,
    '"OPENAI_REASONING_EFFORT": "none"',
  );
  text = text.replace(
    /"MODEL_CHOICES"\s*:\s*"[^"]+"/,
    `"MODEL_CHOICES": "${MODEL_CHOICES}"`,
  );
  requireText(text, '"OPENAI_REASONING_EFFORT": "none"', "the instant default");
  requireText(text, `"MODEL_CHOICES": "${MODEL_CHOICES}"`, "the two-model catalog");
  return text;
});

await update("src/billing.js", (source) => {
  let text = source;
  const fallbackPattern =
    /const source = configured \|\| \[[\s\S]*?\n\s*\]\.join\(","\);/;
  if (fallbackPattern.test(text)) {
    text = text.replace(
      fallbackPattern,
      `const source = configured || [
    "gpt-5.4|GPT-5.4",
    "gpt-5.6-sol|Current",
  ].join(",");`,
    );
  }
  requireText(text, '"gpt-5.4|GPT-5.4"', "the GPT-5.4 fallback choice");
  requireText(text, '"gpt-5.6-sol|Current"', "the current fallback choice");
  return text;
});

await update("src/index.js", (source) => {
  let text = source;

  if (!text.includes('  "max",\n]);')) {
    const marker = '  "xhigh",\n]);';
    requireText(text, marker, "the reasoning-effort allow list");
    text = text.replace(marker, '  "xhigh",\n  "max",\n]);');
  }

  if (!text.includes("function requestedReasoningEffort(body, model)")) {
    const marker = "function openAIConfig(env) {";
    requireText(text, marker, "the OpenAI configuration helper");
    const helpers = `function requestedReasoningEffort(body, model) {
  const effort = String(body?.reasoningEffort || "none")
    .trim()
    .toLowerCase();
  if (!OPENAI_REASONING_EFFORTS.has(effort)) return "none";
  if (
    effort === "max" &&
    !/^gpt-5\\.6(?:-|$)/i.test(String(model || ""))
  ) {
    return "xhigh";
  }
  return effort;
}

function reasoningEnvironment(env, effort) {
  const selected = OPENAI_REASONING_EFFORTS.has(effort) ? effort : "none";
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "OPENAI_REASONING_EFFORT") return selected;
      return Reflect.get(target, property, receiver);
    },
  });
}

`;
    text = text.replace(marker, helpers + marker);
  }

  text = text.replace(
    /const reasoningEffort = String\(env\.OPENAI_REASONING_EFFORT \|\| "[^"]+"\);/,
    'const reasoningEffort = String(env.OPENAI_REASONING_EFFORT || "none");',
  );

  const bodyMarker = "  const body = await readBoundedJson(request);";
  if (!text.includes("requestedReasoningEffort(body, env.OPENAI_MODEL)")) {
    requireText(text, bodyMarker, "the chat request body");
    text = text.replace(
      bodyMarker,
      `${bodyMarker}
  env = reasoningEnvironment(
    env,
    requestedReasoningEffort(body, env.OPENAI_MODEL),
  );`,
    );
  }

  text = text.replace(
    /const turnReasoningEffort = selectReasoningEffort\(\{[\s\S]*?\n\s*\}\);/g,
    "const turnReasoningEffort = reasoningEffort;",
  );

  requireText(text, "function requestedReasoningEffort(body, model)", "the request effort validator");
  requireText(text, "function reasoningEnvironment(env, effort)", "the request effort environment");
  requireText(text, "requestedReasoningEffort(body, env.OPENAI_MODEL)", "the model-aware effort override");
  requireText(text, 'env.OPENAI_REASONING_EFFORT || "none"', "the instant fallback");
  requireText(text, '  "max",\n]);', "maximum reasoning support");
  requireText(text, 'return "xhigh";', "the GPT-5.4 maximum fallback");
  const directEffortCount =
    text.split("const turnReasoningEffort = reasoningEffort;").length - 1;
  if (directEffortCount !== 2) {
    throw new Error(
      `Instant-thinking update expected two exact-effort reply paths, found ${directEffortCount}`,
    );
  }
  return text;
});

await update("src/page.js", (source) => {
  let text = source;
  if (!text.includes('src="/reasoning-choice.js')) {
    const marker = "  </body>";
    requireText(text, marker, "the page body ending");
    text = text.replace(
      marker,
      `    <script type="module" src="/reasoning-choice.js?v=${REASONING_ASSET_VERSION}"></script>\n${marker}`,
    );
  }
  requireText(text, `reasoning-choice.js?v=${REASONING_ASSET_VERSION}`, "the reasoning client asset");
  return text;
});

await update("public/billing.css", (source) => {
  const marker = "/* Free thinking-level selector */";
  if (source.includes(marker)) return source;
  return `${source.trimEnd()}

${marker}
.thinking-choice {
  display: grid;
  gap: 7px;
  margin-top: 12px;
  border-top: 1px solid var(--line);
  padding-top: 11px;
}

.thinking-choice-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.thinking-choice label {
  color: var(--text);
  font-size: 0.76rem;
  font-weight: 760;
}

.thinking-choice-free {
  color: var(--accent-dark);
  font-size: 0.64rem;
  font-weight: 700;
}

.thinking-choice select {
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-strong);
  color: var(--text);
  padding: 8px 10px;
  font: inherit;
  font-size: 0.8rem;
}

.thinking-choice-description,
.billing-menu .thinking-choice-description,
.composer-model-panel .thinking-choice-description {
  margin: 0;
  color: var(--muted);
  font-size: 0.66rem;
  line-height: 1.4;
}

.composer-model-current {
  white-space: normal;
}
`;
});

const modelCatalogTest = `import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(\`../\${path}\`, import.meta.url), "utf8");

test("only GPT-5.4 and Current remain selectable, with instant responses by default", async () => {
  const [configText, billingSource, indexSource, pageSource, reasoningClient, packageSource] =
    await Promise.all([
      read("wrangler.jsonc"),
      read("src/billing.js"),
      read("src/index.js"),
      read("src/page.js"),
      read("public/reasoning-choice.js"),
      read("package.json"),
    ]);
  const config = JSON.parse(configText);

  assert.equal(config.vars.OPENAI_MODEL, "gpt-5.4");
  assert.equal(config.vars.OPENAI_REASONING_EFFORT, "none");
  assert.equal(
    config.vars.MODEL_CHOICES,
    "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
  );
  assert.deepEqual(
    config.vars.MODEL_CHOICES.split(",").map((entry) => entry.split("|")[0]),
    ["gpt-5.4", "gpt-5.6-sol"],
  );
  assert.doesNotMatch(
    config.vars.MODEL_CHOICES,
    /gpt-5-mini|gpt-5\\.1|luna|terra/i,
  );

  assert.match(billingSource, /"gpt-5\\.4\\|GPT-5\\.4"/);
  assert.match(billingSource, /"gpt-5\\.6-sol\\|Current"/);
  assert.match(indexSource, /function requestedReasoningEffort\\(body, model\\)/);
  assert.match(indexSource, /requestedReasoningEffort\\(body, env\\.OPENAI_MODEL\\)/);
  assert.match(indexSource, /effort === "max"/);
  assert.match(indexSource, /return "xhigh"/);
  assert.equal(
    (indexSource.match(/const turnReasoningEffort = reasoningEffort;/g) || []).length,
    2,
  );
  assert.match(pageSource, /reasoning-choice\\.js\\?v=20260807-instant-thinking-1/);

  for (const effort of ["none", "low", "medium", "high", "xhigh", "max"]) {
    assert.match(reasoningClient, new RegExp(\`value: "\${effort}"\`));
  }
  assert.match(reasoningClient, /Respond instantly/);
  assert.match(reasoningClient, /Think maximum \\(Current only\\)/);
  assert.match(reasoningClient, /Free at every level/);
  assert.match(reasoningClient, /CURRENT_MODEL_PATTERN/);
  assert.match(reasoningClient, /maximum\\.disabled = !enabled/);
  assert.match(reasoningClient, /body\\.reasoningEffort = reasoningEffort/);
  assert.match(packageSource, /add-instant-thinking-menu\\.mjs/);
});
`;

await update("test/model-catalog-usage.test.mjs", () => modelCatalogTest);

await update("test/worker.test.mjs", (source) =>
  source.replace(
    '      effort: "medium",\n      context: "current_turn",',
    '      effort: "none",\n      context: "current_turn",',
  ),
);

await update("test/openai-streaming-worker.test.mjs", (source) =>
  source.replace(
    'assert.deepEqual(request.reasoning, { effort: "medium" });',
    'assert.deepEqual(request.reasoning, { effort: "none" });',
  ),
);

console.log("Set instant responses by default and added free thinking levels.");

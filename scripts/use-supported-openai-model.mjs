import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_MODEL = "gpt-5.4";
const SOL_MODEL = "gpt-5.6-sol";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function testBlock(text, title) {
  const start = text.indexOf(`test("${title}"`);
  if (start < 0) return null;
  const next = text.indexOf('\ntest("', start + 6);
  const end = next < 0 ? text.length : next;
  return { start, end, text: text.slice(start, end) };
}

await update("src/index.js", (source) => {
  let text = source;
  const directConfig = `  const model = String(env.OPENAI_MODEL || "${DEFAULT_MODEL}");`;
  const legacyMapping = /  const configuredModel = String\(env\.OPENAI_MODEL \|\| "(?:gpt-5\.2|gpt-5\.6-sol)"\);\n  const model =\n    configuredModel === "gpt-5\.6-sol" \? "gpt-5\.2" : configuredModel;/;

  if (legacyMapping.test(text)) {
    text = text.replace(legacyMapping, directConfig);
  }
  for (const previous of ["gpt-5-mini", "gpt-5.6-sol", "gpt-5.2"]) {
    text = text.replaceAll(
      `String(env.OPENAI_MODEL || "${previous}")`,
      `String(env.OPENAI_MODEL || "${DEFAULT_MODEL}")`,
    );
  }

  if (!text.includes(directConfig)) {
    throw new Error("Could not establish the GPT-5.4 model configuration");
  }
  if (text.includes('configuredModel === "gpt-5.6-sol"')) {
    throw new Error("GPT-5.6 Sol is still mapped to an older model");
  }
  return text;
});

await update("src/billing.js", (source) => {
  let text = source;
  for (const previous of ["gpt-5-mini", "gpt-5.6-sol", "gpt-5.2"]) {
    text = text.replaceAll(
      `env.OPENAI_MODEL || "${previous}"`,
      `env.OPENAI_MODEL || "${DEFAULT_MODEL}"`,
    );
  }
  return text;
});

await update("test/worker.test.mjs", (source) => {
  let text = source;
  const title = "legacy internal model alias maps to the supported API model";
  const marker = 'test("rate limits return a retry time and a safe traceable error"';
  const existing = testBlock(text, title);

  if (!existing) {
    const compatibilityTest = `test("${title}", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Hi. What’s happening right now?");
  };

  try {
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hi" }),
      }),
      createEnv({
        DEMO_MODE: "false",
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_MODEL: ["gpt-5.6", "sol"].join("-"),
      }),
    );

    assert.equal(response.status, 200);
    await response.json();
    assert.equal(providerBody.model, "${SOL_MODEL}");
    assert.deepEqual(providerBody.reasoning, { effort: "max" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

`;
    if (!text.includes(marker)) {
      throw new Error("Could not find the worker-test insertion point");
    }
    text = text.replace(marker, compatibilityTest + marker);
  } else {
    const updated = existing.text.replace(
      /assert\.equal\(providerBody\.model, "(?:gpt-5\.2|gpt-5\.6-sol)"\);/,
      `assert.equal(providerBody.model, "${SOL_MODEL}");`,
    );
    text = text.slice(0, existing.start) + updated + text.slice(existing.end);
  }
  return text;
});

console.log(
  `Using ${DEFAULT_MODEL} as the default while preserving configured GPT-5.6 models.`,
);

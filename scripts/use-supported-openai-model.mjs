import { readFile, writeFile } from "node:fs/promises";

const LEGACY_MODEL = "gpt-5.6-sol";
const DEFAULT_MODEL = "gpt-5.2";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/index.js", (source) => {
  let text = source;
  const legacyConfig = `  const model = String(env.OPENAI_MODEL || "${LEGACY_MODEL}");`;
  const supportedConfig = `  const model = String(env.OPENAI_MODEL || "${DEFAULT_MODEL}");`;
  const normalizedConfig = `  const configuredModel = String(env.OPENAI_MODEL || "${DEFAULT_MODEL}");
  const model =
    configuredModel === "${LEGACY_MODEL}" ? "${DEFAULT_MODEL}" : configuredModel;`;

  if (text.includes(legacyConfig)) {
    text = text.replace(legacyConfig, normalizedConfig);
  } else if (text.includes(supportedConfig)) {
    text = text.replace(supportedConfig, normalizedConfig);
  } else if (!text.includes(`configuredModel === "${LEGACY_MODEL}"`)) {
    throw new Error("Could not find the OpenAI model configuration anchor");
  }

  text = text.replaceAll(
    `String(env.OPENAI_MODEL || "${LEGACY_MODEL}")`,
    `String(env.OPENAI_MODEL || "${DEFAULT_MODEL}")`,
  );

  if (
    !text.includes(`configuredModel === "${LEGACY_MODEL}"`) ||
    !text.includes(`? "${DEFAULT_MODEL}" : configuredModel`)
  ) {
    throw new Error("Legacy model compatibility mapping is missing");
  }
  return text;
});

for (const path of ["src/paid-worker.js", "src/billing.js", "wrangler.jsonc"]) {
  await update(path, (source) => source.replaceAll(LEGACY_MODEL, DEFAULT_MODEL));
}

await update("test/worker.test.mjs", (source) => {
  let text = source.replaceAll(LEGACY_MODEL, DEFAULT_MODEL);
  const marker = 'test("rate limits return a retry time and a safe traceable error"';

  if (!text.includes('test("legacy internal model alias maps to the supported API model"')) {
    const compatibilityTest = `test("legacy internal model alias maps to the supported API model", async () => {
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
        OPENAI_MODEL: "${LEGACY_MODEL}",
      }),
    );

    assert.equal(response.status, 200);
    await response.json();
    assert.equal(providerBody.model, "${DEFAULT_MODEL}");
    assert.deepEqual(providerBody.reasoning, { effort: "xhigh" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

`;
    if (!text.includes(marker)) {
      throw new Error("Could not find the worker-test insertion point");
    }
    text = text.replace(marker, compatibilityTest + marker);
  }
  return text;
});

console.log(`Using supported OpenAI model ${DEFAULT_MODEL} with ${LEGACY_MODEL} compatibility.`);

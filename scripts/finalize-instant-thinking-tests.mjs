import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceReasoningExpectation(source, title, effort) {
  const start = source.indexOf(`test("${title}"`);
  if (start < 0) {
    throw new Error(`Could not find instant-thinking test: ${title}`);
  }
  const next = source.indexOf('\ntest("', start + 6);
  const end = next < 0 ? source.length : next;
  const block = source.slice(start, end);
  const pattern =
    /assert\.deepEqual\(providerBody\.reasoning,\s*\{[\s\S]*?\}\);/;
  if (!pattern.test(block)) {
    throw new Error(`Could not find reasoning expectation in: ${title}`);
  }
  const updated = block.replace(
    pattern,
    `assert.deepEqual(providerBody.reasoning, { effort: "${effort}" });`,
  );
  return source.slice(0, start) + updated + source.slice(end);
}

await update("src/index.js", (source) => {
  const before =
    '    if (/^gpt-5\\.6(?:-|$)/.test(model)) return "xhigh";';
  const after =
    '    if (/^gpt-5\\.6(?:-|$)/.test(model)) return "max";';
  const text = source.replace(before, after);
  if (!text.includes(after)) {
    throw new Error("Could not retain maximum reasoning for Current");
  }
  return text;
});

await update("test/worker.test.mjs", (source) => {
  let text = replaceReasoningExpectation(
    source,
    "chat endpoint calls OpenAI with store enabled",
    "max",
  );
  text = replaceReasoningExpectation(
    text,
    "legacy internal model alias maps to the supported API model",
    "max",
  );
  text = replaceReasoningExpectation(
    text,
    "complex decisions use the strongest supported reasoning",
    "max",
  );
  return text;
});

await update("test/prompt-policy-idempotency.test.mjs", (source) => {
  let text = source;
  if (!text.includes('"scripts/prepare-instant-thinking-policy.mjs"')) {
    const marker = '  "scripts/prepare-openai-policy-pass.mjs",\n';
    if (!text.includes(marker)) {
      throw new Error("Could not locate the reasoning-policy preparation fixture");
    }
    text = text.replace(
      marker,
      `${marker}  "scripts/prepare-instant-thinking-policy.mjs",\n`,
    );
  }

  if (!text.includes('"scripts/finalize-instant-thinking-tests.mjs"')) {
    const marker = '  "scripts/add-instant-thinking-menu.mjs",\n';
    if (!text.includes(marker)) {
      throw new Error("Could not locate the instant-thinking fixture");
    }
    text = text.replace(
      marker,
      `${marker}  "scripts/finalize-instant-thinking-tests.mjs",\n`,
    );
  }
  return text;
});

console.log("Finalized exact instant-thinking behavior and fixtures.");

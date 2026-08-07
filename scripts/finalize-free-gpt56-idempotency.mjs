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

function occurrences(value, expected) {
  return value.split(expected).length - 1;
}

await update("src/paid-worker.js", (source) => {
  let text = source;
  const marker = "async function shouldRefundModelUsage(response) {";
  while (occurrences(text, marker) > 1) {
    const first = text.indexOf(marker);
    const second = text.indexOf(marker, first + marker.length);
    if (first < 0 || second <= first) {
      throw new Error("Could not isolate duplicate free-plan routing helpers");
    }
    text = text.slice(0, first) + text.slice(second);
  }
  if (occurrences(text, marker) !== 1) {
    throw new Error("Free-plan routing must contain exactly one helper set");
  }
  return text;
});

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    const path = "scripts/finalize-free-gpt56-idempotency.mjs";
    if (source.includes(`"${path}"`)) return source;
    const marker = '  "scripts/align-free-gpt56-tests.mjs",\n';
    if (!source.includes(marker)) {
      throw new Error("Could not find the free-plan test-alignment fixture");
    }
    return source.replace(marker, `${marker}  "${path}",\n`);
  },
  { optional: true },
);

console.log("Finalized repeatable free GPT-5.6 routing generation.");

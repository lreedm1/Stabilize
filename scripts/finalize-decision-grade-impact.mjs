import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceAllLiteral(source, before, after) {
  return source.includes(before) ? source.split(before).join(after) : source;
}

await update("src/chat-latency-events.js", (source) => {
  const marker =
    "  const resultPromise = parseChatResponse(analyticsCopy, startedAt).catch(() => ({";
  const comment =
    "  // Consume the cloned stream immediately so analytics cannot backpressure the visible response.\n";
  if (source.includes(comment)) return source;
  if (!source.includes(marker)) {
    throw new Error("Could not find the cloned-stream analytics boundary.");
  }
  return source.replace(marker, comment + marker);
});

await update("src/index.js", (source) => {
  let next = source;
  const marker = "async function generateReply(messages, route, env, latestText) {\n";
  const helper = `function neutralGreetingReply() {
  return "Hi. What’s happening right now?";
}

`;
  if (!next.includes(helper)) {
    if (!next.includes(marker)) {
      throw new Error("Could not find the JSON reply generator.");
    }
    next = next.replace(marker, helper + marker);
  }
  next = replaceAllLiteral(
    next,
    'validated = "Hi. What’s happening right now?";',
    "validated = neutralGreetingReply();",
  );
  next = replaceAllLiteral(
    next,
    'reply = "Hi. What’s happening right now?";',
    "reply = neutralGreetingReply();",
  );
  return next;
});

for (const path of [
  "test/account-preflight.test.mjs",
  "test/signed-in-prefetch-latency.test.mjs",
  "test/decision-grade-impact.test.mjs",
]) {
  await update(path, (source) =>
    source
      .replace(
        /\/finalize-account-preflight\\\.mjs\$\//gu,
        "/finalize-decision-grade-impact\\.mjs$/",
      )
      .replace(
        /\/apply-decision-grade-impact\\\.mjs\$\//gu,
        "/finalize-decision-grade-impact\\.mjs$/",
      ),
  );
}

await update("test/priority-latency.test.mjs", (source) =>
  source.replace(
    /cachedTokens: usageNumber\\\(inputDetails\\\.cached_tokens\\\)/gu,
    "cachedInputTokens: usageNumber\\(inputDetails\\.cached_tokens\\)",
  ),
);

await update("package.json", (source) => {
  const packageJson = JSON.parse(source);
  const finalizer = "node scripts/finalize-decision-grade-impact.mjs";
  const pipeline = packageJson.scripts["apply:prompt-policy"]
    .split(" && ")
    .filter(Boolean)
    .filter((entry) => entry !== finalizer);
  pipeline.push(finalizer);
  packageJson.scripts["apply:prompt-policy"] = pipeline.join(" && ");
  return JSON.stringify(packageJson, null, 2) + "\n";
});

console.log(
  "Finalized decision-grade impact compatibility and canonical regression expectations.",
);

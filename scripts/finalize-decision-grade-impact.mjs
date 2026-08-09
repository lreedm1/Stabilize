import { readFile, writeFile } from "node:fs/promises";

// Keep runtime and regression output canonical after every historical generator.
async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceAllLiteral(source, before, after) {
  return source.includes(before) ? source.split(before).join(after) : source;
}

function dedupeExactLines(source, exactLines) {
  const tracked = new Set(exactLines);
  const seen = new Set();
  const trailingNewline = source.endsWith("\n");
  const lines = source.split("\n").filter((line) => {
    if (!tracked.has(line)) return true;
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  });
  const joined = lines.join("\n");
  return trailingNewline && !joined.endsWith("\n") ? joined + "\n" : joined;
}

function allowMobileVideoCsp(source) {
  const next = source.replaceAll(
    "img-src 'self' data:; script-src 'self';",
    "img-src 'self' data:; media-src 'self' blob:; script-src 'self';",
  );
  if (!next.includes("media-src 'self' blob:")) {
    throw new Error("Could not enable the mobile-video media-src policy.");
  }
  return next;
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

for (const path of ["src/index.js", "src/impact-shards.js", "public/_headers"]) {
  await update(path, allowMobileVideoCsp);
}

for (const path of [
  "test/account-preflight.test.mjs",
  "test/signed-in-prefetch-latency.test.mjs",
  "test/decision-grade-impact.test.mjs",
]) {
  await update(path, (source) =>
    source
      .replace(
        /\/finalize-full-guest-conversation\\\.mjs\$\//gu,
        "/finalize-decision-grade-impact\\.mjs$/",
      )
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

await update("test/impact-measurement.test.mjs", (source) =>
  dedupeExactLines(source, [
    '    "First-token p50",',
    '    "First-token p95",',
    '    "Total-response p50",',
    '    "Total-response p95",',
    '    "Helpful conversations / $",',
    '    "Est. cost / helpful conversation",',
    '    "Pricing coverage",',
    "  assert.match(dashboard, /Latency breakdown/);",
    "  assert.match(dashboard, /Model and cost breakdown/);",
  ]),
);

await update("test/impact-worker.test.mjs", (source) =>
  dedupeExactLines(source, [
    "  assert.match(html, /Latency breakdown/);",
    "  assert.match(html, /Model and cost breakdown/);",
  ]),
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

// Historical generators can still rewrite the mobile background before this
// finalizer runs. Reapply the canvas implementation here so every build ends
// with the no-media-autoplay motion path, regardless of pipeline ordering.
await import("./apply-mobile-motion-canvas-v18.mjs");
await import("./fix-mobile-motion-canvas-v18.mjs");

await import("./apply-mobile-hd-background-v20.mjs");
await import("./fix-mobile-hd-module-scope-v20.mjs");

console.log(
  "Finalized decision-grade impact compatibility, mobile-video CSP, canonical regression expectations, and visibly opaque canvas mobile motion.",
);

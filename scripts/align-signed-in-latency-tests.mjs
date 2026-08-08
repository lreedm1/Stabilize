import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Signed-in latency alignment could not find ${label}`);
  }
  return source.replace(before, after);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const pipeline = String(packageJson.scripts?.["apply:prompt-policy"] || "");
if (!pipeline.includes("apply-signed-in-latency.mjs")) {
  throw new Error("Signed-in latency policy is absent from the package pipeline");
}

const scriptName =
  "(?:prepare-signed-in-latency|apply-priority-latency|apply-signed-in-latency|align-signed-in-latency-tests)\\.mjs";
const quotedPipeline = new RegExp(
  `"node scripts\\/${scriptName}(?: && node scripts\\/${scriptName})*"`,
  "g",
);

for (const name of await readdir("test")) {
  if (!name.endsWith(".mjs")) continue;
  const path = join("test", name);
  await update(path, (source) =>
    source.replace(quotedPipeline, JSON.stringify(pipeline)),
  );
}

await update("test/paid-model-choice.test.mjs", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `  assert.match(paidChat, /stub\\.prepareChat\\(chatPreparationOptions\\(env, body\\)\\)/);`,
    `  assert.match(
    paidChat,
    /stub\\s*\\.prepareChat\\(chatPreparationOptions\\(env, body\\)\\)/,
  );`,
    "the signed-in billing preparation assertion",
  );
  next = replaceRequired(
    next,
    `  assert.match(paidChat, /const \\[preparation, memory\\] = await Promise\\.all/);`,
    `  assert.match(
    paidChat,
    /const \\[billingResult, memoryResult\\] = await Promise\\.all/,
  );`,
    "the parallel billing and memory assertion",
  );
  next = next.replace(
    `/freeLimit[\\s\\S]*GPT-5\\.6 Instant messages/`,
    `/freeLimit[\\s\\S]*Current thinking messages/`,
  );
  next = next.replace(
    `/50 free GPT-5.6 Instant messages per UTC day/`,
    `/50 free Current thinking messages per UTC day/`,
  );
  if (!next.includes("config\\.freeModel === config\\.defaultModel")) {
    next = replaceRequired(
      next,
      `  assert.match(accountSource, /model: config\\.freeModel/);`,
      `  assert.match(accountSource, /config\\.freeModel === config\\.defaultModel/);
  assert.match(accountSource, /model: config\\.freeModel/);`,
      "the unmetered fast-default account assertion",
    );
  }
  return next;
});

await update("test/priority-latency.test.mjs", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `  assert.match(paidChat, /const \\[preparation, memory\\] = await Promise\\.all\\(\\[/);`,
    `  assert.match(
    paidChat,
    /const \\[billingResult, memoryResult\\] = await Promise\\.all\\(\\[/,
  );`,
    "the timed parallel preparation assertion",
  );
  next = replaceRequired(
    next,
    `  assert.match(paidChat, /stub\\.prepareChat\\(chatPreparationOptions\\(env\\)\\)/);`,
    `  assert.match(
    paidChat,
    /stub\\s*\\.prepareChat\\(chatPreparationOptions\\(env, body\\)\\)/,
  );`,
    "the body-aware billing preparation assertion",
  );
  if (!next.includes("X-Stabilize-Preparation-Ms")) {
    next = replaceRequired(
      next,
      `  assert.match(paidChat, /preparedChatResponse\\(/);`,
      `  assert.match(paidChat, /preparedChatResponse\\(/);
  assert.match(paidChat, /event: "signed_in_chat_prepared"/);
  assert.match(paidChat, /X-Stabilize-Preparation-Ms/);
  assert.match(paidChat, /Server-Timing/);`,
      "the signed-in preparation timing assertions",
    );
  }
  return next;
});

await update("test/sustainability.test.mjs", (source) =>
  source
    .replace(
      `/50 GPT-5\\.6 Instant\\s+messages per UTC day/i`,
      `/50 Current thinking\\s+messages per UTC day/i`,
    )
    .replace(
      `/50 GPT-5\\.6 Instant messages per UTC day/i`,
      `/50 Current thinking messages per UTC day/i`,
    ),
);

await update("public/sustainability.html", (source) =>
  source
    .replace(
      "Fifty automatic GPT-5.6 Instant messages per UTC day for signed-in free accounts, followed by continued access on GPT-5.4.",
      "GPT-5.4 Fastest responses plus fifty Current thinking messages per UTC day for signed-in free accounts.",
    )
    .replace(
      `Signed-in free accounts automatically receive 50 Current thinking messages per UTC day and then
            continue on GPT-5.4.`,
      `Signed-in free accounts use GPT-5.4 for Fastest response and receive 50 Current thinking messages per UTC day.`,
    ),
);

console.log("Aligned signed-in latency regression coverage and public model copy.");

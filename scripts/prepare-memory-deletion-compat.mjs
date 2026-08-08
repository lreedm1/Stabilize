import { readFile, writeFile } from "node:fs/promises";

async function read(path) {
  return readFile(path, "utf8");
}

async function write(path, source) {
  const current = await read(path);
  if (current === source) return false;
  await writeFile(path, source);
  return true;
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Could not locate ${label}`);
  }
  return source.replace(before, after);
}

async function registerPackageScripts() {
  const path = "package.json";
  const packageJson = JSON.parse(await read(path));
  const finalPass = "node scripts/apply-memory-deletion.mjs";

  if (!packageJson.scripts["apply:prompt-policy"].includes(finalPass)) {
    packageJson.scripts["apply:prompt-policy"] += ` && ${finalPass}`;
  }
  if (!packageJson.scripts["test:node"].includes("test/memory-deletion-ui.test.mjs")) {
    packageJson.scripts["test:node"] = packageJson.scripts["test:node"].replace(
      "node --test ",
      "node --test test/memory-deletion-ui.test.mjs ",
    );
  }
  if (!packageJson.scripts["test:worker"].includes("test/memory-deletion-worker.test.mjs")) {
    packageJson.scripts["test:worker"] +=
      " test/memory-deletion-worker.test.mjs";
  }

  return write(path, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function alignIdempotencyCoverage() {
  const path = "test/prompt-policy-idempotency.test.mjs";
  let source = await read(path);

  if (!source.includes('"scripts/apply-memory-deletion.mjs"')) {
    source = replaceRequired(
      source,
      '  "scripts/finalize-free-gpt56-repeat-shape.mjs",\n];',
      '  "scripts/finalize-free-gpt56-repeat-shape.mjs",\n  "scripts/apply-memory-deletion.mjs",\n];',
      "memory deletion idempotency script",
    );
  }
  if (!source.includes('  "PRIVACY.md",')) {
    source = replaceRequired(
      source,
      "const POLICY_TARGETS = [\n",
      'const POLICY_TARGETS = [\n  "PRIVACY.md",\n',
      "root privacy idempotency target",
    );
  }

  return write(path, source);
}

async function alignStreamingMaterializers() {
  const policyPath = "scripts/apply-streaming-policy.mjs";
  let policy = await read(policyPath);
  const oldPolicyCheck = String.raw`if (!workerAfter.includes("return streamChatReply(messages, route, env, latestText, stub, ctx);")) {
  throw new Error("Streaming policy did not replace the chat completion response");
}`;
  const newPolicyCheck = String.raw`const generationFencedStreamCompletion = \`    return streamChatReply(
      messages,
      route,
      env,
      latestText,
      stub,
      ctx,
      memory.generation,
    );\`;

if (
  !workerAfter.includes(
    "return streamChatReply(messages, route, env, latestText, stub, ctx);",
  ) &&
  !workerAfter.includes(generationFencedStreamCompletion)
) {
  throw new Error("Streaming policy did not replace the chat completion response");
}`;
  policy = replaceRequired(
    policy,
    oldPolicyCheck,
    newPolicyCheck,
    "generation-aware streaming policy check",
  );
  await write(policyPath, policy);

  const hardeningPath = "scripts/harden-openai-streaming.mjs";
  let hardening = await read(hardeningPath);
  const oldHardeningPattern =
    'const pattern = /async function\\* openAITextDeltas\\(result\\) \\{[\\s\\S]*?\\n\\}\\n\\nfunction streamChatReply\\(messages, route, env, latestText, stub, ctx\\) \\{[\\s\\S]*?\\n\\}\\n\\nasync function generateReply/;';
  const newHardeningPattern =
    'const pattern = /async function\\* openAITextDeltas\\(result\\) \\{[\\s\\S]*?\\n\\}\\n\\nfunction streamChatReply\\([\\s\\S]*?\\) \\{[\\s\\S]*?\\n\\}\\n\\nasync function generateReply/;';
  hardening = replaceRequired(
    hardening,
    oldHardeningPattern,
    newHardeningPattern,
    "generation-aware streaming hardening matcher",
  );
  await write(hardeningPath, hardening);
}

async function makeMemoryMaterializerCacheAgnostic() {
  const path = "scripts/apply-memory-deletion.mjs";
  let source = await read(path);
  const oldBlock = String.raw`  source = replaceRequired(
    source,
    \`<script type="module" src="/app.js?v=20260806-static-mobile-background-1"></script>\`,
    \`<script type="module" src="/app.js?v=20260807-memory-deletion-1"></script>\`,
    "memory deletion app cache bust",
  );`;
  const newBlock = String.raw`  if (!source.includes('src="/app.js?v=20260807-memory-deletion-1"')) {
    const next = source.replace(
      /<script type="module" src="\\/app\\.js\\?v=[^"]+"><\\/script>/,
      \`<script type="module" src="/app.js?v=20260807-memory-deletion-1"></script>\`,
    );
    if (next === source) {
      throw new Error("Could not locate memory deletion app cache bust");
    }
    source = next;
  }`;
  source = replaceRequired(
    source,
    oldBlock,
    newBlock,
    "cache-agnostic memory deletion materializer",
  );
  return write(path, source);
}

async function alignVersionedClientTests() {
  const paths = [
    "test/mobile-background-loading.test.mjs",
    "test/outcome-followup.test.mjs",
    "test/private-chat.test.mjs",
  ];

  for (const path of paths) {
    let source = await read(path);
    source = source.replaceAll(
      "20260806-static-mobile-background-1",
      "20260807-memory-deletion-1",
    );
    await write(path, source);
  }
}

async function alignNewConversationTest() {
  const path = "test/new-conversation.test.mjs";
  let source = await read(path);
  source = replaceRequired(
    source,
    '    memorySource.indexOf("  async getCompactionSnapshot()", start),',
    '    memorySource.indexOf("  clearRememberedContent()", start),',
    "new-conversation method boundary",
  );
  return write(path, source);
}

async function alignStreamingTest() {
  const path = "test/streaming-response.test.mjs";
  let source = await read(path);
  source = replaceRequired(
    source,
    'assert.match(workerSource, /await recordExchange\\(stub/);',
    'assert.match(workerSource, /await recordExchange\\(\\s*stub/);',
    "multiline recordExchange assertion",
  );
  source = replaceRequired(
    source,
    String.raw`    /return streamChatReply\(messages, route, env, latestText, stub, ctx\);/,
`,
    String.raw`    /return streamChatReply\([\s\S]*?messages,[\s\S]*?route,[\s\S]*?env,[\s\S]*?latestText,[\s\S]*?stub,[\s\S]*?ctx,[\s\S]*?memory\.generation,[\s\S]*?\);/,
`,
    "generation-fenced stream assertion",
  );
  return write(path, source);
}

async function alignDeletionUiTests() {
  const privacyPath = "test/memory-deletion-ui.test.mjs";
  let privacy = await read(privacyPath);
  privacy = replaceRequired(
    privacy,
    "  assert.match(publicPrivacy, /does not delete subscription or usage records/);",
    "  assert.match(\n    publicPrivacy,\n    /billing and usage records are separate and are not deleted/i,\n  );",
    "public privacy billing boundary assertion",
  );
  await write(privacyPath, privacy);

  const uiPath = "test/ui.test.mjs";
  let ui = await read(uiPath);
  const oldUiTest = String.raw`test("the site does not expose a remembered-context deletion control", async () => {
  const [clientScript, styles, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(clientScript, /forgetMemory|\/api\/session/);
  assert.doesNotMatch(styles, /forget-memory/);
  assert.doesNotMatch(pageSource, /forget-memory|forgetMemory/);
});`;
  const newUiTest = String.raw`test("signed-in users can delete remembered context without legacy session controls", async () => {
  const [clientScript, styles, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/product.css", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.match(clientScript, /fetch\("\/api\/account\/memory"/);
  assert.match(clientScript, /method: "DELETE"/);
  assert.match(styles, /\.memory-delete-control\s*\{/);
  assert.match(pageSource, /id="delete-memory-button"/);
  assert.doesNotMatch(clientScript, /forgetMemory|\/api\/session/);
  assert.doesNotMatch(styles, /forget-memory/);
  assert.doesNotMatch(pageSource, /forget-memory|forgetMemory/);
});`;
  ui = replaceRequired(
    ui,
    oldUiTest,
    newUiTest,
    "positive memory deletion UI regression",
  );
  return write(uiPath, ui);
}

const changes = await Promise.all([
  registerPackageScripts(),
  alignIdempotencyCoverage(),
  alignStreamingMaterializers(),
  makeMemoryMaterializerCacheAgnostic(),
  alignVersionedClientTests(),
  alignNewConversationTest(),
  alignStreamingTest(),
  alignDeletionUiTests(),
]);

console.log(
  changes.some(Boolean)
    ? "Prepared memory deletion compatibility and regression coverage."
    : "Memory deletion compatibility is already prepared.",
);

import { readFile, writeFile } from "node:fs/promises";

async function transform(path, update) {
  const before = await readFile(path, "utf8");
  const after = update(before);
  if (after !== before) await writeFile(path, after);
}

function replaceOrVerify(text, oldValue, newValue, label) {
  if (text.includes(oldValue)) return text.replace(oldValue, newValue);
  if (text.includes(newValue)) return text;
  throw new Error(`Prompt policy could not find ${label}`);
}

function replaceRegexOrVerify(text, pattern, replacement, verification, label) {
  if (pattern.test(text)) return text.replace(pattern, replacement);
  if (verification.test(text)) return text;
  throw new Error(`Prompt policy could not find ${label}`);
}

await transform("src/index.js", (source) => {
  let text = source;
  text = replaceOrVerify(
    text,
    "const MAX_BODY_BYTES = 32_000;\n",
    "",
    "the request-body cap",
  );
  text = replaceOrVerify(
    text,
    "const MAX_MESSAGE_CHARS = 4_000;\n",
    "",
    "the message-character cap",
  );
  text = replaceOrVerify(
    text,
    "// OpenAI counts visible output, hidden reasoning, and formatting tokens here.\nconst MAX_MODEL_OUTPUT_TOKENS = 500;\n",
    "",
    "the chat output-token cap",
  );
  text = replaceRegexOrVerify(
    text,
    /async function readBoundedJson\(request\) \{[\s\S]*?\n\}\n\n(?=function normalizeMessages)/,
    `async function readRequestJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, COPY.api.invalidJson);
  }
}

`,
    /async function readRequestJson\(request\)/,
    "the bounded JSON reader",
  );
  text = replaceOrVerify(
    text,
    'text: String(message.content || "").trim().slice(0, MAX_MESSAGE_CHARS),',
    'text: String(message.content || "").trim(),',
    "normalized-message truncation",
  );
  text = replaceRegexOrVerify(
    text,
    /previous\.text = \(previous\.text \+ "\\n" \+ message\.text\)\.slice\(\s*0,\s*MAX_MESSAGE_CHARS,\s*\);/,
    'previous.text = previous.text + "\\n" + message.text;',
    /previous\.text = previous\.text \+ "\\n" \+ message\.text;/,
    "same-role message truncation",
  );
  text = replaceOrVerify(
    text,
    "if (direct) return direct.slice(0, MAX_MESSAGE_CHARS);",
    "if (direct) return direct;",
    "direct-message truncation",
  );
  text = replaceOrVerify(
    text,
    'return String(latestUser?.content || "").trim().slice(0, MAX_MESSAGE_CHARS);',
    'return String(latestUser?.content || "").trim();',
    "conversation-message truncation",
  );
  text = replaceOrVerify(
    text,
    "readBoundedJson(request)",
    "readRequestJson(request)",
    "the bounded JSON reader call",
  );
  text = replaceOrVerify(
    text,
    "      max_output_tokens: MAX_MODEL_OUTPUT_TOKENS,\n",
    "",
    "the chat max-output field",
  );
  return text;
});

await transform("src/page.js", (source) => {
  let text = source;
  text = replaceRegexOrVerify(
    text,
    /\s+maxlength="4000"\n/,
    "\n",
    /id="message-input"[\s\S]*?placeholder=/,
    "the browser prompt limit",
  );
  text = text.replace(
    /\/app\.js\?v=[^"\s]+/,
    "/app.js?v=20260803-continuity-4",
  );
  return text;
});

await transform("src/copy.js", (source) => {
  const rule =
    "LENGTH: Keep ordinary responses to 500 words or fewer. When the user asks you to create, draft, expand, or revise a document, report, letter, bill, résumé, plan, brief, or other document-ready content, use the length needed to complete it well and do not apply the 500-word ceiling.";
  if (source.includes(rule)) return source;
  const anchor = "\n\nFINAL: Use the smallest sufficient intervention.";
  if (!source.includes(anchor)) throw new Error("Prompt policy could not find the final instruction");
  return source.replace(anchor, `\n\n${rule}${anchor}`);
});

await transform("test/worker.test.mjs", (source) => {
  let text = source;
  text = replaceOrVerify(
    text,
    "    assert.equal(providerBody.max_output_tokens, 500);",
    '    assert.equal("max_output_tokens" in providerBody, false);',
    "the old chat output assertion",
  );

  const instructionAnchor =
    "    assert.match(providerBody.instructions, /Systems > willpower/i);";
  const instructionChecks = `${instructionAnchor}
    assert.match(providerBody.instructions, /500 words or fewer/i);
    assert.match(providerBody.instructions, /document-ready content/i);`;
  if (!text.includes("/500 words or fewer/i")) {
    if (!text.includes(instructionAnchor)) throw new Error("Missing instruction test anchor");
    text = text.replace(instructionAnchor, instructionChecks);
  }

  if (!text.includes('test("chat forwards long prompts without app-level truncation"')) {
    const marker = 'test("rate limits return a retry time and a safe traceable error"';
    const longPromptTest = `test("chat forwards long prompts without app-level truncation", async () => {
  const originalFetch = globalThis.fetch;
  let providerBody;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(init.body);
    return responseWithText("Received the full request.");
  };

  try {
    const longMessage = "Long prompt detail. ".repeat(700);
    const response = await worker.fetch(
      new Request("https://stabilize.test/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: longMessage }),
      }),
      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),
    );

    assert.equal(response.status, 200);
    assert.equal(providerBody.input.at(-1).content, longMessage.trim());
    assert.ok(providerBody.input.at(-1).content.length > 4_000);
    assert.equal("max_output_tokens" in providerBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

`;
    if (!text.includes(marker)) throw new Error("Missing worker test insertion point");
    text = text.replace(marker, longPromptTest + marker);
  }
  return text;
});

await transform("test/prompt-submit.test.mjs", (source) => {
  if (source.includes('test("prompt and reply lengths use instructions rather than app hard caps"')) {
    return source;
  }
  return `${source}

test("prompt and reply lengths use instructions rather than app hard caps", async () => {
  const [pageSource, workerSource, copySource] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/copy.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(pageSource, /maxlength="4000"/);
  assert.doesNotMatch(workerSource, /MAX_BODY_BYTES|MAX_MESSAGE_CHARS|MAX_MODEL_OUTPUT_TOKENS/);
  assert.match(copySource, /Keep ordinary responses to 500 words or fewer/);
  assert.match(copySource, /document-ready content/);
  assert.match(copySource, /do not apply the 500-word ceiling/);
});
`;
});

console.log("Applied uncapped prompt and 500-word response policy.");

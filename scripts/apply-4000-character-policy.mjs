import { readFile, writeFile } from "node:fs/promises";

const MAX_MESSAGE_CHARS = 4_000;

async function transform(path, update) {
  const before = await readFile(path, "utf8");
  const after = update(before);
  if (after !== before) await writeFile(path, after);
}

function replaceOrVerify(text, oldValue, newValue, verification, label) {
  if (text.includes(oldValue)) return text.replace(oldValue, newValue);
  if (verification.test(text)) return text;
  throw new Error(`4,000-character policy could not find ${label}`);
}

await transform("src/index.js", (source) => {
  let text = source;

  // Keep the input cap, but reject oversized messages rather than silently
  // cutting them down before classification or model submission.
  text = replaceOrVerify(
    text,
    "if (direct) return direct.slice(0, MAX_MESSAGE_CHARS);",
    "if (direct) return direct;",
    /if \(direct\) return direct;/,
    "the direct-message reader",
  );
  text = replaceOrVerify(
    text,
    'return String(latestUser?.content || "").trim().slice(0, MAX_MESSAGE_CHARS);',
    'return String(latestUser?.content || "").trim();',
    /return String\(latestUser\?\.content \|\| ""\)\.trim\(\);/,
    "the conversation-message reader",
  );

  const requiredCheck =
    "  if (!latestText) throw new HttpError(400, COPY.api.messageRequired);";
  const limitCheck = `${requiredCheck}\n  if (latestText.length > MAX_MESSAGE_CHARS) {\n    throw new HttpError(400, COPY.api.messageTooLong);\n  }`;
  if (!text.includes("latestText.length > MAX_MESSAGE_CHARS")) {
    if (!text.includes(requiredCheck)) {
      throw new Error("4,000-character policy could not find the chat validation anchor");
    }
    text = text.replace(requiredCheck, limitCheck);
  }

  // Do not use a tight API output ceiling: hidden reasoning shares that budget
  // with the visible answer. Written verbosity rules control ordinary length.
  text = text.replace(
    "// OpenAI counts visible output, hidden reasoning, and formatting tokens here.\nconst MAX_MODEL_OUTPUT_TOKENS = 500;\n",
    "",
  );
  text = text.replace(
    "      max_output_tokens: MAX_MODEL_OUTPUT_TOKENS,\n",
    "",
  );

  if (!text.includes("const MAX_MESSAGE_CHARS = 4_000;")) {
    throw new Error("The server-side 4,000-character constant is missing");
  }
  return text;
});

await transform("src/page.js", (source) => {
  let text = source;
  if (!/id="message-input"[\s\S]*?maxlength="4000"/.test(text)) {
    const anchor = '                rows="2"\n';
    if (!text.includes(anchor)) {
      throw new Error("4,000-character policy could not find the textarea rows attribute");
    }
    text = text.replace(anchor, `${anchor}                maxlength="4000"\n`);
  }
  text = text.replace(
    /\/app\.js\?v=[^"\s]+/,
    "/app.js?v=20260803-continuity-7",
  );
  return text;
});

await transform("src/copy.js", (source) => {
  let text = source;

  if (!text.includes("messageTooLong:")) {
    const anchor = '    messageRequired: "Please enter a message.",';
    if (!text.includes(anchor)) {
      throw new Error("4,000-character policy could not find the API message anchor");
    }
    text = text.replace(
      anchor,
      `${anchor}\n    messageTooLong: "Please keep your message to 4,000 characters or fewer.",`,
    );
  }

  const lengthRule =
    "LENGTH: Keep ordinary responses to 220 words or fewer. When the user asks you to create, draft, expand, or revise a document, report, letter, bill, résumé, plan, brief, or other document-ready content, use the length needed to complete it well and do not apply the 220-word ceiling.";
  if (!text.includes(lengthRule)) {
    const anchor = "\n\nFINAL: Use the smallest sufficient intervention.";
    if (!text.includes(anchor)) {
      throw new Error("4,000-character policy could not find the final model instruction");
    }
    text = text.replace(anchor, `\n\n${lengthRule}${anchor}`);
  }
  return text;
});

await transform("test/worker.test.mjs", (source) => {
  let text = source;

  text = text.replace(
    "    assert.equal(providerBody.max_output_tokens, 500);",
    '    assert.equal("max_output_tokens" in providerBody, false);',
  );

  const instructionAnchor =
    "    assert.match(providerBody.instructions, /Systems > willpower/i);";
  if (!text.includes("/220 words or fewer/i")) {
    if (!text.includes(instructionAnchor)) {
      throw new Error("4,000-character policy could not find the instruction assertion anchor");
    }
    text = text.replace(
      instructionAnchor,
      `${instructionAnchor}\n    assert.match(providerBody.instructions, /220 words or fewer/i);\n    assert.match(providerBody.instructions, /document-ready content/i);`,
    );
  }
  text = text.replaceAll("/500 words or fewer/i", "/220 words or fewer/i");
  text = text.replaceAll("500-word ceiling", "220-word ceiling");

  if (!text.includes('test("chat rejects messages over 4,000 characters"')) {
    const marker = 'test("rate limits return a retry time and a safe traceable error"';
    const limitTest = `test("chat rejects messages over 4,000 characters", async () => {\n  const originalFetch = globalThis.fetch;\n  let providerCalled = false;\n  globalThis.fetch = async () => {\n    providerCalled = true;\n    return responseWithText("This should not be called.");\n  };\n\n  try {\n    const response = await worker.fetch(\n      new Request("https://stabilize.test/api/chat", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ message: "a".repeat(${MAX_MESSAGE_CHARS + 1}) }),\n      }),\n      createEnv({ DEMO_MODE: "false", OPENAI_API_KEY: "test-openai-key" }),\n    );\n\n    assert.equal(response.status, 400);\n    assert.equal((await response.json()).error, COPY.api.messageTooLong);\n    assert.equal(providerCalled, false);\n  } finally {\n    globalThis.fetch = originalFetch;\n  }\n});\n\n`;
    if (!text.includes(marker)) {
      throw new Error("4,000-character policy could not find the worker test insertion point");
    }
    text = text.replace(marker, limitTest + marker);
  }
  return text;
});

await transform("test/prompt-submit.test.mjs", (source) => {
  let text = source
    .replaceAll("Keep ordinary responses to 500 words or fewer", "Keep ordinary responses to 220 words or fewer")
    .replaceAll("do not apply the 500-word ceiling", "do not apply the 220-word ceiling");

  if (text.includes('test("the prompt limit is 4,000 characters"')) return text;
  return `${text}\n\ntest("the prompt limit is 4,000 characters", async () => {\n  const [pageSource, workerSource, copySource] = await Promise.all([\n    readFile(new URL("../src/page.js", import.meta.url), "utf8"),\n    readFile(new URL("../src/index.js", import.meta.url), "utf8"),\n    readFile(new URL("../src/copy.js", import.meta.url), "utf8"),\n  ]);\n\n  assert.match(pageSource, /id="message-input"[\\s\\S]*maxlength="4000"/);\n  assert.match(workerSource, /const MAX_MESSAGE_CHARS = 4_000/);\n  assert.match(workerSource, /latestText.length > MAX_MESSAGE_CHARS/);\n  assert.match(copySource, /Please keep your message to 4,000 characters or fewer/);\n  assert.doesNotMatch(workerSource, /MAX_MODEL_OUTPUT_TOKENS/);\n  assert.match(copySource, /Keep ordinary responses to 220 words or fewer/);\n  assert.match(copySource, /do not apply the 220-word ceiling/);\n});\n`;
});

console.log("Applied the 4,000-character prompt limit and 220-word response policy.");

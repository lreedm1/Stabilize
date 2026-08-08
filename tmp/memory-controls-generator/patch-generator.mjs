import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2] || "scripts/add-memory-deletion-and-guest-session.mjs";
let source = readFileSync(path, "utf8");

const target = "The signed HttpOnly cookie contains";
const replacement = "The signed \\`HttpOnly\\` cookie contains";
if (!source.includes(target) && !source.includes(replacement)) {
  throw new Error("Could not locate the README HttpOnly generator anchor");
}
source = source.split(target).join(replacement);

const compatibilityMarker = 'const readmePath = "README.md";\n';
const compatibilityBlock = `replaceOnce(\n  "scripts/apply-streaming-policy.mjs",\n  \`if (!workerAfter.includes("return streamChatReply(messages, route, env, latestText, stub, ctx);")) {\\n  throw new Error("Streaming policy did not replace the chat completion response");\\n}\`,\n  \`const hasExistingStreamingCall =\\n  workerAfter.includes("function streamChatReply(") &&\\n  workerAfter.includes("return streamChatReply(") &&\\n  workerAfter.includes("application/x-ndjson");\\n\\nif (\\n  !workerAfter.includes(\\n    "return streamChatReply(messages, route, env, latestText, stub, ctx);",\\n  ) &&\\n  !hasExistingStreamingCall\\n) {\\n  throw new Error("Streaming policy did not replace the chat completion response");\\n}\`,\n  "streaming memory-generation compatibility",\n);\n\nreplaceOnce(\n  "scripts/harden-openai-streaming.mjs",\n  \`function streamChatReply(messages, route, env, latestText, stub, ctx) {\\n\`,\n  \`function streamChatReply(\\n  messages,\\n  route,\\n  env,\\n  latestText,\\n  stub,\\n  memoryGeneration,\\n  ctx,\\n) {\\n\`,\n  "hardened stream memory-generation signature",\n);\nreplaceOnce(\n  "scripts/harden-openai-streaming.mjs",\n  \`      const recordResult = await recordExchange(stub, {\\n        user: latestText,\\n        assistant: validated,\\n        awaitingSafetyAnswer: false,\\n      });\\n\`,\n  \`      const recordResult = await recordExchange(stub, {\\n        user: latestText,\\n        assistant: validated,\\n        awaitingSafetyAnswer: false,\\n        expectedGeneration: memoryGeneration,\\n      });\\n\`,\n  "hardened stream stale-write guard",\n);\nreplaceOnce(\n  "scripts/harden-openai-streaming.mjs",\n  \`function streamChatReply\\\\(messages, route, env, latestText, stub, ctx\\\\)\`,\n  \`function streamChatReply\\\\([\\\\s\\\\S]*?\\\\)\\\\s*\`,\n  "hardened stream signature matcher",\n);\n\n`;
if (!source.includes(compatibilityBlock)) {
  if (!source.includes(compatibilityMarker)) {
    throw new Error("Could not locate the streaming compatibility insertion point");
  }
  source = source.replace(
    compatibilityMarker,
    compatibilityBlock + compatibilityMarker,
  );
}

writeFileSync(path, source, "utf8");

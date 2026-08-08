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
const compatibilityBlock = `replaceOnce(\n  "scripts/apply-streaming-policy.mjs",\n  \`if (!workerAfter.includes("return streamChatReply(messages, route, env, latestText, stub, ctx);")) {\\n\`,\n  \`if (\n  !workerAfter.includes(\n    "return streamChatReply(messages, route, env, latestText, stub, ctx);",\n  ) &&\n  !workerAfter.includes(\n    "return streamChatReply(messages, route, env, latestText, stub, memory.generation, ctx);",\n  )\n) {\\n\`,\n  "streaming memory-generation compatibility",\n);\n\n`;
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

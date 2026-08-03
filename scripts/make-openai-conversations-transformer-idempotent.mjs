import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/apply-openai-conversations.mjs";
const source = await readFile(path, "utf8");

const nonIdempotent = `function replaceRequired(text, oldValue, newValue, verification, label) {
  if (text.includes(oldValue)) return text.replace(oldValue, newValue);
  if (verification?.test(text)) return text;
  throw new Error(\`Conversations migration could not find \${label}\`);
}`;

const idempotent = `function replaceRequired(text, oldValue, newValue, verification, label) {
  if (verification?.test(text)) return text;
  if (text.includes(oldValue)) return text.replace(oldValue, newValue);
  throw new Error(\`Conversations migration could not find \${label}\`);
}`;

if (source.includes(idempotent)) {
  console.log("OpenAI Conversations transformer is already idempotent.");
} else if (source.includes(nonIdempotent)) {
  await writeFile(path, source.replace(nonIdempotent, idempotent));
  console.log("Made the OpenAI Conversations transformer idempotent.");
} else {
  throw new Error("Could not find the Conversations transformer replacement helper");
}

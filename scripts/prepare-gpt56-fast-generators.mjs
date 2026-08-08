import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/add-memory-deletion-and-guest-session.mjs";
const before = await readFile(path, "utf8");
const original = `replaceOnce(
  readmePath,
  \`- **Guest:** ordinary chats use GPT-5.4. Guest chats do not use Stabilize account memory.\\n\`,
  \`- **Guest:** ordinary chats use GPT-5.4. A bounded recent transcript stays in the current browser tab and is sent with follow-ups, but it does not use Stabilize account memory.\\n\`,
  "README guest model behavior",
);`;
const replacement = `if (
  !read(readmePath).includes(
    "- **Guest:** ordinary chats begin on GPT-5.6 Fast.",
  )
) {
  replaceOnce(
    readmePath,
    \`- **Guest:** ordinary chats use GPT-5.4. Guest chats do not use Stabilize account memory.\\n\`,
    \`- **Guest:** ordinary chats use GPT-5.4. A bounded recent transcript stays in the current browser tab and is sent with follow-ups, but it does not use Stabilize account memory.\\n\`,
    "README guest model behavior",
  );
}`;

if (!before.includes(replacement)) {
  if (!before.includes(original)) {
    throw new Error("Could not find the legacy README guest-model generator");
  }
  await writeFile(path, before.replace(original, replacement));
}

console.log("Prepared legacy generators for GPT-5.6 Fast-first copy.");

import { readFile, writeFile } from "node:fs/promises";

const memoryGeneratorPath = "scripts/add-memory-deletion-and-guest-session.mjs";
const memoryBefore = await readFile(memoryGeneratorPath, "utf8");
const originalMemoryBlock = `replaceOnce(
  readmePath,
  \`- **Guest:** ordinary chats use GPT-5.4. Guest chats do not use Stabilize account memory.\\n\`,
  \`- **Guest:** ordinary chats use GPT-5.4. A bounded recent transcript stays in the current browser tab and is sent with follow-ups, but it does not use Stabilize account memory.\\n\`,
  "README guest model behavior",
);`;
const compatibleMemoryBlock = `if (
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

if (!memoryBefore.includes(compatibleMemoryBlock)) {
  if (!memoryBefore.includes(originalMemoryBlock)) {
    throw new Error("Could not find the legacy README guest-model generator");
  }
  await writeFile(
    memoryGeneratorPath,
    memoryBefore.replace(originalMemoryBlock, compatibleMemoryBlock),
  );
}

const alignmentPath = "scripts/align-signed-in-latency-v2.mjs";
const alignmentBefore = await readFile(alignmentPath, "utf8");
const oldGuard = `  if (source.includes('test("a free signed-in user gets GPT-5.4 instantly and Current when thinking"')) {
    return source;
  }`;
const compatibleGuard = `  if (
    source.includes(
      'test("a free signed-in user gets GPT-5.4 instantly and Current when thinking"',
    ) ||
    source.includes(
      'test("a free signed-in user gets GPT-5.6 Fast before GPT-5.4 fallback"',
    )
  ) {
    return source;
  }`;

if (!alignmentBefore.includes(compatibleGuard)) {
  if (!alignmentBefore.includes(oldGuard)) {
    throw new Error("Could not find the legacy free signed-in Worker test guard");
  }
  await writeFile(
    alignmentPath,
    alignmentBefore.replace(oldGuard, compatibleGuard),
  );
}

console.log("Prepared legacy generators for GPT-5.6 Fast-first routing and copy.");

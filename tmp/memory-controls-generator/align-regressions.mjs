import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) return;
  await writeFile(path, after, "utf8");
}

function replaceRequired(text, oldText, newText, label, path) {
  if (text.includes(newText)) return text;
  if (!text.includes(oldText)) {
    throw new Error(`Could not align ${label} in ${path}`);
  }
  return text.replace(oldText, newText);
}

const basePipeline = '"node scripts/apply-priority-latency.mjs",';
const completePipeline =
  '"node scripts/apply-priority-latency.mjs && node scripts/add-memory-deletion-and-guest-session.mjs",';

for (const path of [
  "test/composer-chat-sections.test.mjs",
  "test/composer-placeholder-alignment.test.mjs",
  "test/daily-usage-dashboard.test.mjs",
  "test/model-catalog-usage.test.mjs",
  "test/navigation-model-placement.test.mjs",
  "test/paid-model-choice.test.mjs",
]) {
  await update(path, (text) =>
    replaceRequired(text, basePipeline, completePipeline, "policy pipeline", path),
  );
}

const oldAppAssetPattern =
  "app\\.js\\?v=20260807-priority-latency-1";
const memoryAppAssetPattern =
  "app\\.js\\?v=20260808-memory-controls-1";

for (const path of [
  "test/mobile-background-loading.test.mjs",
  "test/outcome-followup.test.mjs",
  "test/priority-latency.test.mjs",
  "test/private-chat.test.mjs",
]) {
  await update(path, (text) =>
    replaceRequired(
      text,
      oldAppAssetPattern,
      memoryAppAssetPattern,
      "memory-aware app asset",
      path,
    ),
  );
}

await update("test/new-conversation.test.mjs", (text) => {
  const oldScope = `  const newConversationMethod = memorySource.slice(
    memorySource.indexOf("async startNewConversation()"),
    memorySource.indexOf("async getCompactionSnapshot()"),
  );`;
  const newScope = `  const newConversationStart = memorySource.indexOf(
    "async startNewConversation()",
  );
  const deleteMemoryStart = memorySource.indexOf(
    "async deleteRememberedContext()",
    newConversationStart,
  );
  const compactionStart = memorySource.indexOf(
    "async getCompactionSnapshot()",
    newConversationStart,
  );
  const newConversationEnd =
    deleteMemoryStart > newConversationStart
      ? deleteMemoryStart
      : compactionStart;
  const newConversationMethod = memorySource.slice(
    newConversationStart,
    newConversationEnd,
  );`;
  return replaceRequired(
    text,
    oldScope,
    newScope,
    "new-conversation method boundary",
    "test/new-conversation.test.mjs",
  );
});

await update("test/product.test.mjs", (text) =>
  replaceRequired(
    text,
    "/included with later guest messages/i",
    "/included with later guest\\s+messages/i",
    "wrapped guest-memory disclosure",
    "test/product.test.mjs",
  ),
);

console.log("Aligned memory-control regression expectations.");

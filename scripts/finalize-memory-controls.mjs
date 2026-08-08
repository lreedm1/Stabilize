import { readFile, writeFile } from "node:fs/promises";

const workerPath = "src/index.js";
const before = await readFile(workerPath, "utf8");
let after = before;

const preparedChatExport = "export async function preparedChatResponse(";
if (!after.includes(preparedChatExport)) {
  const anchor = "function authNotice(code) {";
  if (!after.includes(anchor)) {
    throw new Error("Could not locate the prepared-chat export anchor");
  }

  const wrapper = `export async function preparedChatResponse(
  request,
  body,
  env,
  ctx,
  accountKey,
  preparedMemory,
) {
  try {
    return await handlePreparedChat(
      request,
      env,
      ctx,
      accountKey,
      body,
      preparedMemory,
    );
  } catch (error) {
    return chatErrorResponse(error, new URL(request.url).pathname);
  }
}

`;
  after = after.replace(anchor, wrapper + anchor);
}

for (const required of [
  "export async function handlePreparedChat(",
  preparedChatExport,
]) {
  if (!after.includes(required)) {
    throw new Error(`Memory-control finalization is missing ${required}`);
  }
}

if (after !== before) await writeFile(workerPath, after, "utf8");
console.log("Finalized the memory-aware prepared-chat export.");

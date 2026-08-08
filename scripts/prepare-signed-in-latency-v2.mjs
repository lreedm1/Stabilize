import { readFile, writeFile } from "node:fs/promises";

const priorityPath = "scripts/apply-priority-latency.mjs";
const before = await readFile(priorityPath, "utf8");
const oldGuard = `  if (!next.includes("stub.prepareChat(chatPreparationOptions(env))")) {`;
const newGuard = `  if (
    !next.includes("stub.prepareChat(chatPreparationOptions(env))") &&
    !next.includes(".prepareChat(chatPreparationOptions(env, body))")
  ) {`;

if (!before.includes(oldGuard) && !before.includes(newGuard)) {
  throw new Error("Could not find the priority paid-chat idempotency guard");
}
const after = before.includes(oldGuard)
  ? before.replace(oldGuard, newGuard)
  : before;
if (after !== before) await writeFile(priorityPath, after);

console.log("Prepared the priority generator for signed-in latency changes.");

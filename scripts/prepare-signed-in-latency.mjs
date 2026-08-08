import { readFile, writeFile } from "node:fs/promises";

const priorityPath = "scripts/apply-priority-latency.mjs";
const priorityBefore = await readFile(priorityPath, "utf8");
const oldGuard = `  if (!next.includes("stub.prepareChat(chatPreparationOptions(env))")) {`;
const newGuard = `  if (
    !next.includes("stub.prepareChat(chatPreparationOptions(env))") &&
    !next.includes(".prepareChat(chatPreparationOptions(env, body))")
  ) {`;

if (!priorityBefore.includes(oldGuard) && !priorityBefore.includes(newGuard)) {
  throw new Error("Could not find the priority paid-chat idempotency guard");
}
const priorityAfter = priorityBefore.includes(oldGuard)
  ? priorityBefore.replace(oldGuard, newGuard)
  : priorityBefore;
if (priorityAfter !== priorityBefore) {
  await writeFile(priorityPath, priorityAfter);
}

const signedPolicyPath = "scripts/apply-signed-in-latency.mjs";
const signedBefore = await readFile(signedPolicyPath, "utf8");
const oldPaidWorkerGenerator = `await update("test/paid-worker.test.mjs", (source) => {
  const replacement =`;
const newPaidWorkerGenerator = `await update("test/paid-worker.test.mjs", (source) => {
  if (
    source.includes(
      'test("a free signed-in user gets GPT-5.4 instantly and Current when thinking"',
    )
  ) {
    return source;
  }
  const replacement =`;
if (
  !signedBefore.includes(oldPaidWorkerGenerator) &&
  !signedBefore.includes(newPaidWorkerGenerator)
) {
  throw new Error("Could not find the signed-in paid Worker test generator");
}
const signedAfter = signedBefore.includes(oldPaidWorkerGenerator)
  ? signedBefore.replace(oldPaidWorkerGenerator, newPaidWorkerGenerator)
  : signedBefore;
if (signedAfter !== signedBefore) {
  await writeFile(signedPolicyPath, signedAfter);
}

console.log("Prepared the canonical generators for signed-in latency changes.");

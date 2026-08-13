import { readFile, writeFile } from "node:fs/promises";

const workerPath = "src/index.js";
const workerBefore = await readFile(workerPath, "utf8");
let workerAfter = workerBefore;

workerAfter = workerAfter.replace(
  "  if (!schedule(ctx, produce())) void produce();",
  "  const task = produce();\n  if (!schedule(ctx, task)) void task;",
);

const streamOnly =
  "  return streamChatReply(messages, route, env, latestText, stub, ctx);";
const compatibleCompletion = `  const acceptsStreaming = (request.headers.get("accept") || "")
    .toLowerCase()
    .includes("application/x-ndjson");
  if (acceptsStreaming) {
    return streamChatReply(messages, route, env, latestText, stub, ctx);
  }

  const reply = await generateReply(messages, route, env, latestText);
  const result = await recordExchange(stub, {
    user: latestText,
    assistant: reply,
    awaitingSafetyAnswer: false,
  });

  if (result?.shouldCompact && stub && ctx) {
    schedule(ctx, compactSession(stub, env));
  }

  return jsonResponse({
    route,
    reply,
    showEmergency: false,
    awaitingSafetyAnswer: false,
  });`;

if (workerAfter.includes(streamOnly)) {
  workerAfter = workerAfter.replace(streamOnly, compatibleCompletion);
}

if (
  !workerAfter.includes("const acceptsStreaming =") ||
  !workerAfter.includes("const task = produce();")
) {
  throw new Error("Streaming compatibility policy did not apply");
}

if (workerAfter !== workerBefore) await writeFile(workerPath, workerAfter);

const clientPath = "public/app.js";
const clientBefore = await readFile(clientPath, "utf8");
let clientAfter = clientBefore;

clientAfter = clientAfter.replace(
  '      headers: { "Content-Type": "application/json" },',
  '      headers: {\n        "Content-Type": "application/json",\n        Accept: "application/x-ndjson, application/json",\n      },',
);

if (!clientAfter.includes('Accept: "application/x-ndjson, application/json"')) {
  throw new Error("Streaming compatibility policy did not add the client Accept header");
}

if (clientAfter !== clientBefore) await writeFile(clientPath, clientAfter);

console.log("Aligned streaming with JSON API compatibility.");

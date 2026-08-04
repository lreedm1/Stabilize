import { readFile, writeFile } from "node:fs/promises";

const workerPath = "src/index.js";
const workerBefore = await readFile(workerPath, "utf8");
let workerAfter = workerBefore.replace(
  /async function handleChat\(request, env, ctx, accountKey\) \{[\s\S]*?\n\}\n\nfunction authNotice\(code\) \{/,
  `async function handleChat(request, env, ctx, accountKey) {
  const body = await readBoundedJson(request);
  const latestText = latestUserText(body);
  if (!latestText) throw new HttpError(400, COPY.api.messageRequired);

  const stub = accountMemoryStub(env, accountKey);
  const clientAwaiting = body?.awaitingSafetyAnswer === true;
  let route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting,
  });
  let fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(stub, route, fixed);
    if (!schedule(ctx, task)) await task;
    return jsonResponse({ route, ...fixed });
  }

  const memory = await readMemoryContext(stub);

  route = classifyInput(latestText, {
    awaitingSafetyAnswer: clientAwaiting || memory.awaitingSafetyAnswer,
  });
  fixed = fixedReplyForRoute(route);

  if (fixed) {
    const task = recordFixedRoute(stub, route, fixed);
    if (!schedule(ctx, task)) await task;
    return jsonResponse({ route, ...fixed });
  }

  const messages = modelInput(memory, latestText);
  if (!messages.length) throw new HttpError(400, COPY.api.invalidConversation);

  const acceptsStreaming = (request.headers.get("accept") || "")
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
  });
}

function authNotice(code) {`,
);

workerAfter = workerAfter.replace(
  /\s*if \(!schedule\(ctx, produce\(\)\)\) void produce\(\);/g,
  "\n  const task = produce();\n  if (!schedule(ctx, task)) void task;",
);

if (
  workerAfter === workerBefore ||
  !workerAfter.includes('includes("application/x-ndjson")') ||
  !workerAfter.includes("return streamChatReply(messages, route, env, latestText, stub, ctx);")
) {
  throw new Error("Final streaming handler normalization failed");
}

await writeFile(workerPath, workerAfter);

const clientPath = "public/app.js";
const clientBefore = await readFile(clientPath, "utf8");
let clientAfter = clientBefore;

if (!clientAfter.includes('Accept: "application/x-ndjson, application/json"')) {
  clientAfter = clientAfter.replace(
    '      headers: { "Content-Type": "application/json" },',
    '      headers: {\n        "Content-Type": "application/json",\n        Accept: "application/x-ndjson, application/json",\n      },',
  );
}

if (!clientAfter.includes('Accept: "application/x-ndjson, application/json"')) {
  throw new Error("Final streaming handler did not preserve the client Accept header");
}

if (clientAfter !== clientBefore) await writeFile(clientPath, clientAfter);
console.log("Finalized opt-in streaming chat handler.");

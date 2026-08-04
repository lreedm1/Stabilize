import { readFile, writeFile } from "node:fs/promises";

const workerPath = "src/index.js";
const workerBefore = await readFile(workerPath, "utf8");
let workerAfter = workerBefore;

if (!workerAfter.includes("function streamChatReply(")) {
  const anchor = "async function generateReply(messages, route, env, latestText) {";
  if (!workerAfter.includes(anchor)) {
    throw new Error("Streaming policy could not find the reply generator anchor");
  }

  const streamingHelpers = `function streamHeaders() {
  return apiHeaders({
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "X-Accel-Buffering": "no",
  });
}

function streamEvent(value) {
  return new TextEncoder().encode(JSON.stringify(value) + "\\n");
}

async function openAIStream(payload, apiKey, timeoutMs, errorName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const clientRequestId = crypto.randomUUID();

  let response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "X-Client-Request-Id": clientRequestId,
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    throw new OpenAIRequestError({
      name: errorName,
      failure: controller.signal.aborted ? "timeout" : "connection",
      clientRequestId,
    });
  }

  const providerRequestId = safeProviderField(
    response.headers.get("x-request-id"),
  );
  if (!response.ok) {
    clearTimeout(timeout);
    const responseBody = await response.json().catch(() => ({}));
    const fields = providerErrorFields(responseBody);
    throw new OpenAIRequestError({
      name: errorName,
      failure: "http",
      status: response.status,
      code: fields.code,
      type: fields.type,
      providerRequestId,
      clientRequestId,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    });
  }

  return { response, controller, timeout, providerRequestId, clientRequestId };
}

async function* openAITextDeltas(result) {
  if (!result.response.body) {
    throw new OpenAIRequestError({
      name: "OpenAIInvalidReplyError",
      failure: "invalid_output",
      status: 502,
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }

  const reader = result.response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\\n\\n");
      buffer = events.pop() || "";

      for (const eventBlock of events) {
        const data = eventBlock
          .split("\\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\\n");
        if (!data || data === "[DONE]") continue;

        const event = JSON.parse(data);
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          yield event.delta;
        }
        if (event.type === "response.failed") {
          const failure = event.response?.error || {};
          throw new OpenAIRequestError({
            name: "OpenAIHttpError",
            failure: "http",
            status: 502,
            code: safeProviderField(failure.code),
            type: safeProviderField(failure.type),
            providerRequestId: result.providerRequestId,
            clientRequestId: result.clientRequestId,
          });
        }
      }
    }
  } finally {
    clearTimeout(result.timeout);
    reader.releaseLock();
  }
}

function streamChatReply(messages, route, env, latestText, stub, ctx) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const produce = async () => {
    let reply = "";
    try {
      await writer.write(streamEvent({ type: "meta", route }));
      const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";

      if (demoMode) {
        const demo = demoReply(route, latestText);
        const chunks = demo.match(/\\S+\\s*/g) || [demo];
        for (const delta of chunks) {
          reply += delta;
          await writer.write(streamEvent({ type: "delta", delta }));
        }
      } else {
        const { apiKey, model, reasoningEffort } = openAIConfig(env);
        const result = await openAIStream(
          {
            model,
            reasoning: { effort: reasoningEffort, context: "current_turn" },
            instructions:
              COPY.model.systemPrompt +
              "\\n\\n" +
              COPY.model.memoryInstruction +
              "\\n\\n" +
              COPY.model.routeInstruction(route),
            input: messages,
            max_output_tokens: MAX_MODEL_OUTPUT_TOKENS,
            store: true,
          },
          apiKey,
          60_000,
          "OpenAIHttpError",
        );

        for await (const delta of openAITextDeltas(result)) {
          reply += delta;
          await writer.write(streamEvent({ type: "delta", delta }));
        }
      }

      let validated = validateModelReply(reply);
      if (
        validated &&
        route === "ORDINARY" &&
        typeof isNeutralGreeting === "function" &&
        typeof isUnsolicitedSafetyCheck === "function" &&
        isNeutralGreeting(latestText) &&
        isUnsolicitedSafetyCheck(validated)
      ) {
        validated = "Hi. What’s happening right now?";
      }
      if (!validated) {
        throw new OpenAIRequestError({
          name: "OpenAIInvalidReplyError",
          failure: "invalid_output",
          status: 502,
          clientRequestId: crypto.randomUUID(),
        });
      }

      const result = await recordExchange(stub, {
        user: latestText,
        assistant: validated,
        awaitingSafetyAnswer: false,
      });
      if (result?.shouldCompact && stub && ctx) {
        schedule(ctx, compactSession(stub, env));
      }

      await writer.write(
        streamEvent({
          type: "done",
          route,
          reply: validated,
          showEmergency: false,
          awaitingSafetyAnswer: false,
        }),
      );
    } catch (error) {
      if (error instanceof OpenAIRequestError) {
        const publicError = publicOpenAIError(error);
        await writer.write(
          streamEvent({
            type: "error",
            error: publicError.message,
            reference: errorReference(error.clientRequestId),
          }),
        );
      } else {
        await writer.write(
          streamEvent({
            type: "error",
            error: COPY.api.temporarilyUnavailable,
            reference: errorReference(crypto.randomUUID()),
          }),
        );
      }
    } finally {
      await writer.close();
    }
  };

  if (!schedule(ctx, produce())) void produce();
  return new Response(readable, { status: 200, headers: streamHeaders() });
}

`;

  workerAfter = workerAfter.replace(anchor, streamingHelpers + anchor);
}

const oldChatCompletion = `  const reply = await generateReply(messages, route, env, latestText);
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

const newChatCompletion = `  return streamChatReply(messages, route, env, latestText, stub, ctx);`;

if (workerAfter.includes(oldChatCompletion)) {
  workerAfter = workerAfter.replace(oldChatCompletion, newChatCompletion);
}

if (!workerAfter.includes("return streamChatReply(messages, route, env, latestText, stub, ctx);")) {
  throw new Error("Streaming policy did not replace the chat completion response");
}

if (workerAfter !== workerBefore) await writeFile(workerPath, workerAfter);

const clientPath = "public/app.js";
const clientBefore = await readFile(clientPath, "utf8");
let clientAfter = clientBefore;

if (!clientAfter.includes("async function readStreamingResponse(")) {
  const anchor = "function requestErrorMessage(message, reference = \"\") {";
  if (!clientAfter.includes(anchor)) {
    throw new Error("Streaming policy could not find the client error anchor");
  }

  const helpers = `function renderStreamingOutput(article, content) {
  article.className = "assistant-output streaming-output";
  article.setAttribute("aria-label", "Stabilize");
  article.replaceChildren();
  article.appendChild(renderMarkdown(content || copy.thinking));
  chatLog.hidden = false;
  chatLog.tabIndex = 0;
  conversationSurface.dataset.view = "response";
  scrollConversationToLatest();
}

async function readStreamingResponse(response, article) {
  if (!response.body) throw new Error(copy.unexpectedError);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let completed = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "delta" && typeof event.delta === "string") {
          accumulated += event.delta;
          renderStreamingOutput(article, accumulated);
        } else if (event.type === "done") {
          completed = event;
        } else if (event.type === "error") {
          const error = new Error(String(event.error || copy.unexpectedError));
          error.streamingError = true;
          error.reference = String(event.reference || "");
          throw error;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!completed) throw new Error(copy.unexpectedError);
  return completed;
}

function finalizeStreamingOutput(article, reply, route, offerOutcomeCheck) {
  article.className = "assistant-output";
  article.replaceChildren();
  article.appendChild(renderMarkdown(reply));
  if (offerOutcomeCheck) appendOutcomeCheck(article, reply, route);
  activeAssistantOutput = null;
  scrollConversationToLatest();
}

`;
  clientAfter = clientAfter.replace(anchor, helpers + anchor);
}

clientAfter = clientAfter.replace(
  '  showOutput(copy.thinking, "thinking-output", "thinking");',
  '  const pendingOutput = showOutput(copy.thinking, "thinking-output", "thinking");',
);

if (!clientAfter.includes("application/x-ndjson")) {
  const anchor = `    const result = await response.json().catch(() => ({}));

    if (!response.ok) {`;
  if (!clientAfter.includes(anchor)) {
    throw new Error("Streaming policy could not find the response parsing anchor");
  }

  const replacement = `    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/x-ndjson")) {
      const result = await readStreamingResponse(response, pendingOutput);
      const reply = String(result.reply || copy.missingReply);
      const route = String(result.route || "ORDINARY");
      const needsSafetyAnswer = result.awaitingSafetyAnswer === true;
      const offerOutcomeCheck =
        !needsSafetyAnswer && !ROUTES_WITHOUT_OUTCOME_CHECK.has(route);
      finalizeStreamingOutput(pendingOutput, reply, route, offerOutcomeCheck);
      modulateTerrain(reply);
      awaitingSafetyAnswer = needsSafetyAnswer;
      awaitingSafetyAnswerSince = needsSafetyAnswer ? Date.now() : null;
      persistLatestAnswer(reply, route, needsSafetyAnswer);
      lastSubmittedText = "";
      return;
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {`;
  clientAfter = clientAfter.replace(anchor, replacement);
}

clientAfter = clientAfter.replace(
  `  } catch {
    input.value = clean;
    lastSubmittedText = "";
    showOutput(requestErrorMessage(copy.unexpectedError), "error-output");`,
  `  } catch (error) {
    input.value = clean;
    lastSubmittedText = "";
    const message = error?.streamingError ? error.message : copy.unexpectedError;
    const reference = error?.streamingError ? error.reference : "";
    showOutput(requestErrorMessage(message, reference), "error-output");`,
);

if (
  !clientAfter.includes("async function readStreamingResponse(") ||
  !clientAfter.includes("contentType.includes(\"application/x-ndjson\")") ||
  !clientAfter.includes("const pendingOutput = showOutput(copy.thinking")
) {
  throw new Error("Streaming policy did not apply the client stream reader");
}

if (clientAfter !== clientBefore) await writeFile(clientPath, clientAfter);

console.log("Applied streamed response delivery.");

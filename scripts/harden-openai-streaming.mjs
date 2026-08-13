import { readFile, writeFile } from "node:fs/promises";

const workerPath = "src/index.js";
const before = await readFile(workerPath, "utf8");

const replacement = `function streamFailureDiagnostic(error) {
  if (error instanceof OpenAIRequestError) {
    return {
      category: String(error.failure || "request").slice(0, 40),
      status: Number.isFinite(error.status) ? error.status : null,
      code: safeProviderField(error.code),
      type: safeProviderField(error.type),
      name: String(error.name || "OpenAIRequestError").slice(0, 60),
    };
  }
  return {
    category: "runtime",
    status: null,
    code: null,
    type: null,
    name: String(error instanceof Error ? error.name : "UnknownError").slice(0, 60),
  };
}

function parseOpenAIStreamEvent(eventBlock, result) {
  const lines = String(eventBlock || "").split(/\\r\\n|\\n|\\r/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  const data = (dataLines.length ? dataLines.join("\\n") : eventBlock).trim();
  if (!data || data === "[DONE]") return null;

  try {
    return JSON.parse(data);
  } catch {
    throw new OpenAIRequestError({
      name: "OpenAIStreamParseError",
      failure: "invalid_output",
      status: 502,
      code: "invalid_sse_event",
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }
}

function streamEventText(event) {
  if (
    event?.type === "response.output_text.done" &&
    typeof event.text === "string"
  ) {
    return event.text;
  }
  if (
    ["response.completed", "response.incomplete"].includes(event?.type)
  ) {
    return responseText(event.response);
  }
  return "";
}

function throwForFailedStreamEvent(event, result) {
  if (!["response.failed", "error"].includes(event?.type)) return;
  const failure = event?.response?.error || event?.error || {};
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

async function* openAITextDeltas(result) {
  if (!result.response.body) {
    throw new OpenAIRequestError({
      name: "OpenAIInvalidReplyError",
      failure: "invalid_output",
      status: 502,
      code: "missing_stream_body",
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }

  const reader = result.response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedText = "";
  let finalText = "";
  let incompleteReason = null;

  const consume = (eventBlock) => {
    const event = parseOpenAIStreamEvent(eventBlock, result);
    if (!event) return null;
    throwForFailedStreamEvent(event, result);

    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      return event.delta;
    }

    const eventText = streamEventText(event);
    if (eventText) finalText = eventText;
    if (event.type === "response.incomplete") {
      incompleteReason = safeProviderField(
        event.response?.incomplete_details?.reason,
      ) || "response_incomplete";
    }
    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\\r\\n\\r\\n|\\n\\n|\\r\\r/);
      buffer = events.pop() || "";

      for (const eventBlock of events) {
        const delta = consume(eventBlock);
        if (!delta) continue;
        emittedText += delta;
        yield delta;
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const delta = consume(buffer);
      if (delta) {
        emittedText += delta;
        yield delta;
      }
    }

    if (!emittedText && finalText) {
      emittedText = finalText;
      yield finalText;
    }

    if (!emittedText) {
      throw new OpenAIRequestError({
        name: "OpenAIInvalidReplyError",
        failure: "invalid_output",
        status: 502,
        code: incompleteReason || "empty_stream",
        providerRequestId: result.providerRequestId,
        clientRequestId: result.clientRequestId,
      });
    }
  } finally {
    clearTimeout(result.timeout);
    try {
      reader.releaseLock();
    } catch {
      // The provider or client may already have closed the stream.
    }
  }
}

function shouldUseNonStreamingFallback(error) {
  if (!(error instanceof OpenAIRequestError)) return true;
  if (OPENAI_ACCOUNT_LIMIT_CODES.has(error.code)) return false;
  if (error.type === "insufficient_quota") return false;
  if ([401, 403, 404, 429].includes(error.status)) return false;
  if (error.failure === "timeout") return false;
  return true;
}

async function generateFallbackReply(messages, route, env) {
  const { apiKey, model } = openAIConfig(env);
  const result = await callOpenAI(
    {
      model,
      reasoning: { effort: "medium" },
      instructions:
        COPY.model.systemPrompt +
        "\\n\\n" +
        COPY.model.memoryInstruction +
        "\\n\\n" +
        COPY.model.routeInstruction(route),
      input: messages,
      store: true,
    },
    apiKey,
    60_000,
    "OpenAIFallbackHttpError",
  );

  const reply = validateModelReply(result.text);
  if (!reply) {
    throw new OpenAIRequestError({
      name: "OpenAIInvalidReplyError",
      failure: "invalid_output",
      status: 502,
      code: "empty_fallback",
      providerRequestId: result.providerRequestId,
      clientRequestId: result.clientRequestId,
    });
  }
  return reply;
}

async function writeReplyDeltas(writer, text) {
  const chunks = String(text || "").match(/\\S+\\s*/g) || [String(text || "")];
  for (const delta of chunks) {
    if (!delta) continue;
    await writer.write(streamEvent({ type: "delta", delta }));
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
        reply = demo;
        await writeReplyDeltas(writer, demo);
      } else {
        try {
          const { apiKey, model, reasoningEffort } = openAIConfig(env);
          const result = await openAIStream(
            {
              model,
              reasoning: { effort: reasoningEffort },
              instructions:
                COPY.model.systemPrompt +
                "\\n\\n" +
                COPY.model.memoryInstruction +
                "\\n\\n" +
                COPY.model.routeInstruction(route),
              input: messages,
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
        } catch (streamError) {
          if (reply || !shouldUseNonStreamingFallback(streamError)) {
            throw streamError;
          }

          console.warn(
            JSON.stringify({
              event: "openai_stream_fallback_used",
              route,
              diagnostic: streamFailureDiagnostic(streamError),
            }),
          );
          reply = await generateFallbackReply(messages, route, env);
          await writeReplyDeltas(writer, reply);
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
          code: "invalid_validated_reply",
          clientRequestId: crypto.randomUUID(),
        });
      }

      const recordResult = await recordExchange(stub, {
        user: latestText,
        assistant: validated,
        awaitingSafetyAnswer: false,
      });
      if (recordResult?.shouldCompact && stub && ctx) {
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
      const diagnostic = streamFailureDiagnostic(error);
      const clientRequestId =
        error instanceof OpenAIRequestError
          ? error.clientRequestId
          : crypto.randomUUID();
      const reference = errorReference(clientRequestId);
      console.error(
        JSON.stringify({
          event: "openai_stream_failed",
          route,
          diagnostic,
          reference,
        }),
      );

      const publicError =
        error instanceof OpenAIRequestError
          ? publicOpenAIError(error)
          : { message: COPY.api.temporarilyUnavailable };
      try {
        await writer.write(
          streamEvent({
            type: "error",
            error: publicError.message,
            reference,
            diagnostic,
          }),
        );
      } catch {
        // The browser may have left while the provider request was running.
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // Closing an already-aborted browser stream is harmless.
      }
    }
  };

  const task = produce();
  if (!schedule(ctx, task)) void task;
  return new Response(readable, { status: 200, headers: streamHeaders() });
}

async function generateReply`;

const pattern = /async function\* openAITextDeltas\(result\) \{[\s\S]*?\n\}\n\nfunction streamChatReply\(messages, route, env, latestText, stub, ctx\) \{[\s\S]*?\n\}\n\nasync function generateReply/;

if (!pattern.test(before)) {
  if (
    before.includes("function parseOpenAIStreamEvent(") &&
    before.includes("function shouldUseNonStreamingFallback(") &&
    before.includes('event: "openai_stream_failed"')
  ) {
    console.log("OpenAI streaming hardening already applied.");
    process.exit(0);
  }
  throw new Error("Could not find the generated OpenAI streaming implementation");
}

const after = before.replace(pattern, replacement);
if (
  !after.includes("buffer.split(/\\r\\n\\r\\n|\\n\\n|\\r\\r/)") ||
  !after.includes("generateFallbackReply(messages, route, env)") ||
  !after.includes('event: "openai_stream_failed"')
) {
  throw new Error("OpenAI streaming hardening did not apply completely");
}

if (after !== before) await writeFile(workerPath, after);
console.log("Hardened OpenAI SSE parsing and fallback delivery.");

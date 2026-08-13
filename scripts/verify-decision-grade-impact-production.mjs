const origin = "https://stabilize.info";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseEvents(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

for (let attempt = 1; attempt <= 60; attempt += 1) {
  let response;
  try {
    response = await fetch(
      `${origin}/api/chat?verify-decision-grade-impact=${encodeURIComponent(
        `${process.env.GITHUB_SHA || "manual"}-${attempt}`,
      )}`,
      {
        method: "POST",
        headers: {
          Accept: "application/x-ndjson, application/json",
          "Cache-Control": "no-cache",
          "Content-Type": "application/json",
          "X-Stabilize-Session-Id": crypto.randomUUID(),
          "X-Stabilize-Browser-Id": crypto.randomUUID(),
          "X-Stabilize-Conversation-Id": crypto.randomUUID(),
        },
        body: JSON.stringify({ message: "Reply with one brief greeting." }),
        signal: AbortSignal.timeout(90_000),
      },
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        attempt,
        failure: error instanceof Error ? error.name : "FetchError",
      }),
    );
    await sleep(5_000);
    continue;
  }

  const contentType = String(response.headers.get("content-type") || "")
    .toLowerCase();
  const turnId = String(response.headers.get("x-stabilize-turn-id") || "");
  const impactVersion = String(
    response.headers.get("x-stabilize-impact-version") || "",
  );
  const text = await response.text();

  let done = null;
  let streamedText = "";
  let parseFailure = false;
  try {
    for (const event of parseEvents(text)) {
      if (event?.type === "error") parseFailure = true;
      if (event?.type === "delta" && typeof event.delta === "string") {
        streamedText += event.delta;
      }
      if (event?.type === "done") done = event;
    }
  } catch {
    parseFailure = true;
  }

  const usage = done?.analytics;
  const valid =
    response.status === 200 &&
    contentType.includes("application/x-ndjson") &&
    /^[0-9a-f-]{36}$/iu.test(turnId) &&
    impactVersion === "next-step-v1" &&
    !parseFailure &&
    streamedText.trim().length > 0 &&
    typeof done?.reply === "string" &&
    done.reply.trim().length > 0 &&
    usage &&
    /^gpt-/u.test(String(usage.model || "")) &&
    usage.requestedServiceTier === "fast" &&
    ["priority", "fast"].includes(usage.actualServiceTier) &&
    Number.isFinite(usage.inputTokens) &&
    usage.inputTokens > 0 &&
    Number.isFinite(usage.cachedInputTokens) &&
    usage.cachedInputTokens >= 0 &&
    Number.isFinite(usage.cacheWriteTokens) &&
    usage.cacheWriteTokens >= 0 &&
    Number.isFinite(usage.reasoningTokens) &&
    usage.reasoningTokens >= 0 &&
    Number.isFinite(usage.outputTokens) &&
    usage.outputTokens > 0;

  if (valid) {
    console.log(
      JSON.stringify({
        model: usage.model,
        requestedServiceTier: usage.requestedServiceTier,
        actualServiceTier: usage.actualServiceTier,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        reasoningTokens: usage.reasoningTokens,
        outputTokens: usage.outputTokens,
        turnIdPresent: true,
        impactVersion,
      }),
    );
    console.log("Decision-grade provider usage is live in production.");
    process.exit(0);
  }

  console.log(
    JSON.stringify({
      attempt,
      status: response.status,
      ndjson: contentType.includes("application/x-ndjson"),
      turnIdPresent: Boolean(turnId),
      impactVersion: impactVersion || null,
      donePresent: Boolean(done),
      analyticsPresent: Boolean(usage),
      modelPresent: Boolean(usage?.model),
      actualServiceTier: usage?.actualServiceTier || null,
      inputTokensPositive: Number(usage?.inputTokens) > 0,
      outputTokensPositive: Number(usage?.outputTokens) > 0,
    }),
  );
  await sleep(5_000);
}

throw new Error(
  "Production did not expose complete decision-grade usage metadata.",
);

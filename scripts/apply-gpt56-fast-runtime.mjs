import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`GPT-5.6 fast-first runtime could not find ${label}`);
  }
  return source.replace(before, after);
}

function replaceBlock(source, startMarker, endMarker, transform, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`GPT-5.6 fast-first runtime could not find ${label}`);
  }
  const block = source.slice(start, end);
  return source.slice(0, start) + transform(block) + source.slice(end);
}

await update("src/paid-worker.js", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `  const requestedEffort = String(body?.reasoningEffort || "none")
    .trim()
    .toLowerCase();
  const usesThinking = ["low", "medium", "high", "xhigh", "max"].includes(
    requestedEffort,
  );
  const freeModel = usesThinking
    ? String(env.FREE_PLAN_PRIMARY_MODEL || "gpt-5.6-sol")
    : defaultModel;`,
    `  const freeModel = String(
    env.FREE_PLAN_PRIMARY_MODEL || "gpt-5.6-sol",
  );`,
    "the signed-in free-model selection",
  );

  next = replaceRequired(
    next,
    `  const paid = state.entitled === true;
  const selected = paid
    ? isAllowedModel(choiceEnvironment, state.selectedModel)
      ? state.selectedModel
      : defaultModel
    : defaultModel;
  const selectedChoice = choices.find((choice) => choice.id === selected);
  const currentLabel = selectedChoice?.label || "GPT-5.4";`,
    `  const paid = state.entitled === true;
  const automaticFreeModel = choices.some(
    (choice) => choice.id === "gpt-5.6-sol",
  )
    ? "gpt-5.6-sol"
    : defaultModel;
  const selected = paid
    ? isAllowedModel(choiceEnvironment, state.selectedModel)
      ? state.selectedModel
      : defaultModel
    : automaticFreeModel;
  const selectedChoice = choices.find((choice) => choice.id === selected);
  const currentLabel = paid
    ? selectedChoice?.label || "GPT-5.4"
    : "GPT-5.6 Fast";`,
    "the free-account display model",
  );

  next = next
    .replaceAll(
      "Checkout was cancelled. Your free Current thinking allowance is unchanged.",
      "Checkout was cancelled. Your free GPT-5.6 Fast allowance is unchanged.",
    )
    .replaceAll(
      "Fastest response uses GPT-5.4. Thinking levels use Current until the daily allowance is reached.",
      "Guest and signed-in Fastest responses begin on GPT-5.6 Fast. Signed-in accounts switch to GPT-5.4 after the daily allowance.",
    )
    .replaceAll(
      " free Current thinking messages used today. Fastest response uses GPT-5.4 and does not count. The allowance resets at 00:00 UTC.",
      " free GPT-5.6 Fast messages used today. GPT-5.4 takes over after this allowance. The allowance resets at 00:00 UTC.",
    )
    .replaceAll(
      " Current thinking messages each day. Fastest response stays on GPT-5.4.</p>",
      " GPT-5.6 Fast messages each UTC day before GPT-5.4 fallback. Guest chats also begin on GPT-5.6 Fast.</p>",
    )
    .replaceAll(
      `"<p>Fastest response uses GPT-5.4. Choose a thinking level to use Current for up to " +
      freeLimit +
      " messages each UTC day.</p>"`,
      `"<p>GPT-5.6 Fast is automatic for the first " +
      freeLimit +
      " messages each UTC day. GPT-5.4 takes over afterward.</p>"`,
    )
    .replaceAll(
      "billing-client.js?v=20260807-free-gpt56-first-50-1",
      "billing-client.js?v=20260808-gpt56-fast-first-1",
    );

  next = replaceBlock(
    next,
    "async function paidChatResponse(request, env, ctx) {",
    "\nfunction responseWithPreparationTiming",
    (block) =>
      replaceRequired(
        block,
        `  if (!authSession) return originalWorker.fetch(request, env, ctx);`,
        `  if (!authSession) {
    return originalWorker.fetch(
      request,
      modelEnvironment(
        env,
        String(env.FREE_PLAN_PRIMARY_MODEL || "gpt-5.6-sol"),
      ),
      ctx,
    );
  }`,
        "the guest chat model route",
      ),
    "the paid chat handler",
  );
  return next;
});

await update("src/billing-account.js", (source) =>
  source.replace(
    `      // Signed-in instant chats use the unmetered default model.
      if (config.freeModel === config.defaultModel) {
        return {
          allowed: true,
          reason: null,
          model: config.defaultModel,
          tier: null,
          period: null,
          used: 0,
          limit: 0,
          fallback: false,
          paid: false,
          reservationMade: false,
        };
      }

`,
    "",
  ),
);

await update("public/billing-client.js", (source) =>
  source
    .replaceAll(
      " free Current thinking messages used today. Fastest response uses GPT-5.4 and does not count. The allowance resets at 00:00 UTC.",
      " free GPT-5.6 Fast messages used today. GPT-5.4 takes over after this allowance. The allowance resets at 00:00 UTC.",
    )
    .replaceAll(
      " Current thinking messages. Stabilize used GPT-5.4 for this message; it was still sent.",
      " GPT-5.6 Fast messages. Stabilize used GPT-5.4 for this message; it was still sent.",
    ),
);

console.log("Applied GPT-5.6 Fast-first runtime routing.");

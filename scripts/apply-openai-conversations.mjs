import { readFile, writeFile } from "node:fs/promises";

async function transform(path, update) {
  const before = await readFile(path, "utf8");
  const after = update(before);
  if (after !== before) await writeFile(path, after);
}

function replaceRequired(text, oldValue, newValue, verification, label) {
  if (text.includes(oldValue)) return text.replace(oldValue, newValue);
  if (verification?.test(text)) return text;
  throw new Error(`Conversations migration could not find ${label}`);
}

function replaceSection(text, startMarker, endMarker, replacement, verification, label) {
  if (verification?.test(text)) return text;
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Conversations migration could not find ${label}`);
  }
  return text.slice(0, start) + replacement + text.slice(end);
}

await transform("src/index.js", (source) => {
  let text = source;

  text = replaceRequired(
    text,
    'const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";',
    'const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";\nconst OPENAI_CONVERSATIONS_URL = "https://api.openai.com/v1/conversations";\nconst OPENAI_CONVERSATION_ID_PATTERN = /^conv_[A-Za-z0-9_-]{1,120}$/;',
    /OPENAI_CONVERSATIONS_URL[\s\S]*OPENAI_CONVERSATION_ID_PATTERN/,
    "the OpenAI endpoint constants",
  );

  text = replaceRequired(
    text,
    '    updatedAt: null,\n  };\n}\n\nfunction accountMemoryStub',
    '    updatedAt: null,\n    conversationId: null,\n  };\n}\n\nfunction accountMemoryStub',
    /function emptyMemoryContext\(\)[\s\S]*conversationId: null/,
    "the empty memory context",
  );

  const accountStubAnchor = `function accountMemoryStub(env, accountKey) {\n  if (!accountKey) return null;\n  if (!env?.SESSIONS || typeof env.SESSIONS.getByName !== "function") return null;\n  return env.SESSIONS.getByName("google:" + accountKey);\n}`;
  const accountStubWithId = `${accountStubAnchor}\n\nfunction cleanOpenAIConversationId(value) {\n  const text = String(value || "").trim();\n  return OPENAI_CONVERSATION_ID_PATTERN.test(text) ? text : null;\n}`;
  text = replaceRequired(
    text,
    accountStubAnchor,
    accountStubWithId,
    /function cleanOpenAIConversationId\(/,
    "the account memory helper",
  );

  text = replaceRequired(
    text,
    '      updatedAt: Number(context?.updatedAt) || null,\n    };',
    '      updatedAt: Number(context?.updatedAt) || null,\n      conversationId: cleanOpenAIConversationId(context?.conversationId),\n    };',
    /conversationId: cleanOpenAIConversationId\(context\?\.conversationId\)/,
    "the remembered provider state",
  );

  const modelInputEnd = `function modelInput(memory, latestText) {\n  const messages = [];\n  if (memory.summary) {\n    messages.push({\n      role: "user",\n      content: COPY.model.memoryPrefix + "\\n" + memory.summary,\n    });\n  }\n  messages.push(...memory.recent);\n  messages.push({ role: "user", content: latestText });\n  return normalizeMessages(messages);\n}`;
  const modelInputWithSeed = `${modelInputEnd}\n\nfunction conversationSeed(memory) {\n  const messages = [];\n  if (memory.summary) {\n    messages.push({\n      role: "user",\n      content: COPY.model.memoryPrefix + "\\n" + memory.summary,\n    });\n  }\n  messages.push(...memory.recent);\n  return normalizeMessages(messages).slice(-20);\n}`;
  text = replaceRequired(
    text,
    modelInputEnd,
    modelInputWithSeed,
    /function conversationSeed\(/,
    "the conversation seed builder",
  );

  const providerFunctions = `async function callOpenAI(\n  url,\n  payload,\n  apiKey,\n  timeoutMs,\n  errorName,\n  method = "POST",\n) {\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), timeoutMs);\n  const clientRequestId = crypto.randomUUID();\n\n  let response;\n  try {\n    response = await fetch(url, {\n      method,\n      headers: {\n        Authorization: "Bearer " + apiKey,\n        "Content-Type": "application/json",\n        "X-Client-Request-Id": clientRequestId,\n      },\n      body: payload === undefined ? undefined : JSON.stringify(payload),\n      signal: controller.signal,\n    });\n  } catch {\n    throw new OpenAIRequestError({\n      name: errorName,\n      failure: controller.signal.aborted ? "timeout" : "connection",\n      clientRequestId,\n    });\n  } finally {\n    clearTimeout(timeout);\n  }\n\n  const responseBody = await response.json().catch(() => ({}));\n  const providerRequestId = safeProviderField(\n    response.headers.get("x-request-id"),\n  );\n  if (!response.ok) {\n    const fields = providerErrorFields(responseBody);\n    throw new OpenAIRequestError({\n      name: errorName,\n      failure: "http",\n      status: response.status,\n      code: fields.code,\n      type: fields.type,\n      providerRequestId,\n      clientRequestId,\n      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),\n    });\n  }\n\n  return {\n    body: responseBody,\n    text: responseText(responseBody),\n    providerRequestId,\n    clientRequestId,\n  };\n}\n\nasync function createOpenAIConversation(memory, apiKey) {\n  const items = conversationSeed(memory);\n  const payload = {\n    metadata: {\n      application: "stabilize",\n      retention: "30_days",\n    },\n  };\n  if (items.length) payload.items = items;\n\n  const result = await callOpenAI(\n    OPENAI_CONVERSATIONS_URL,\n    payload,\n    apiKey,\n    25_000,\n    "OpenAIConversationCreateError",\n  );\n  const conversationId = cleanOpenAIConversationId(result.body?.id);\n  if (!conversationId) {\n    throw new OpenAIRequestError({\n      name: "OpenAIConversationInvalidReplyError",\n      failure: "invalid_output",\n      status: 502,\n      providerRequestId: result.providerRequestId,\n      clientRequestId: result.clientRequestId,\n    });\n  }\n  return conversationId;\n}\n\nasync function cleanUpUnusedConversation(stub, conversationId, ctx) {\n  if (!stub || typeof stub.purgeUnusedOpenAIConversation !== "function") return;\n  const task = stub.purgeUnusedOpenAIConversation(conversationId);\n  if (!schedule(ctx, task)) await task;\n}\n\nasync function ensureOpenAIConversation(stub, memory, env, ctx) {\n  if (!stub || typeof stub.adoptOpenAIConversation !== "function") return null;\n\n  const existing = cleanOpenAIConversationId(memory?.conversationId);\n  if (existing) return existing;\n\n  const { apiKey } = openAIConfig(env);\n  const candidate = await createOpenAIConversation(memory, apiKey);\n  const adoption = await stub.adoptOpenAIConversation(candidate);\n  const active = cleanOpenAIConversationId(adoption?.conversationId) || candidate;\n\n  if (active !== candidate) {\n    await cleanUpUnusedConversation(stub, candidate, ctx);\n  }\n  return active;\n}\n\nasync function resetOpenAIConversation(stub, memory, conversationId, env, ctx) {\n  if (typeof stub?.forgetOpenAIConversation === "function") {\n    await stub.forgetOpenAIConversation(conversationId);\n  }\n  await cleanUpUnusedConversation(stub, conversationId, ctx);\n  return ensureOpenAIConversation(\n    stub,\n    { ...memory, conversationId: null },\n    env,\n    ctx,\n  );\n}\n\nasync function generateReply(\n  messages,\n  route,\n  env,\n  latestText,\n  conversationId = null,\n) {\n  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";\n  if (demoMode) return demoReply(route, latestText);\n\n  const { apiKey, model, reasoningEffort } = openAIConfig(env);\n  const requestBody = {\n    model,\n    reasoning: { effort: reasoningEffort, context: "current_turn" },\n    instructions:\n      COPY.model.systemPrompt +\n      "\\n\\n" +\n      COPY.model.memoryInstruction +\n      "\\n\\n" +\n      COPY.model.routeInstruction(route),\n    input: conversationId\n      ? [{ role: "user", content: latestText }]\n      : messages,\n    store: Boolean(conversationId),\n  };\n  if (conversationId) requestBody.conversation = conversationId;\n\n  const result = await callOpenAI(\n    OPENAI_RESPONSES_URL,\n    requestBody,\n    apiKey,\n    60_000,\n    "OpenAIHttpError",\n  );\n\n  const reply = validateModelReply(result.text);\n  if (!reply) {\n    throw new OpenAIRequestError({\n      name: "OpenAIInvalidReplyError",\n      failure: "invalid_output",\n      status: 502,\n      providerRequestId: result.providerRequestId,\n      clientRequestId: result.clientRequestId,\n    });\n  }\n  return reply;\n}`;

  text = replaceSection(
    text,
    "async function callOpenAI(",
    "\n\nfunction sanitizeSummary(",
    providerFunctions,
    /async function ensureOpenAIConversation\([\s\S]*requestBody\.conversation/,
    "the OpenAI request and reply functions",
  );

  const summaryStart = text.indexOf("async function generateSummary(");
  const summaryEnd = text.indexOf("\n\nasync function compactSession(", summaryStart);
  if (summaryStart < 0 || summaryEnd < 0) {
    throw new Error("Conversations migration could not find the summary generator");
  }
  let summaryBlock = text.slice(summaryStart, summaryEnd);
  if (!summaryBlock.includes("OPENAI_RESPONSES_URL,")) {
    summaryBlock = summaryBlock.replace(
      "  const result = await callOpenAI(\n    {",
      "  const result = await callOpenAI(\n    OPENAI_RESPONSES_URL,\n    {",
    );
  }
  if (!summaryBlock.includes("OPENAI_RESPONSES_URL,")) {
    throw new Error("Conversations migration could not update the summary request");
  }
  text = text.slice(0, summaryStart) + summaryBlock + text.slice(summaryEnd);

  const oldChatGeneration = `  const messages = modelInput(memory, latestText);\n  if (!messages.length) throw new HttpError(400, COPY.api.invalidConversation);\n\n  const reply = await generateReply(messages, route, env, latestText);`;
  const newChatGeneration = `  const messages = modelInput(memory, latestText);\n  if (!messages.length) throw new HttpError(400, COPY.api.invalidConversation);\n\n  const demoMode = String(env.DEMO_MODE || "true").toLowerCase() === "true";\n  let conversationId = null;\n  if (!demoMode && stub) {\n    conversationId = await ensureOpenAIConversation(stub, memory, env, ctx);\n  }\n\n  let reply;\n  try {\n    reply = await generateReply(\n      messages,\n      route,\n      env,\n      latestText,\n      conversationId,\n    );\n  } catch (error) {\n    if (\n      !(error instanceof OpenAIRequestError) ||\n      error.status !== 404 ||\n      !conversationId ||\n      !stub\n    ) {\n      throw error;\n    }\n\n    conversationId = await resetOpenAIConversation(\n      stub,\n      memory,\n      conversationId,\n      env,\n      ctx,\n    );\n    reply = await generateReply(\n      messages,\n      route,\n      env,\n      latestText,\n      conversationId,\n    );\n  }`;
  text = replaceRequired(
    text,
    oldChatGeneration,
    newChatGeneration,
    /conversationId = await ensureOpenAIConversation\([\s\S]*resetOpenAIConversation/,
    "the chat generation flow",
  );

  text = replaceRequired(
    text,
    '            authentication: googleAuthConfigured(env),\n          },',
    '            authentication: googleAuthConfigured(env),\n            aiFeature: demoMode ? null : "conversations",\n          },',
    /aiFeature: demoMode \? null : "conversations"/,
    "the health feature report",
  );

  if (!text.includes("OPENAI_CONVERSATIONS_URL")) {
    throw new Error("The Conversations endpoint is missing after migration");
  }
  return text;
});

await transform("test/worker.test.mjs", (source) => {
  let text = source;

  text = replaceRequired(
    text,
    '    updatedAt: null,\n    nextSequence: 1,',
    '    updatedAt: null,\n    conversationId: null,\n    nextSequence: 1,',
    /function freshState\(\)[\s\S]*conversationId: null/,
    "the fake provider state",
  );

  text = replaceRequired(
    text,
    '            updatedAt: state.updatedAt,\n          };',
    '            updatedAt: state.updatedAt,\n            conversationId: state.conversationId,\n          };',
    /updatedAt: state\.updatedAt,[\s\S]*conversationId: state\.conversationId/,
    "the fake context reader",
  );

  const fakeApplySummaryEnd = `        async applySummary(summary, expectedVersion, throughSequence) {\n          const state = states.get(name) || freshState();\n          if (state.summaryVersion !== expectedVersion) return false;\n          state.summary = summary;\n          state.summaryVersion += 1;\n          state.recent = state.recent.filter(\n            (message) => message.sequence > throughSequence,\n          );\n          states.set(name, state);\n          return true;\n        },`;
  const fakeProviderMethods = `${fakeApplySummaryEnd}\n        async adoptOpenAIConversation(candidateId) {\n          const state = states.get(name) || freshState();\n          if (!state.conversationId) state.conversationId = candidateId;\n          states.set(name, state);\n          return {\n            conversationId: state.conversationId,\n            adopted: state.conversationId === candidateId,\n          };\n        },\n        async replaceOpenAIConversation(expectedId, replacementId) {\n          const state = states.get(name) || freshState();\n          if (state.conversationId === expectedId) {\n            state.conversationId = replacementId;\n          }\n          states.set(name, state);\n          return {\n            conversationId: state.conversationId,\n            adopted: state.conversationId === replacementId,\n          };\n        },\n        async forgetOpenAIConversation(expectedId) {\n          const state = states.get(name) || freshState();\n          if (state.conversationId === expectedId) state.conversationId = null;\n          states.set(name, state);\n          return true;\n        },\n        async purgeUnusedOpenAIConversation() {\n          return true;\n        },`;
  text = replaceRequired(
    text,
    fakeApplySummaryEnd,
    fakeProviderMethods,
    /async adoptOpenAIConversation\(candidateId\)/,
    "the fake conversation methods",
  );

  text = replaceRequired(
    text,
    "  return Response.json({\n    output:",
    '  return Response.json({\n    id: "conv_test_state",\n    output:',
    /id: "conv_test_state",[\s\S]*output:/,
    "the provider test response ID",
  );

  for (const oldBlock of [
    '    authentication: true,\n  });',
  ]) {
    text = text.replaceAll(
      oldBlock,
      '    authentication: true,\n    aiFeature: null,\n  });',
    );
  }
  text = text.replace(
    '    authentication: true,\n  });\n\n  const missingKeyResponse',
    '    authentication: true,\n    aiFeature: "conversations",\n  });\n\n  const missingKeyResponse',
  );
  text = text.replace(
    '    authentication: true,\n  });\n});\n\ntest("chat endpoint applies deterministic emergency routing"',
    '    authentication: true,\n    aiFeature: "conversations",\n  });\n});\n\ntest("chat endpoint applies deterministic emergency routing"',
  );

  const rememberedStart = 'test("remembered summary is supplied as untrusted context", async () => {';
  const rememberedEnd = '\n\ntest("recent turns compact in the background without OpenAI storage", async () => {';
  const rememberedReplacement = `test("remembered summary seeds a signed-in OpenAI conversation", async () => {\n  const originalFetch = globalThis.fetch;\n  const providerRequests = [];\n  const memory = createSessionNamespace();\n  const env = createEnv({\n    SESSIONS: memory,\n    DEMO_MODE: "false",\n    OPENAI_API_KEY: "test-openai-key",\n  });\n  const identity = await authenticatedIdentity(env, "google-user-one");\n  const stub = memory.getByName(identity.objectName);\n\n  await stub.recordExchange({\n    user: "I prefer short plans.",\n    assistant: "I will keep the next step small.",\n    awaitingSafetyAnswer: false,\n  });\n  const snapshot = await stub.getCompactionSnapshot();\n  await stub.applySummary(\n    "The user prefers short plans.",\n    snapshot.summaryVersion,\n    snapshot.throughSequence,\n  );\n\n  globalThis.fetch = async (input, init) => {\n    const request = { url: String(input), body: JSON.parse(init.body) };\n    providerRequests.push(request);\n    if (request.url === "https://api.openai.com/v1/conversations") {\n      return Response.json({\n        id: "conv_summary_test",\n        object: "conversation",\n        created_at: 1,\n        metadata: {},\n      });\n    }\n    return responseWithText("Take one five-minute step.");\n  };\n\n  try {\n    const response = await worker.fetch(\n      new Request("https://stabilize.test/api/chat", {\n        method: "POST",\n        headers: {\n          "Content-Type": "application/json",\n          Cookie: identity.cookie,\n        },\n        body: JSON.stringify({ message: "What should I do next?" }),\n      }),\n      env,\n    );\n\n    assert.equal(response.status, 200);\n    assert.equal(providerRequests.length, 2);\n    assert.equal(providerRequests[0].url, "https://api.openai.com/v1/conversations");\n    assert.match(providerRequests[0].body.items[0].content, /PRIOR CONTEXT MEMORY/);\n    assert.match(providerRequests[0].body.items[0].content, /prefers short plans/);\n\n    const responseBody = providerRequests[1].body;\n    assert.equal(providerRequests[1].url, "https://api.openai.com/v1/responses");\n    assert.equal(responseBody.conversation, "conv_summary_test");\n    assert.equal(responseBody.store, true);\n    assert.deepEqual(responseBody.input, [\n      { role: "user", content: "What should I do next?" },\n    ]);\n    assert.equal(\n      (await memory.getByName(identity.objectName).readContext()).conversationId,\n      "conv_summary_test",\n    );\n  } finally {\n    globalThis.fetch = originalFetch;\n  }\n});`;
  text = replaceSection(
    text,
    rememberedStart,
    rememberedEnd,
    rememberedReplacement,
    /remembered summary seeds a signed-in OpenAI conversation/,
    "the remembered conversation test",
  );

  const compactStart = 'test("recent turns compact in the background without OpenAI storage", async () => {';
  const compactEnd = '\n\ntest("chat endpoint relies on the token budget instead of character truncation", async () => {';
  const compactReplacement = `test("signed-in conversations coexist with local background compaction", async () => {\n  const originalFetch = globalThis.fetch;\n  const providerRequests = [];\n  const tasks = [];\n  const memory = createSessionNamespace();\n  const env = createEnv({\n    SESSIONS: memory,\n    DEMO_MODE: "false",\n    OPENAI_API_KEY: "test-openai-key",\n  });\n  const identity = await authenticatedIdentity(env, "google-user-two");\n\n  globalThis.fetch = async (input, init) => {\n    const request = { url: String(input), body: JSON.parse(init.body) };\n    providerRequests.push(request);\n    if (request.url === "https://api.openai.com/v1/conversations") {\n      return Response.json({\n        id: "conv_compaction_test",\n        object: "conversation",\n        created_at: 1,\n        metadata: {},\n      });\n    }\n    if (request.body.instructions === COPY.model.summaryPrompt) {\n      return responseWithText("The user wants a small next step for a current task.");\n    }\n    return responseWithText("Write down the first five-minute action.");\n  };\n\n  try {\n    const response = await worker.fetch(\n      new Request("https://stabilize.test/api/chat", {\n        method: "POST",\n        headers: {\n          "Content-Type": "application/json",\n          "CF-Connecting-IP": "198.51.100.9",\n          Cookie: identity.cookie,\n        },\n        body: JSON.stringify({ message: "Help me start this task." }),\n      }),\n      env,\n      {\n        waitUntil(promise) {\n          tasks.push(promise);\n        },\n      },\n    );\n\n    assert.equal(response.status, 200);\n    await Promise.all(tasks);\n\n    const context = await memory.getByName(identity.objectName).readContext();\n    assert.equal(\n      context.summary,\n      "The user wants a small next step for a current task.",\n    );\n    assert.deepEqual(context.recent, []);\n    assert.equal(context.conversationId, "conv_compaction_test");\n    assert.equal(providerRequests.length, 3);\n\n    const conversationResponse = providerRequests.find(\n      (request) => request.body.conversation === "conv_compaction_test",\n    );\n    const summaryResponse = providerRequests.find(\n      (request) => request.body.instructions === COPY.model.summaryPrompt,\n    );\n    assert.equal(conversationResponse.body.store, true);\n    assert.equal(summaryResponse.body.store, false);\n  } finally {\n    globalThis.fetch = originalFetch;\n  }\n});`;
  text = replaceSection(
    text,
    compactStart,
    compactEnd,
    compactReplacement,
    /signed-in conversations coexist with local background compaction/,
    "the compaction conversation test",
  );

  const secondTurnMarker = 'test("chat endpoint relies on the token budget instead of character truncation", async () => {';
  if (!text.includes('test("signed-in turns reuse one OpenAI conversation"')) {
    const reuseTest = `test("signed-in turns reuse one OpenAI conversation", async () => {\n  const originalFetch = globalThis.fetch;\n  const responseBodies = [];\n  let conversationCreates = 0;\n  const env = createEnv({\n    DEMO_MODE: "false",\n    OPENAI_API_KEY: "test-openai-key",\n  });\n  const identity = await authenticatedIdentity(env, "conversation-reuse-user");\n\n  globalThis.fetch = async (input, init) => {\n    const url = String(input);\n    if (url === "https://api.openai.com/v1/conversations") {\n      conversationCreates += 1;\n      return Response.json({\n        id: "conv_reuse_test",\n        object: "conversation",\n        created_at: 1,\n        metadata: {},\n      });\n    }\n    responseBodies.push(JSON.parse(init.body));\n    return responseWithText("Choose one reversible next step.");\n  };\n\n  try {\n    for (const message of ["Help me start.", "What comes after that?"]) {\n      const response = await worker.fetch(\n        new Request("https://stabilize.test/api/chat", {\n          method: "POST",\n          headers: {\n            "Content-Type": "application/json",\n            Cookie: identity.cookie,\n          },\n          body: JSON.stringify({ message }),\n        }),\n        env,\n      );\n      assert.equal(response.status, 200);\n    }\n\n    assert.equal(conversationCreates, 1);\n    assert.equal(responseBodies.length, 2);\n    assert.ok(responseBodies.every((body) => body.conversation === "conv_reuse_test"));\n    assert.deepEqual(responseBodies[1].input, [\n      { role: "user", content: "What comes after that?" },\n    ]);\n  } finally {\n    globalThis.fetch = originalFetch;\n  }\n});\n\n`;
    if (!text.includes(secondTurnMarker)) {
      throw new Error("Conversations migration could not find the reuse-test insertion point");
    }
    text = text.replace(secondTurnMarker, reuseTest + secondTurnMarker);
  }

  return text;
});

await transform("test/session-memory.test.mjs", (source) => {
  let text = source;
  text = text.replaceAll(
    '    updatedAt: null,\n  });',
    '    updatedAt: null,\n    conversationId: null,\n  });',
  );

  if (!text.includes('test("Durable Object adopts one OpenAI conversation ID"')) {
    const marker = 'test("Durable Object bounds uncondensed recent messages", async () => {';
    const testBlock = `test("Durable Object adopts one OpenAI conversation ID", async () => {\n  const stub = env.SESSIONS.getByName("session-memory-conversation-id");\n\n  const first = await stub.adoptOpenAIConversation("conv_primary_test");\n  const second = await stub.adoptOpenAIConversation("conv_racing_test");\n\n  assert.deepEqual(first, {\n    conversationId: "conv_primary_test",\n    adopted: true,\n  });\n  assert.deepEqual(second, {\n    conversationId: "conv_primary_test",\n    adopted: false,\n  });\n  assert.equal((await stub.readContext()).conversationId, "conv_primary_test");\n});\n\n`;
    if (!text.includes(marker)) {
      throw new Error("Conversations migration could not find the session test insertion point");
    }
    text = text.replace(marker, testBlock + marker);
  }
  return text;
});

console.log("Applied signed-in OpenAI Conversations state with stateless guest requests.");

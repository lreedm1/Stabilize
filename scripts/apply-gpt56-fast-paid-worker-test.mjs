import { readFile, writeFile } from "node:fs/promises";

const path = "test/paid-worker.test.mjs";
const source = await readFile(path, "utf8");
if (
  !source.includes(
    'test("a free signed-in user gets GPT-5.6 Fast before GPT-5.4 fallback"',
  )
) {
  const startMarker =
    'test("a free signed-in user gets GPT-5.4 instantly and Current when thinking"';
  const endMarker =
    '\ntest("an entitled user can select a subscriber model and the chat request uses it"';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Could not find the free signed-in Worker test block");
  }

  const replacement = `test("a free signed-in user gets GPT-5.6 Fast before GPT-5.4 fallback", async () => {
  const user = await identity("free-daily-model-user");
  const limitedEnv = {
    ...TEST_ENV,
    OPENAI_MODEL: "gpt-5.4",
    OPENAI_REASONING_EFFORT: "none",
    OPENAI_SERVICE_TIER: "fast",
    MODEL_CHOICES: "gpt-5.4|GPT-5.4,gpt-5.6-sol|Current",
    FREE_PLAN_PRIMARY_MODEL: "gpt-5.6-sol",
    FREE_PLAN_FALLBACK_MODEL: "gpt-5.4",
    FREE_DAILY_MODEL_MESSAGE_LIMIT: "2",
  };
  const page = await worker.fetch(
    new Request("https://stabilize.info/", {
      headers: { Cookie: user.cookie },
    }),
    limitedEnv,
    {},
  );
  assert.equal(page.status, 200);
  assert.match(await page.text(), /0 of 2 free GPT-5\\.6 Fast messages used today/);

  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    if (body.text?.verbosity === "low") {
      providerRequests.push({ model: body.model, effort: body.reasoning.effort });
    }
    return responseWithText("Use the smallest reversible step.");
  };

  try {
    for (const [index, reasoningEffort] of ["none", "high"].entries()) {
      const response = await worker.fetch(
        new Request("https://stabilize.info/api/chat", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Cookie: user.cookie,
            Origin: "https://stabilize.info",
          },
          body: JSON.stringify({
            message: \`Give me step \${index + 1}.\`,
            reasoningEffort,
          }),
        }),
        limitedEnv,
        {},
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Stabilize-Model-Selected"), "gpt-5.6-sol");
      assert.equal(response.headers.get("X-Stabilize-Model-Usage-Used"), String(index + 1));
    }

    const fallback = await worker.fetch(
      new Request("https://stabilize.info/api/chat", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: user.cookie,
          Origin: "https://stabilize.info",
        },
        body: JSON.stringify({
          message: "Give me one more step.",
          reasoningEffort: "high",
        }),
      }),
      limitedEnv,
      {},
    );
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("X-Stabilize-Model-Fallback"), "daily-limit");
    assert.equal(fallback.headers.get("X-Stabilize-Model-Selected"), "gpt-5.4");
    assert.deepEqual(providerRequests, [
      { model: "gpt-5.6-sol", effort: "none" },
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.4", effort: "none" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

`;

  await writeFile(path, source.slice(0, start) + replacement + source.slice(end));
}

console.log("Replaced paid Worker free-route coverage for GPT-5.6 Fast-first routing.");

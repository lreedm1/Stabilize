import { env } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";

test("Durable Object deletion invalidates stale reply and compaction writes", async () => {
  const stub = env.SESSIONS.getByName("memory-deletion-generation");
  const initial = await stub.readContextForRequest();
  assert.equal(initial.generation, 0);

  const recorded = await stub.recordExchange({
    user: "Remember this only until deletion.",
    assistant: "Stored with a generation token.",
    awaitingSafetyAnswer: false,
    expectedGeneration: initial.generation,
  });
  assert.equal(recorded.recorded, true);
  const snapshot = await stub.getCompactionSnapshot();
  assert.equal(snapshot.generation, 0);

  assert.deepEqual(await stub.deleteRememberedContext(), {
    deleted: true,
    generation: 1,
  });
  assert.deepEqual(await stub.readContext(), {
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
  });

  const staleReply = await stub.recordExchange({
    user: "Late user turn.",
    assistant: "Late assistant turn.",
    awaitingSafetyAnswer: false,
    expectedGeneration: 0,
  });
  assert.equal(staleReply.recorded, false);
  assert.equal(staleReply.stale, true);
  assert.equal(
    await stub.applySummary(
      "Late summary.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
      snapshot.generation,
    ),
    false,
  );
  assert.deepEqual((await stub.readContextForRequest()).recent, []);

  const freshReply = await stub.recordExchange({
    user: "A new post-deletion turn.",
    assistant: "This belongs to the new generation.",
    awaitingSafetyAnswer: false,
    expectedGeneration: 1,
  });
  assert.equal(freshReply.recorded, true);
  assert.equal((await stub.readContextForRequest()).generation, 1);
});

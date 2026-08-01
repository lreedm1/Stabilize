import { env, runDurableObjectAlarm } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";

test("Durable Object stores and compacts one session", async () => {
  const stub = env.SESSIONS.getByName("session-memory-lifecycle");

  assert.deepEqual(await stub.readContext(), {
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
  });

  const recorded = await stub.recordExchange({
    user: "I prefer short plans.",
    assistant: "Choose one five-minute action.",
    awaitingSafetyAnswer: false,
  });
  assert.equal(recorded.shouldCompact, true);
  assert.equal(recorded.turnCount, 1);

  const snapshot = await stub.getCompactionSnapshot();
  assert.equal(snapshot.summaryVersion, 0);
  assert.equal(snapshot.messages.length, 2);
  assert.equal(
    await stub.applySummary(
      "The user prefers short, concrete plans.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
    ),
    true,
  );

  const compacted = await stub.readContext();
  assert.equal(compacted.summary, "The user prefers short, concrete plans.");
  assert.deepEqual(compacted.recent, []);
  assert.equal(compacted.turnCount, 1);

  assert.equal(
    await stub.applySummary(
      "A stale summary must not overwrite current memory.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
    ),
    false,
  );

});

test("Durable Object bounds uncondensed recent messages", async () => {
  const stub = env.SESSIONS.getByName("session-memory-bounds");

  for (let index = 1; index <= 5; index += 1) {
    await stub.recordExchange({
      user: "User turn " + index,
      assistant: "Assistant turn " + index,
      awaitingSafetyAnswer: false,
    });
  }

  const context = await stub.readContext();
  assert.equal(context.turnCount, 5);
  assert.equal(context.recent.length, 8);
  assert.equal(context.recent[0].content, "User turn 2");
  assert.equal(context.recent.at(-1).content, "Assistant turn 5");
});

test("the retention alarm still erases an expired session", async () => {
  const stub = env.SESSIONS.getByName("session-memory-retention-alarm");

  await stub.recordExchange({
    user: "Keep this only for the retention window.",
    assistant: "Stored for bounded continuity.",
    awaitingSafetyAnswer: false,
  });
  assert.equal((await stub.readContext()).turnCount, 1);

  assert.equal(await runDurableObjectAlarm(stub), true);
  assert.deepEqual(await stub.readContext(), {
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
  });
});

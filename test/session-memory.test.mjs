import { env, runDurableObjectAlarm } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";

test("Durable Object stores timestamped and compacts one session", async () => {
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

  const context = await stub.readContext();
  assert.equal(context.recent.length, 2);
  assert.ok(Number.isFinite(context.recent[0].createdAt));
  assert.match(context.recent[0].content, /^\[Recorded \d{4}-\d{2}-\d{2}T/);
  assert.match(context.recent[0].content, /recent context/);
  assert.match(context.recent[0].content, /I prefer short plans\.$/);

  const snapshot = await stub.getCompactionSnapshot();
  assert.equal(snapshot.summaryVersion, 0);
  assert.equal(snapshot.messages.length, 2);
  assert.ok(Number.isFinite(snapshot.messages[0].createdAt));
  assert.equal(
    await stub.applySummary(
      "The user prefers short, concrete plans.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
    ),
    true,
  );

  const compacted = await stub.readContext();
  assert.match(compacted.summary, /^\[Historical summary last updated /);
  assert.match(compacted.summary, /Background only/);
  assert.match(compacted.summary, /The user prefers short, concrete plans\.$/);
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

test("Durable Object bounds timestamped recent messages", async () => {
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
  assert.match(context.recent[0].content, /User turn 2$/);
  assert.match(context.recent.at(-1).content, /Assistant turn 5$/);
  assert.ok(context.recent.every((message) => Number.isFinite(message.createdAt)));
});

test("starting a new conversation preserves condensed memory and clears thread state", async () => {
  const stub = env.SESSIONS.getByName("session-memory-new-conversation");

  await stub.recordExchange({
    user: "I prefer short plans.",
    assistant: "I will keep plans short.",
    awaitingSafetyAnswer: false,
  });
  const snapshot = await stub.getCompactionSnapshot();
  assert.equal(
    await stub.applySummary(
      "The user prefers short plans.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
    ),
    true,
  );
  await stub.recordExchange({
    user: "Current thread context.",
    assistant: "Current thread reply.",
    awaitingSafetyAnswer: true,
  });

  assert.deepEqual(await stub.startNewConversation(), { started: true });
  const context = await stub.readContext();
  assert.match(context.summary, /The user prefers short plans.$/);
  assert.deepEqual(context.recent, []);
  assert.equal(context.awaitingSafetyAnswer, false);
  assert.equal(context.turnCount, 2);
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

import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";

const EMPTY_CONTEXT = {
  summary: "",
  recent: [],
  awaitingSafetyAnswer: false,
  turnCount: 0,
  updatedAt: null,
};

function exchange(number = 1, overrides = {}) {
  return {
    user: `User turn ${number}`,
    assistant: `Assistant turn ${number}`,
    awaitingSafetyAnswer: false,
    ...overrides,
  };
}

async function controlRow(stub) {
  return runInDurableObject(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec(
        `SELECT state_epoch, expires_at, lease_token, lease_epoch,
                lease_expires_at
         FROM session_control WHERE id = 1`,
      )
      .one();
    return {
      stateEpoch: Number(row.state_epoch) || 0,
      expiresAt: Number(row.expires_at) || null,
      leaseToken: row.lease_token || null,
      leaseEpoch: Number(row.lease_epoch) || null,
      leaseExpiresAt: Number(row.lease_expires_at) || null,
    };
  });
}

async function setControl(stub, assignments) {
  const allowed = new Set([
    "state_epoch",
    "expires_at",
    "lease_token",
    "lease_epoch",
    "lease_expires_at",
  ]);
  const entries = Object.entries(assignments);
  assert.ok(entries.length > 0);
  assert.ok(entries.every(([column]) => allowed.has(column)));
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      `UPDATE session_control
       SET ${entries.map(([column]) => `${column} = ?`).join(", ")}
       WHERE id = 1`,
      ...entries.map(([, value]) => value),
    );
  });
}

test("providerless memory is bounded, account-scoped, and contains no provider tables", async () => {
  const stub = env.SESSIONS.getByName("providerless-memory-bounds-v1");

  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);
  for (let index = 1; index <= 5; index += 1) {
    const result = await stub.recordLocalExchange(exchange(index));
    assert.equal(result.recorded, true);
  }

  const context = await stub.readContext();
  assert.equal(context.turnCount, 5);
  assert.equal(context.recent.length, 8);
  assert.equal(context.recent[0].content, "User turn 2");
  assert.equal(context.recent.at(-1).content, "Assistant turn 5");
  assert.ok((await stub.getLifecycleStatus()).expiresAt > Date.now());

  const providerTables = await runInDurableObject(
    stub,
    (_instance, state) =>
      state.storage.sql
        .exec(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name LIKE 'provider_%'`,
        )
        .toArray()
        .map((row) => row.name),
  );
  assert.deepEqual(providerTables, []);
});

test("one exact 90-second model lease serializes commits", async () => {
  const stub = env.SESSIONS.getByName("providerless-exact-lease-v1");

  const turn = await stub.beginModelTurn();
  assert.equal(turn.acquired, true);
  assert.equal(turn.epoch, 1);
  assert.match(turn.leaseToken, /^lease_[A-Za-z0-9_-]{20,128}$/);
  assert.ok(turn.leaseExpiresAt - Date.now() <= 90_000);
  assert.ok(turn.leaseExpiresAt - Date.now() > 88_000);
  assert.deepEqual(turn.context, EMPTY_CONTEXT);

  const competing = await stub.beginModelTurn();
  assert.equal(competing.acquired, false);
  assert.equal(competing.reason, "turn_in_progress");
  assert.equal(competing.epoch, turn.epoch);

  assert.deepEqual(
    await stub.commitModelTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch + 1,
      exchange: exchange(1),
    }),
    { committed: false, reason: "stale_turn" },
  );

  const committed = await stub.commitModelTurn({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
    exchange: exchange(1),
  });
  assert.equal(committed.committed, true);
  assert.equal(committed.stateEpoch, turn.epoch);
  assert.equal(committed.turnCount, 1);
  assert.equal((await stub.getLifecycleStatus()).hasLease, false);
  assert.equal((await stub.readContext()).turnCount, 1);
});

test("beginning and releasing a turn never refreshes retention", async () => {
  const stub = env.SESSIONS.getByName("providerless-lease-retention-v1");
  await stub.recordLocalExchange(exchange(1));
  const originalExpiry = Date.now() + 60_000;
  await setControl(stub, { expires_at: originalExpiry });

  const turn = await stub.beginModelTurn();
  assert.equal((await controlRow(stub)).expiresAt, originalExpiry);
  assert.equal(
    await stub.releaseModelTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch,
    }),
    true,
  );
  assert.equal((await controlRow(stub)).expiresAt, originalExpiry);

  const empty = env.SESSIONS.getByName("providerless-empty-lease-retention-v1");
  const emptyTurn = await empty.beginModelTurn();
  assert.equal((await controlRow(empty)).expiresAt, null);
  await empty.releaseModelTurn({
    leaseToken: emptyTurn.leaseToken,
    epoch: emptyTurn.epoch,
  });
  assert.equal((await controlRow(empty)).expiresAt, null);
});

test("failed and released commits cannot create or extend retention", async () => {
  const stub = env.SESSIONS.getByName("providerless-stale-no-retention-v1");
  const turn = await stub.beginModelTurn();
  assert.equal(
    await stub.releaseModelTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch,
    }),
    true,
  );

  assert.deepEqual(
    await stub.commitModelTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch,
      exchange: exchange(1),
    }),
    { committed: false, reason: "stale_turn" },
  );
  assert.equal((await stub.getLifecycleStatus()).expiresAt, null);
  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);
});

test("30-day expiry wins over an in-flight model commit and cannot be revived", async () => {
  const stub = env.SESSIONS.getByName("providerless-expiry-beats-commit-v1");
  await stub.recordLocalExchange(exchange(1));
  const turn = await stub.beginModelTurn();
  await setControl(stub, { expires_at: Date.now() - 1 });

  assert.deepEqual(
    await stub.commitModelTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch,
      exchange: exchange(2),
    }),
    { committed: false, reason: "stale_turn" },
  );

  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);
  const status = await stub.getLifecycleStatus();
  assert.equal(status.hasLease, false);
  assert.equal(status.expiresAt, null);
  assert.ok(status.epoch > turn.epoch);
});

test("a deadline crossing alarm I/O is checked with a fresh transaction clock", async () => {
  const stub = env.SESSIONS.getByName("providerless-deadline-await-race-v1");
  await stub.recordLocalExchange(exchange(1));
  const turn = await stub.beginModelTurn();

  const result = await runInDurableObject(stub, async (instance, state) => {
    const originalArm = instance._armAtOrBefore;
    instance._armAtOrBefore = async function armThenExpire(timestamp) {
      await originalArm.call(this, timestamp);
      await new Promise((resolve) => setTimeout(resolve, 10));
      state.storage.sql.exec(
        "UPDATE session_control SET expires_at = ? WHERE id = 1",
        Date.now() - 1,
      );
    };
    try {
      return await instance.commitModelTurn({
        leaseToken: turn.leaseToken,
        epoch: turn.epoch,
        exchange: exchange(2),
      });
    } finally {
      instance._armAtOrBefore = originalArm;
    }
  });

  assert.deepEqual(result, { committed: false, reason: "stale_turn" });
  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);
  assert.equal((await stub.getLifecycleStatus()).expiresAt, null);
});

test("an expired model lease is poisoned before another turn starts", async () => {
  const stub = env.SESSIONS.getByName("providerless-expired-lease-v1");
  const oldTurn = await stub.beginModelTurn();
  await setControl(stub, { lease_expires_at: Date.now() - 1 });

  const newTurn = await stub.beginModelTurn();
  assert.equal(newTurn.acquired, true);
  assert.ok(newTurn.epoch > oldTurn.epoch);
  assert.notEqual(newTurn.leaseToken, oldTurn.leaseToken);

  assert.deepEqual(
    await stub.commitModelTurn({
      leaseToken: oldTurn.leaseToken,
      epoch: oldTurn.epoch,
      exchange: exchange(1),
    }),
    { committed: false, reason: "stale_turn" },
  );
  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);
  assert.equal(
    await stub.releaseModelTurn({
      leaseToken: newTurn.leaseToken,
      epoch: newTurn.epoch,
    }),
    true,
  );
});

test("a fixed safety exchange atomically wins over an older model turn", async () => {
  const stub = env.SESSIONS.getByName("providerless-fixed-wins-v1");
  const oldTurn = await stub.beginModelTurn();

  const fixed = await stub.recordFixedExchange(
    exchange(2, { awaitingSafetyAnswer: true }),
  );
  assert.equal(fixed.recorded, true);
  assert.ok(fixed.stateEpoch > oldTurn.epoch);

  assert.deepEqual(
    await stub.commitModelTurn({
      leaseToken: oldTurn.leaseToken,
      epoch: oldTurn.epoch,
      exchange: exchange(1),
    }),
    { committed: false, reason: "stale_turn" },
  );

  const context = await stub.readContext();
  assert.equal(context.turnCount, 1);
  assert.equal(context.recent[0].content, "User turn 2");
  assert.equal(context.awaitingSafetyAnswer, true);
  assert.equal((await stub.getLifecycleStatus()).hasLease, false);
});

test("a local/demo exchange invalidates an in-flight model turn", async () => {
  const stub = env.SESSIONS.getByName("providerless-local-wins-v1");
  const oldTurn = await stub.beginModelTurn();
  const local = await stub.recordLocalExchange(exchange(2));
  assert.equal(local.recorded, true);
  assert.ok(local.stateEpoch > oldTurn.epoch);

  assert.deepEqual(
    await stub.commitModelTurn({
      leaseToken: oldTurn.leaseToken,
      epoch: oldTurn.epoch,
      exchange: exchange(1),
    }),
    { committed: false, reason: "stale_turn" },
  );
  assert.equal((await stub.readContext()).recent[0].content, "User turn 2");
});

test("legacy writes fail closed after the epoch-bound protocol activates", async () => {
  const stub = env.SESSIONS.getByName("providerless-legacy-fail-closed-v1");
  const legacy = await stub.recordExchange(exchange(1));
  assert.equal(legacy.recorded, true);

  const turn = await stub.beginModelTurn();
  assert.deepEqual(await stub.recordExchange(exchange(2)), {
    recorded: false,
    reason: "legacy_write_blocked",
  });
  await stub.releaseModelTurn({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
  });
  assert.deepEqual(await stub.recordExchange(exchange(2)), {
    recorded: false,
    reason: "legacy_write_blocked",
  });

  const local = await stub.recordLocalExchange(exchange(2));
  assert.equal(local.recorded, true);
  assert.equal((await stub.readContext()).turnCount, 2);
});

test("compaction is version- and epoch-bound without extending retention", async () => {
  const stub = env.SESSIONS.getByName("providerless-compaction-epoch-v1");
  await stub.recordLocalExchange(exchange(1));
  const originalExpiry = Date.now() + 60_000;
  await setControl(stub, { expires_at: originalExpiry });

  const snapshot = await stub.getCompactionSnapshot();
  assert.equal(snapshot.summaryVersion, 0);
  assert.equal(snapshot.messages.length, 2);
  assert.equal(
    await stub.applySummary(
      "An unbound future boundary must not delete recent memory.",
      snapshot.summaryVersion,
      snapshot.throughSequence + 10_000,
      snapshot.stateEpoch,
    ),
    false,
  );
  assert.equal(
    await stub.applySummary(
      "The user values short, concrete plans.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
      snapshot.stateEpoch,
    ),
    true,
  );
  assert.equal((await controlRow(stub)).expiresAt, originalExpiry);
  assert.equal(
    (await stub.readContext()).summary,
    "The user values short, concrete plans.",
  );
  assert.equal(
    await stub.applySummary(
      "A replay must not overwrite the accepted summary.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
      snapshot.stateEpoch,
    ),
    false,
  );

  await stub.recordLocalExchange(exchange(2));
  const staleSnapshot = await stub.getCompactionSnapshot();
  const turn = await stub.beginModelTurn();
  assert.equal(await stub.getCompactionSnapshot(), null);
  await stub.releaseModelTurn({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
  });
  assert.equal(
    await stub.applySummary(
      "A stale compaction must not land.",
      staleSnapshot.summaryVersion,
      staleSnapshot.throughSequence,
      staleSnapshot.stateEpoch,
    ),
    false,
  );
});

test("eraseMemory clears text and invalidates an exact in-flight lease", async () => {
  const stub = env.SESSIONS.getByName("providerless-explicit-erase-v1");
  await stub.recordLocalExchange(exchange(1));
  const turn = await stub.beginModelTurn();

  const deletion = await stub.eraseMemory(Date.now());
  assert.equal(deletion.erased, true);
  assert.ok(Number.isSafeInteger(deletion.erasedAt));
  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);
  const status = await stub.getLifecycleStatus();
  assert.equal(status.hasLease, false);
  assert.equal(status.expiresAt, null);
  assert.ok(status.epoch > turn.epoch);
  assert.deepEqual(
    await stub.commitModelTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch,
      exchange: exchange(2),
    }),
    { committed: false, reason: "stale_turn" },
  );
});

test("requests that began before deletion cannot repopulate memory", async () => {
  const stub = env.SESSIONS.getByName("providerless-erase-request-boundary-v1");
  await stub.recordLocalExchange(exchange(1));
  const staleRequestStartedAt = Date.now();
  const revokedSessionIssuedAtMs = Date.now();
  const deletion = await stub.eraseMemory(revokedSessionIssuedAtMs);
  const freshSessionIssuedAtMs = deletion.nextSessionIssuedAtMs;

  assert.deepEqual(
    await stub.beginModelTurn({
      requestStartedAt: staleRequestStartedAt,
      sessionIssuedAtMs: freshSessionIssuedAtMs,
    }),
    {
      acquired: false,
      leaseToken: null,
      epoch: (await stub.getLifecycleStatus()).epoch,
      leaseExpiresAt: null,
      context: null,
      retryAfterSeconds: 0,
      reason: "memory_deleted",
    },
  );
  assert.deepEqual(
    await stub.recordFixedExchange(
      exchange(2),
      staleRequestStartedAt,
      freshSessionIssuedAtMs,
    ),
    { recorded: false, reason: "memory_deleted" },
  );
  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);

  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.deepEqual(
    await stub.beginModelTurn({
      requestStartedAt: Date.now(),
      sessionIssuedAtMs: revokedSessionIssuedAtMs,
    }),
    {
      acquired: false,
      leaseToken: null,
      epoch: (await stub.getLifecycleStatus()).epoch,
      leaseExpiresAt: null,
      context: null,
      retryAfterSeconds: 0,
      reason: "session_revoked",
    },
  );
  const fresh = await stub.beginModelTurn({
    requestStartedAt: Date.now(),
    sessionIssuedAtMs: freshSessionIssuedAtMs,
  });
  assert.equal(fresh.acquired, true);
  assert.equal(
    (
      await stub.commitModelTurn({
        leaseToken: fresh.leaseToken,
        epoch: fresh.epoch,
        exchange: exchange(3),
      })
    ).committed,
    true,
  );
  assert.equal((await stub.readContext()).recent[0].content, "User turn 3");
});

test("concurrent and repeated deletions advance one atomic session boundary", async () => {
  const stub = env.SESSIONS.getByName("providerless-atomic-delete-boundary-v1");
  const originalSessionIssuedAtMs = Date.now();

  const concurrent = await Promise.all([
    stub.eraseMemory(originalSessionIssuedAtMs),
    stub.eraseMemory(originalSessionIssuedAtMs),
  ]);
  const accepted = concurrent.filter((result) => result.erased === true);
  const rejected = concurrent.filter((result) => result.erased === false);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, "session_revoked");
  assert.deepEqual(await stub.validateSession(originalSessionIssuedAtMs), {
    allowed: false,
  });
  assert.deepEqual(
    await stub.validateSession(accepted[0].nextSessionIssuedAtMs),
    { allowed: true },
  );

  const repeated = await stub.eraseMemory(
    accepted[0].nextSessionIssuedAtMs,
  );
  assert.equal(repeated.erased, true);
  assert.ok(
    repeated.nextSessionIssuedAtMs > accepted[0].nextSessionIssuedAtMs,
  );
  assert.deepEqual(
    await stub.validateSession(accepted[0].nextSessionIssuedAtMs),
    { allowed: false },
  );
  assert.deepEqual(
    await stub.validateSession(repeated.nextSessionIssuedAtMs),
    { allowed: true },
  );
});

test("the Durable Object alarm enforces retention without a new request", async () => {
  const stub = env.SESSIONS.getByName("providerless-alarm-retention-v1");
  await stub.recordLocalExchange(exchange(1));
  await setControl(stub, { expires_at: Date.now() - 1 });

  assert.equal(await runDurableObjectAlarm(stub), true);
  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);
  assert.deepEqual(await stub.getLifecycleStatus(), {
    epoch: 2,
    hasLease: false,
    expiresAt: null,
    leaseExpiresAt: null,
  });
});

test("the alarm expires a lease without erasing still-retained memory", async () => {
  const stub = env.SESSIONS.getByName("providerless-alarm-lease-v1");
  await stub.recordLocalExchange(exchange(1));
  const originalExpiry = (await stub.getLifecycleStatus()).expiresAt;
  const turn = await stub.beginModelTurn();
  await setControl(stub, { lease_expires_at: Date.now() - 1 });

  assert.equal(await runDurableObjectAlarm(stub), true);
  const context = await stub.readContext();
  assert.equal(context.turnCount, 1);
  assert.equal(context.recent[0].content, "User turn 1");

  const status = await stub.getLifecycleStatus();
  assert.equal(status.hasLease, false);
  assert.equal(status.leaseExpiresAt, null);
  assert.equal(status.expiresAt, originalExpiry);
  assert.ok(status.epoch > turn.epoch);
});

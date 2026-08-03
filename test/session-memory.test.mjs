import {
  env,
  evictDurableObject,
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

async function sqliteTableNames(stub) {
  return runInDurableObject(stub, (_instance, state) =>
    state.storage.sql
      .exec(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .toArray()
      .map((row) => row.name),
  );
}

test("local memory is bounded, account-scoped, timestamped, and contains no provider tables", async () => {
  const stub = env.SESSIONS.getByName("providerless-memory-bounds-v1");

  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);
  for (let index = 1; index <= 5; index += 1) {
    const result = await stub.recordLocalExchange(exchange(index));
    assert.equal(result.recorded, true);
  }

  const context = await stub.readContext();
  assert.equal(context.turnCount, 5);
  assert.equal(context.recent.length, 8);
  assert.match(context.recent[0].content, /\[Recorded [^\]]+\]\nUser turn 2$/);
  assert.match(
    context.recent.at(-1).content,
    /\[Recorded [^\]]+\]\nAssistant turn 5$/,
  );
  assert.ok(context.recent.every((message) => message.createdAt > 0));
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

test("a guest hard deadline crossing commit I/O fails closed and stores no text", async () => {
  const stub = env.GUEST_SESSIONS.getByName(
    "guest-hard-deadline-commit-race-v1",
  );
  const sessionIssuedAtMs = Date.now();
  const hardDeleteAtMs = sessionIssuedAtMs + 24 * 60 * 60 * 1_000;
  const turn = await stub.beginModelTurn({
    requestStartedAt: sessionIssuedAtMs,
    sessionIssuedAtMs,
    hardDeleteAtMs,
  });
  assert.equal(turn.acquired, true);

  const result = await runInDurableObject(stub, async (instance, state) => {
    const originalArm = instance._armAtOrBefore;
    instance._armAtOrBefore = async function armThenExpire(timestamp) {
      await originalArm.call(this, timestamp);
      state.storage.sql.exec(
        "UPDATE session_control SET hard_delete_at = ? WHERE id = 1",
        Date.now() - 1,
      );
    };
    try {
      return await instance.commitModelTurn({
        leaseToken: turn.leaseToken,
        epoch: turn.epoch,
        exchange: exchange(1),
        sessionIssuedAtMs,
        hardDeleteAtMs,
      });
    } finally {
      instance._armAtOrBefore = originalArm;
    }
  });

  assert.deepEqual(result, {
    committed: false,
    reason: "session_expired",
  });
  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);
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
  assert.match(context.recent[0].content, /User turn 2$/);
  assert.equal(context.awaitingSafetyAnswer, true);
  assert.equal((await stub.getLifecycleStatus()).hasLease, false);
});

test("a safety question and old risk context lose present-state authority with age", async () => {
  const stub = env.SESSIONS.getByName("timestamped-safety-recency-v1");
  await stub.recordLocalExchange(
    exchange(1, { awaitingSafetyAnswer: true }),
  );

  const now = Date.now();
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE memory_state SET updated_at = ? WHERE id = 1",
      now - 2 * 60 * 60 * 1_000 - 1,
    );
    state.storage.sql.exec(
      "UPDATE recent_messages SET created_at = ?",
      now - 4 * 24 * 60 * 60 * 1_000,
    );
  });

  const context = await stub.readContext();
  assert.equal(context.awaitingSafetyAnswer, false);
  assert.match(context.recent[0].content, /historical context only/);
  assert.match(context.recent[0].content, /not evidence of present danger/);
  assert.match(context.recent[0].content, /User turn 1$/);
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
  assert.match((await stub.readContext()).recent[0].content, /User turn 2$/);
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
  assert.ok(snapshot.summaryUpdatedAt > 0);
  assert.ok(snapshot.messages.every((message) => message.createdAt > 0));
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
  const compacted = await stub.readContext();
  assert.match(compacted.summary, /^\[Historical summary last updated /);
  assert.match(compacted.summary, /Background only:/);
  assert.match(compacted.summary, /The user values short, concrete plans\.$/);
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

  const sessionIssuedAtMs = Date.now();
  const deletion = await stub.eraseMemory(sessionIssuedAtMs);
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
      sessionIssuedAtMs,
    }),
    { committed: false, reason: "session_revoked" },
  );
});

test("a first guest model turn pre-arms its hard deadline before alarm sync", async () => {
  const stub = env.GUEST_SESSIONS.getByName(
    "guest-begin-prearms-hard-delete-v1",
  );
  const sessionIssuedAtMs = Date.now();
  const hardDeleteAtMs = sessionIssuedAtMs + 30_000;

  const observed = await runInDurableObject(
    stub,
    async (instance, state) => {
      const originalSyncAlarm = instance._syncAlarm;
      instance._syncAlarm = async () => {
        throw new Error("injected begin alarm sync failure");
      };
      let failure;
      try {
        await instance.beginModelTurn({
          requestStartedAt: sessionIssuedAtMs,
          sessionIssuedAtMs,
          hardDeleteAtMs,
        });
      } catch (error) {
        failure = error;
      } finally {
        instance._syncAlarm = originalSyncAlarm;
      }

      const control = state.storage.sql
        .exec(
          `SELECT hard_delete_at, lease_token
           FROM session_control WHERE id = 1`,
        )
        .one();
      return {
        failureMessage: failure?.message || null,
        alarm: await state.storage.getAlarm(),
        hardDeleteAt: Number(control.hard_delete_at) || null,
        hasLease: Boolean(control.lease_token),
      };
    },
  );

  assert.equal(observed.failureMessage, "injected begin alarm sync failure");
  assert.ok(observed.alarm !== null);
  assert.ok(observed.alarm <= hardDeleteAtMs);
  assert.equal(observed.hardDeleteAt, hardDeleteAtMs);
  assert.equal(observed.hasLease, true);
});

test("a first guest model commit pre-arms its hard deadline before alarm sync", async () => {
  const stub = env.GUEST_SESSIONS.getByName(
    "guest-commit-prearms-hard-delete-v1",
  );
  const sessionIssuedAtMs = Date.now();
  const initialHardDeleteAtMs = sessionIssuedAtMs + 24 * 60 * 60 * 1_000;
  const turn = await stub.beginModelTurn({
    requestStartedAt: sessionIssuedAtMs,
    sessionIssuedAtMs,
    hardDeleteAtMs: initialHardDeleteAtMs,
  });
  assert.equal(turn.acquired, true);

  const hardDeleteAtMs = Date.now() + 30_000;
  const observed = await runInDurableObject(
    stub,
    async (instance, state) => {
      state.storage.sql.exec(
        "UPDATE session_control SET hard_delete_at = NULL WHERE id = 1",
      );
      await state.storage.deleteAlarm();

      const originalSyncAlarm = instance._syncAlarm;
      instance._syncAlarm = async () => {
        throw new Error("injected commit alarm sync failure");
      };
      let failure;
      try {
        await instance.commitModelTurn({
          leaseToken: turn.leaseToken,
          epoch: turn.epoch,
          exchange: exchange(1),
          sessionIssuedAtMs,
          hardDeleteAtMs,
        });
      } catch (error) {
        failure = error;
      } finally {
        instance._syncAlarm = originalSyncAlarm;
      }

      const control = state.storage.sql
        .exec(
          `SELECT hard_delete_at, lease_token
           FROM session_control WHERE id = 1`,
        )
        .one();
      const memory = state.storage.sql
        .exec("SELECT turn_count FROM memory_state WHERE id = 1")
        .one();
      return {
        failureMessage: failure?.message || null,
        alarm: await state.storage.getAlarm(),
        hardDeleteAt: Number(control.hard_delete_at) || null,
        hasLease: Boolean(control.lease_token),
        turnCount: Number(memory.turn_count) || 0,
      };
    },
  );

  assert.equal(observed.failureMessage, "injected commit alarm sync failure");
  assert.ok(observed.alarm !== null);
  assert.ok(observed.alarm <= hardDeleteAtMs);
  assert.equal(observed.hardDeleteAt, hardDeleteAtMs);
  assert.equal(observed.hasLease, false);
  assert.equal(observed.turnCount, 1);
});

test("a first guest fixed exchange pre-arms its hard deadline before alarm sync", async () => {
  const stub = env.GUEST_SESSIONS.getByName(
    "guest-fixed-prearms-hard-delete-v1",
  );
  const sessionIssuedAtMs = Date.now();
  const hardDeleteAtMs = sessionIssuedAtMs + 30_000;

  const observed = await runInDurableObject(
    stub,
    async (instance, state) => {
      const originalSyncAlarm = instance._syncAlarm;
      instance._syncAlarm = async () => {
        throw new Error("injected fixed alarm sync failure");
      };
      let failure;
      try {
        await instance.recordFixedExchange(
          exchange(1, { awaitingSafetyAnswer: true }),
          sessionIssuedAtMs,
          sessionIssuedAtMs,
          hardDeleteAtMs,
        );
      } catch (error) {
        failure = error;
      } finally {
        instance._syncAlarm = originalSyncAlarm;
      }

      const control = state.storage.sql
        .exec(
          `SELECT hard_delete_at, lease_token
           FROM session_control WHERE id = 1`,
        )
        .one();
      const memory = state.storage.sql
        .exec(
          `SELECT turn_count, awaiting_safety_answer
           FROM memory_state WHERE id = 1`,
        )
        .one();
      return {
        failureMessage: failure?.message || null,
        alarm: await state.storage.getAlarm(),
        hardDeleteAt: Number(control.hard_delete_at) || null,
        hasLease: Boolean(control.lease_token),
        turnCount: Number(memory.turn_count) || 0,
        awaitingSafetyAnswer: Boolean(memory.awaiting_safety_answer),
      };
    },
  );

  assert.equal(observed.failureMessage, "injected fixed alarm sync failure");
  assert.ok(observed.alarm !== null);
  assert.ok(observed.alarm <= hardDeleteAtMs);
  assert.equal(observed.hardDeleteAt, hardDeleteAtMs);
  assert.equal(observed.hasLease, false);
  assert.equal(observed.turnCount, 1);
  assert.equal(observed.awaitingSafetyAnswer, true);
});

test("guest erase pre-arms hard deletion before post-commit alarm sync", async () => {
  const stub = env.GUEST_SESSIONS.getByName(
    "guest-erase-prearms-hard-delete-v1",
  );
  const sessionIssuedAtMs = Date.now();
  const hardDeleteAtMs = sessionIssuedAtMs + 365 * 24 * 60 * 60 * 1_000;

  const observed = await runInDurableObject(
    stub,
    async (instance, state) => {
      const originalSyncAlarm = instance._syncAlarm;
      instance._syncAlarm = async () => {
        throw new Error("injected post-commit alarm sync failure");
      };
      let failure;
      try {
        await instance.eraseMemory(sessionIssuedAtMs, hardDeleteAtMs);
      } catch (error) {
        failure = error;
      } finally {
        instance._syncAlarm = originalSyncAlarm;
      }

      const control = state.storage.sql
        .exec(
          `SELECT last_erased_at, revoked_through_issued_at_ms,
                  hard_delete_at
           FROM session_control WHERE id = 1`,
        )
        .one();
      const memoryRows = Number(
        state.storage.sql
          .exec("SELECT COUNT(*) AS count FROM memory_state")
          .one().count,
      );
      const recentRows = Number(
        state.storage.sql
          .exec("SELECT COUNT(*) AS count FROM recent_messages")
          .one().count,
      );
      return {
        failureMessage: failure?.message || null,
        alarm: await state.storage.getAlarm(),
        lastErasedAt: Number(control.last_erased_at) || null,
        revokedThrough:
          Number(control.revoked_through_issued_at_ms) || null,
        hardDeleteAt: Number(control.hard_delete_at) || null,
        memoryRows,
        recentRows,
      };
    },
  );

  assert.equal(
    observed.failureMessage,
    "injected post-commit alarm sync failure",
  );
  assert.ok(observed.alarm !== null);
  assert.ok(observed.alarm <= hardDeleteAtMs);
  assert.ok(observed.lastErasedAt >= sessionIssuedAtMs);
  assert.ok(observed.revokedThrough >= sessionIssuedAtMs);
  assert.equal(observed.hardDeleteAt, hardDeleteAtMs);
  assert.equal(observed.memoryRows, 0);
  assert.equal(observed.recentRows, 0);
});

test("a redelivered guest alarm removes constructor state after hard deletion", async () => {
  const stub = env.GUEST_SESSIONS.getByName(
    "guest-hard-delete-alarm-redelivery-v1",
  );
  const sessionIssuedAtMs = Date.now();
  const hardDeleteAtMs = sessionIssuedAtMs + 24 * 60 * 60 * 1_000;
  const turn = await stub.beginModelTurn({
    requestStartedAt: sessionIssuedAtMs,
    sessionIssuedAtMs,
    hardDeleteAtMs,
  });
  assert.equal(turn.acquired, true);

  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE session_control SET hard_delete_at = ? WHERE id = 1",
      Date.now() - 1,
    );
    await state.storage.setAlarm(Date.now() + 60_000);
  });
  assert.equal(await runDurableObjectAlarm(stub), true);
  assert.deepEqual(await sqliteTableNames(stub), []);

  await evictDurableObject(stub);
  await runInDurableObject(stub, async (_instance, state) => {
    const control = state.storage.sql
      .exec("SELECT hard_delete_at FROM session_control WHERE id = 1")
      .one();
    assert.equal(control.hard_delete_at, null);
    await state.storage.setAlarm(Date.now() + 60_000);
  });

  assert.equal(await runDurableObjectAlarm(stub), true);
  assert.deepEqual(await sqliteTableNames(stub), []);
});

test("a delayed guest lease release removes constructor state after deleteAll", async () => {
  const stub = env.GUEST_SESSIONS.getByName(
    "guest-release-after-delete-all-v1",
  );
  const sessionIssuedAtMs = Date.now();
  const hardDeleteAtMs = sessionIssuedAtMs + 24 * 60 * 60 * 1_000;
  const turn = await stub.beginModelTurn({
    requestStartedAt: sessionIssuedAtMs,
    sessionIssuedAtMs,
    hardDeleteAtMs,
  });
  assert.equal(turn.acquired, true);

  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.deleteAll();
  });
  await evictDurableObject(stub);

  assert.equal(
    await stub.releaseModelTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch,
    }),
    false,
  );
  assert.deepEqual(await sqliteTableNames(stub), []);
});

test("guest read-only RPCs remove fresh state without a signed deadline", async () => {
  const cases = [
    ["read", (stub) => stub.readContext(), EMPTY_CONTEXT],
    [
      "release",
      (stub) =>
        stub.releaseModelTurn({
          leaseToken: `lease_${"a".repeat(32)}`,
          epoch: 1,
        }),
      false,
    ],
    ["compaction", (stub) => stub.getCompactionSnapshot(), null],
    [
      "summary",
      (stub) => stub.applySummary("Bounded summary", 0, 1, 0),
      false,
    ],
    ["validate", (stub) => stub.validateSession(Date.now()), { allowed: false }],
    [
      "status",
      (stub) => stub.getLifecycleStatus(),
      {
        epoch: 0,
        hasLease: false,
        expiresAt: null,
        leaseExpiresAt: null,
      },
    ],
  ];

  for (const [name, invoke, fallback] of cases) {
    const stub = env.GUEST_SESSIONS.getByName(
      `guest-missing-deadline-${name}-v1`,
    );
    assert.deepEqual(await invoke(stub), fallback);
    assert.deepEqual(await sqliteTableNames(stub), []);
  }
});

test("guest writes without a valid signed deadline leave no constructor state", async () => {
  const now = Date.now();
  const tooDistantDeadline = now + 367 * 24 * 60 * 60 * 1_000;
  const cases = [
    [
      "begin",
      (stub) =>
        stub.beginModelTurn({
          requestStartedAt: now,
          sessionIssuedAtMs: now,
        }),
      { acquired: false, reason: "invalid_storage_deadline" },
    ],
    [
      "commit",
      (stub) =>
        stub.commitModelTurn({
          leaseToken: `lease_${"a".repeat(32)}`,
          epoch: 1,
          exchange: exchange(1),
          sessionIssuedAtMs: now,
        }),
      { committed: false, reason: "invalid_storage_deadline" },
    ],
    [
      "fixed",
      (stub) =>
        stub.recordFixedExchange(
          exchange(1),
          now,
          now,
          tooDistantDeadline,
        ),
      { recorded: false, reason: "invalid_storage_deadline" },
    ],
    [
      "erase",
      (stub) => stub.eraseMemory(now, "not-a-deadline"),
      { erased: false, reason: "invalid_storage_deadline" },
    ],
  ];

  for (const [name, invoke, fallback] of cases) {
    const stub = env.GUEST_SESSIONS.getByName(
      `guest-invalid-deadline-${name}-v1`,
    );
    assert.deepEqual(await invoke(stub), fallback);
    assert.deepEqual(await sqliteTableNames(stub), []);
  }
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
        sessionIssuedAtMs: freshSessionIssuedAtMs,
        exchange: exchange(3),
      })
    ).committed,
    true,
  );
  assert.match((await stub.readContext()).recent[0].content, /User turn 3$/);
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
  assert.match(context.recent[0].content, /User turn 1$/);

  const status = await stub.getLifecycleStatus();
  assert.equal(status.hasLease, false);
  assert.equal(status.leaseExpiresAt, null);
  assert.equal(status.expiresAt, originalExpiry);
  assert.ok(status.epoch > turn.epoch);
});

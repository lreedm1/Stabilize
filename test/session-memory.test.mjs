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

async function forceDeadlinePast(stub, column) {
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      `UPDATE session_control SET ${column} = ? WHERE id = 1`,
      Date.now() - 1,
    );
  });
}

async function makeCleanupDue(stub) {
  await runInDurableObject(stub, (_instance, state) => {
    const past = Date.now() - 1;
    state.storage.sql.exec(
      `UPDATE provider_cleanup
       SET not_before = ?, next_attempt_at = ?,
           claim_token = NULL, claim_expires_at = NULL`,
      past,
      past,
    );
  });
}

async function runAlarmWithProvider(stub, providerFetch) {
  return runInDurableObject(stub, async (instance, state) => {
    const originalFetch = globalThis.fetch;
    const originalEnv = instance.env;
    instance.env = { ...originalEnv, OPENAI_API_KEY: "test-openai-key" };
    globalThis.fetch = providerFetch;
    try {
      await state.storage.deleteAlarm();
      await instance.alarm();
      return true;
    } finally {
      globalThis.fetch = originalFetch;
      instance.env = originalEnv;
    }
  });
}

test("Durable Object stores and epoch-compacts one session", async () => {
  const stub = env.SESSIONS.getByName("session-memory-lifecycle-v2");

  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);

  const recorded = await stub.recordExchange({
    user: "I prefer short plans.",
    assistant: "Choose one five-minute action.",
    awaitingSafetyAnswer: false,
  });
  assert.equal(recorded.recorded, true);
  assert.equal(recorded.shouldCompact, true);
  assert.equal(recorded.turnCount, 1);

  const snapshot = await stub.getCompactionSnapshot();
  assert.equal(snapshot.summaryVersion, 0);
  assert.equal(snapshot.stateEpoch, 0);
  assert.equal(snapshot.messages.length, 2);
  assert.equal(
    await stub.applySummary(
      "The user prefers short, concrete plans.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
      snapshot.stateEpoch,
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
      snapshot.stateEpoch,
    ),
    false,
  );
});

test("Durable Object bounds uncondensed recent messages", async () => {
  const stub = env.SESSIONS.getByName("session-memory-bounds-v2");

  for (let index = 1; index <= 5; index += 1) {
    await stub.recordExchange(exchange(index));
  }

  const context = await stub.readContext();
  assert.equal(context.turnCount, 5);
  assert.equal(context.recent.length, 8);
  assert.equal(context.recent[0].content, "User turn 2");
  assert.equal(context.recent.at(-1).content, "Assistant turn 5");
});

test("provider turns require one exact live lease and epoch", async () => {
  const stub = env.SESSIONS.getByName("session-memory-provider-lease");

  const turn = await stub.beginProviderTurn();
  assert.equal(turn.acquired, true);
  assert.equal(turn.epoch, 1);
  assert.equal(turn.conversationId, null);
  assert.deepEqual(turn.context, EMPTY_CONTEXT);

  const competing = await stub.beginProviderTurn();
  assert.equal(competing.acquired, false);
  assert.equal(competing.reason, "turn_in_progress");

  assert.deepEqual(await stub.recordExchange(exchange(99)), {
    recorded: false,
    reason: "legacy_write_blocked",
  });

  const adoption = await stub.adoptProviderConversation({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
    candidateId: "conv_primary_test",
  });
  assert.equal(adoption.accepted, true);
  assert.equal(adoption.adopted, true);
  assert.equal(adoption.conversationId, "conv_primary_test");

  assert.deepEqual(
    await stub.commitProviderTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch + 1,
      conversationId: "conv_primary_test",
      exchange: exchange(1),
    }),
    { committed: false, reason: "stale_turn" },
  );

  const committed = await stub.commitProviderTurn({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
    conversationId: "conv_primary_test",
    exchange: exchange(1),
  });
  assert.equal(committed.committed, true);
  assert.equal(committed.turnCount, 1);

  const next = await stub.beginProviderTurn();
  assert.equal(next.acquired, true);
  assert.equal(next.epoch, turn.epoch + 1);
  assert.equal(next.conversationId, "conv_primary_test");
  assert.equal(next.context.turnCount, 1);
  assert.equal(
    await stub.releaseProviderTurn({
      leaseToken: next.leaseToken,
      epoch: next.epoch,
    }),
    true,
  );
  assert.deepEqual(await stub.recordExchange(exchange(2)), {
    recorded: false,
    reason: "legacy_write_blocked",
  });
});

test("Conversation adoption does not extend local text retention", async () => {
  const stub = env.SESSIONS.getByName("session-memory-adoption-retention");
  await stub.recordExchange(exchange(1));
  const originalExpiry = Date.now() + 60_000;
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE session_control SET expires_at = ? WHERE id = 1",
      originalExpiry,
    );
  });

  const turn = await stub.beginProviderTurn();
  const adopted = await stub.adoptProviderConversation({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
    candidateId: "conv_adoption_retention",
  });

  assert.equal(adopted.accepted, true);
  assert.equal((await stub.getLifecycleStatus()).expiresAt, originalExpiry);
});

test("new local writes invalidate provider state while legacy writes stay blocked", async () => {
  const stub = env.SESSIONS.getByName("session-memory-local-epoch-write");
  const turn = await stub.beginProviderTurn();
  await stub.adoptProviderConversation({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
    candidateId: "conv_local_switch",
  });

  const local = await stub.recordLocalExchange(exchange(1));
  assert.equal(local.recorded, true);
  assert.ok(local.stateEpoch > turn.epoch);
  assert.equal((await stub.getLifecycleStatus()).hasActiveConversation, false);
  assert.equal((await stub.getLifecycleStatus()).cleanupPending, 1);
  assert.deepEqual(await stub.recordExchange(exchange(2)), {
    recorded: false,
    reason: "legacy_write_blocked",
  });
  assert.equal((await stub.readContext()).turnCount, 1);
});

test("a create timeout can quarantine a lease before any conversation ID exists", async () => {
  const stub = env.SESSIONS.getByName("session-memory-null-quarantine");
  const turn = await stub.beginProviderTurn();

  assert.equal(
    await stub.quarantineProviderTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch,
      conversationId: null,
    }),
    true,
  );

  const status = await stub.getLifecycleStatus();
  assert.equal(status.hasLease, false);
  assert.equal(status.hasActiveConversation, false);
  assert.equal(status.cleanupPending, 0);
  assert.ok(status.epoch > turn.epoch);

  assert.equal((await stub.beginProviderTurn()).acquired, true);
});

test("an uncertain adoption durably queues its known candidate", async () => {
  const stub = env.SESSIONS.getByName("session-memory-adoption-ambiguity");
  const turn = await stub.beginProviderTurn();

  assert.equal(
    await stub.quarantineProviderTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch,
      conversationId: "conv_uncertain_adoption",
    }),
    true,
  );

  const status = await stub.getLifecycleStatus();
  assert.equal(status.hasLease, false);
  assert.equal(status.hasActiveConversation, false);
  assert.equal(status.cleanupPending, 1);
});

test("a fixed route invalidates an in-flight provider response", async () => {
  const stub = env.SESSIONS.getByName("session-memory-fixed-route-race");
  const first = await stub.beginProviderTurn();
  await stub.adoptProviderConversation({
    leaseToken: first.leaseToken,
    epoch: first.epoch,
    candidateId: "conv_fixed_route_test",
  });
  await stub.commitProviderTurn({
    leaseToken: first.leaseToken,
    epoch: first.epoch,
    conversationId: "conv_fixed_route_test",
    exchange: exchange(1),
  });

  const deferred = await stub.beginProviderTurn();
  const fixed = await stub.recordFixedExchange({
    user: "A bounded safety answer",
    assistant: "The deterministic safety route wins.",
    awaitingSafetyAnswer: true,
  });
  assert.equal(fixed.recorded, true);
  assert.ok(fixed.stateEpoch > deferred.epoch);

  assert.deepEqual(
    await stub.commitProviderTurn({
      leaseToken: deferred.leaseToken,
      epoch: deferred.epoch,
      conversationId: "conv_fixed_route_test",
      exchange: exchange(2),
    }),
    { committed: false, reason: "stale_turn" },
  );

  const context = await stub.readContext();
  assert.equal(context.awaitingSafetyAnswer, true);
  assert.equal(context.recent.at(-1).content, "The deterministic safety route wins.");
  assert.deepEqual(await stub.getLifecycleStatus(), {
    epoch: fixed.stateEpoch,
    hasActiveConversation: false,
    hasLease: false,
    cleanupPending: 1,
    expiresAt: (await stub.getLifecycleStatus()).expiresAt,
    leaseExpiresAt: null,
  });
});

test("an ambiguous local commit can quarantine the just-completed exact turn", async () => {
  const stub = env.SESSIONS.getByName("session-memory-post-commit-quarantine");
  const turn = await stub.beginProviderTurn();
  await stub.adoptProviderConversation({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
    candidateId: "conv_ambiguous_commit",
  });
  assert.equal(
    (
      await stub.commitProviderTurn({
        leaseToken: turn.leaseToken,
        epoch: turn.epoch,
        conversationId: "conv_ambiguous_commit",
        exchange: exchange(1),
      })
    ).committed,
    true,
  );

  assert.equal(
    await stub.quarantineProviderTurn({
      leaseToken: turn.leaseToken,
      epoch: turn.epoch,
      conversationId: "conv_ambiguous_commit",
    }),
    true,
  );
  const status = await stub.getLifecycleStatus();
  assert.equal(status.hasActiveConversation, false);
  assert.equal(status.cleanupPending, 1);
  assert.equal((await stub.beginProviderTurn()).conversationId, null);
});

test("an ambiguous old completion invalidates a newer in-flight lease", async () => {
  const stub = env.SESSIONS.getByName("session-memory-late-commit-ambiguity");
  const ambiguous = await stub.beginProviderTurn();
  await stub.adoptProviderConversation({
    leaseToken: ambiguous.leaseToken,
    epoch: ambiguous.epoch,
    candidateId: "conv_late_ambiguity",
  });
  assert.equal(
    (
      await stub.commitProviderTurn({
        leaseToken: ambiguous.leaseToken,
        epoch: ambiguous.epoch,
        conversationId: "conv_late_ambiguity",
        exchange: exchange(1),
      })
    ).committed,
    true,
  );

  // The first commit response may have been lost while another device began
  // the next turn. The old exact token remains authoritative until this newer
  // turn successfully commits and replaces it.
  const newer = await stub.beginProviderTurn();
  assert.equal(newer.conversationId, "conv_late_ambiguity");
  assert.equal(
    await stub.quarantineProviderTurn({
      leaseToken: ambiguous.leaseToken,
      epoch: ambiguous.epoch,
      conversationId: "conv_late_ambiguity",
    }),
    true,
  );

  const status = await stub.getLifecycleStatus();
  assert.equal(status.hasActiveConversation, false);
  assert.equal(status.hasLease, false);
  assert.equal(status.cleanupPending, 1);
  assert.deepEqual(
    await stub.commitProviderTurn({
      leaseToken: newer.leaseToken,
      epoch: newer.epoch,
      conversationId: "conv_late_ambiguity",
      exchange: exchange(2),
    }),
    { committed: false, reason: "stale_turn" },
  );
});

test("stale conversation adoption leaves a durable cleanup tombstone", async () => {
  const stub = env.SESSIONS.getByName("session-memory-stale-adoption");
  const stale = await stub.beginProviderTurn();
  await stub.recordFixedExchange(exchange(1));

  const adoption = await stub.adoptProviderConversation({
    leaseToken: stale.leaseToken,
    epoch: stale.epoch,
    candidateId: "conv_losing_candidate",
  });
  assert.equal(adoption.accepted, false);
  assert.equal(adoption.reason, "stale_turn");
  assert.equal((await stub.getLifecycleStatus()).cleanupPending, 1);
});

test("an expired provider lease poisons the old conversation before reseeding", async () => {
  const stub = env.SESSIONS.getByName("session-memory-expired-lease");
  const stale = await stub.beginProviderTurn();
  await stub.adoptProviderConversation({
    leaseToken: stale.leaseToken,
    epoch: stale.epoch,
    candidateId: "conv_expired_lease",
  });
  await forceDeadlinePast(stub, "lease_expires_at");

  const replacement = await stub.beginProviderTurn();
  assert.equal(replacement.acquired, true);
  assert.equal(replacement.conversationId, null);
  assert.ok(replacement.epoch > stale.epoch);
  assert.equal((await stub.getLifecycleStatus()).cleanupPending, 1);
});

test("compaction snapshots cannot ABA-apply across provider epochs", async () => {
  const stub = env.SESSIONS.getByName("session-memory-compaction-epoch");
  await stub.recordExchange(exchange(1));
  const snapshot = await stub.getCompactionSnapshot();

  const turn = await stub.beginProviderTurn();
  await stub.releaseProviderTurn({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
  });

  assert.equal(
    await stub.applySummary(
      "This summary belongs to the old epoch.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
      snapshot.stateEpoch,
    ),
    false,
  );
});

test("retention erases local text before provider cleanup can fail", async () => {
  const stub = env.SESSIONS.getByName("session-memory-retention-cleanup-failure");
  const turn = await stub.beginProviderTurn();
  await stub.adoptProviderConversation({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
    candidateId: "conv_retention_cleanup",
  });
  await stub.commitProviderTurn({
    leaseToken: turn.leaseToken,
    epoch: turn.epoch,
    conversationId: "conv_retention_cleanup",
    exchange: {
      user: "Keep this only for the retention window.",
      assistant: "Stored for bounded continuity.",
      awaitingSafetyAnswer: false,
    },
  });
  await forceDeadlinePast(stub, "expires_at");

  assert.equal(await runDurableObjectAlarm(stub), true);
  assert.deepEqual(await stub.readContext(), EMPTY_CONTEXT);
  const status = await stub.getLifecycleStatus();
  assert.equal(status.hasActiveConversation, false);
  assert.equal(status.cleanupPending, 1);
  assert.equal(status.expiresAt, null);
});

test("a fixed route cannot revive context beyond its retention deadline", async () => {
  const stub = env.SESSIONS.getByName("session-memory-fixed-expiry");
  await stub.recordExchange(exchange(1));
  await forceDeadlinePast(stub, "expires_at");

  await stub.recordFixedExchange({
    user: "New bounded route",
    assistant: "Only this new route remains.",
    awaitingSafetyAnswer: false,
  });

  const context = await stub.readContext();
  assert.equal(context.turnCount, 1);
  assert.deepEqual(
    context.recent.map(({ content }) => content),
    ["New bounded route", "Only this new route remains."],
  );
});

test("cleanup deletes bounded item pages before the Conversation container", async () => {
  const stub = env.SESSIONS.getByName("session-memory-item-first-cleanup");
  const requests = [];
  await stub.purgeUnusedOpenAIConversation("conv_item_first");

  await runAlarmWithProvider(stub, async (input, init = {}) => {
    const request = { url: String(input), method: init.method || "GET" };
    requests.push(request);
    if (request.method === "GET") {
      return Response.json({
        object: "list",
        data: [{ id: "msg_one" }, { id: "msg_two" }],
        has_more: false,
      });
    }
    return Response.json({});
  });

  assert.match(requests[0].url, /items\?limit=20&order=desc$/);
  assert.deepEqual(
    requests.map(({ method }) => method),
    ["GET", "DELETE", "DELETE"],
  );
  assert.ok(requests.slice(1).every(({ url }) => /\/items\/msg_/.test(url)));
  assert.equal((await stub.getLifecycleStatus()).cleanupPending, 1);

  await makeCleanupDue(stub);
  requests.length = 0;
  await runAlarmWithProvider(stub, async (input, init = {}) => {
    const request = { url: String(input), method: init.method || "GET" };
    requests.push(request);
    if (request.method === "GET") {
      return Response.json({ object: "list", data: [], has_more: false });
    }
    return Response.json({
      id: "conv_item_first",
      object: "conversation.deleted",
      deleted: true,
    });
  });

  assert.deepEqual(
    requests.map(({ method }) => method),
    ["GET", "DELETE"],
  );
  assert.equal(requests[1].url.endsWith("/conv_item_first"), true);
  assert.equal((await stub.getLifecycleStatus()).cleanupPending, 0);
});

test("malformed and 404 item listings never complete deletion", async () => {
  const malformed = env.SESSIONS.getByName("session-memory-malformed-cleanup");
  await malformed.purgeUnusedOpenAIConversation("conv_malformed_list");
  await runAlarmWithProvider(malformed, async () => Response.json({}));
  assert.equal((await malformed.getLifecycleStatus()).cleanupPending, 1);

  const missing = env.SESSIONS.getByName("session-memory-404-cleanup");
  const requests = [];
  await missing.purgeUnusedOpenAIConversation("conv_missing_list");
  await runAlarmWithProvider(missing, async (input, init = {}) => {
    requests.push({ url: String(input), method: init.method || "GET" });
    return new Response(null, { status: 404 });
  });
  assert.deepEqual(requests.map(({ method }) => method), ["GET"]);
  assert.equal((await missing.getLifecycleStatus()).cleanupPending, 1);
});

test("a malformed final Conversation deletion keeps the cleanup tombstone", async () => {
  const stub = env.SESSIONS.getByName("session-memory-malformed-final-delete");
  await stub.purgeUnusedOpenAIConversation("conv_malformed_delete");
  await runAlarmWithProvider(stub, async (_input, init = {}) => {
    if ((init.method || "GET") === "GET") {
      return Response.json({ object: "list", data: [], has_more: false });
    }
    return Response.json({ id: "conv_malformed_delete", deleted: false });
  });

  assert.equal((await stub.getLifecycleStatus()).cleanupPending, 1);
});

test("a cleanup claim covers the maximum bounded provider operation", async () => {
  const stub = env.SESSIONS.getByName("session-memory-cleanup-claim-window");
  await stub.purgeUnusedOpenAIConversation("conv_claim_window");
  await makeCleanupDue(stub);

  const claimWindow = await runInDurableObject(stub, (instance, state) => {
    const now = Date.now();
    const claim = instance._claimDueCleanup(now);
    assert.ok(claim);
    const row = state.storage.sql
      .exec(
        "SELECT claim_expires_at FROM provider_cleanup WHERE conversation_id = ?",
        "conv_claim_window",
      )
      .one();
    return Number(row.claim_expires_at) - now;
  });

  assert.ok(claimWindow >= 470_000);
});

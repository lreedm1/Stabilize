import { env, runDurableObjectAlarm } from "cloudflare:test";
import { test } from "vitest";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { COPY } from "../src/copy.js";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionTokenForGoogleSubject,
  readAuthSession,
} from "../src/auth.js";

const GOOGLE_CLIENT_ID =
  "1234567890-stabilize-memory-tests.apps.googleusercontent.com";
const AUTH_SECRET =
  "memory-deletion-test-secret-with-at-least-thirty-two-characters";

function createEnv(overrides = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 }),
    },
    SESSIONS: env.SESSIONS,
    DEMO_MODE: "true",
    OPENAI_MODEL: "gpt-5.4",
    OPENAI_REASONING_EFFORT: "none",
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    AUTH_SECRET,
    PUBLIC_ORIGIN: "https://stabilize.test",
    ...overrides,
  };
}

async function authenticatedIdentity(workerEnv, subject) {
  const token = await createAuthSessionTokenForGoogleSubject(subject, workerEnv);
  const cookie = `${AUTH_COOKIE_NAME}=${token}`;
  const session = await readAuthSession(
    new Request("https://stabilize.test/", {
      headers: { Cookie: cookie },
    }),
    workerEnv,
  );
  assert.ok(session);
  return {
    cookie,
    objectName: `google:${session.accountKey}`,
  };
}

function emptyContext() {
  return {
    summary: "",
    recent: [],
    awaitingSafetyAnswer: false,
    turnCount: 0,
    updatedAt: null,
  };
}

test("deletion clears remembered content and rejects older writes and compactions", async () => {
  const stub = env.SESSIONS.getByName(
    "memory-deletion-generation-fence-v1",
  );
  const generation = await stub.readGeneration();
  assert.equal(generation, 0);

  const recorded = await stub.recordExchange(
    {
      user: "Remember that I prefer short plans.",
      assistant: "I will keep plans short.",
      awaitingSafetyAnswer: true,
    },
    generation,
  );
  assert.equal(recorded.accepted, true);

  const snapshot = await stub.getCompactionSnapshot();
  assert.ok(snapshot);
  assert.equal(snapshot.generation, generation);

  const deleted = await stub.deleteRememberedContext();
  assert.deepEqual(deleted, { deleted: true, generation: generation + 1 });
  assert.deepEqual(await stub.readContext(), emptyContext());

  const postDelete = await stub.readContextWithGeneration();
  assert.equal(postDelete.generation, generation + 1);
  assert.deepEqual(
    {
      summary: postDelete.summary,
      recent: postDelete.recent,
      awaitingSafetyAnswer: postDelete.awaitingSafetyAnswer,
      turnCount: postDelete.turnCount,
      updatedAt: postDelete.updatedAt,
    },
    emptyContext(),
  );

  const staleWrite = await stub.recordExchange(
    {
      user: "This request started before deletion.",
      assistant: "This response must not rebuild memory.",
      awaitingSafetyAnswer: false,
    },
    generation,
  );
  assert.equal(staleWrite.accepted, false);
  assert.equal(staleWrite.stale, true);

  assert.equal(
    await stub.applySummary(
      "A late summary must not restore deleted context.",
      snapshot.summaryVersion,
      snapshot.throughSequence,
      snapshot.generation,
    ),
    false,
  );
  assert.deepEqual(await stub.readContext(), emptyContext());

  const freshWrite = await stub.recordExchange(
    {
      user: "This is a new exchange after deletion.",
      assistant: "This exchange may be remembered.",
      awaitingSafetyAnswer: false,
    },
    deleted.generation,
  );
  assert.equal(freshWrite.accepted, true);
  assert.equal((await stub.readContext()).turnCount, 1);
});

test("explicit deletion removes the retention alarm", async () => {
  const stub = env.SESSIONS.getByName("memory-deletion-alarm-v1");
  const generation = await stub.readGeneration();

  await stub.recordExchange(
    {
      user: "Store this briefly.",
      assistant: "Stored for bounded continuity.",
      awaitingSafetyAnswer: false,
    },
    generation,
  );
  await stub.deleteRememberedContext();

  assert.equal(await runDurableObjectAlarm(stub), false);
  assert.deepEqual(await stub.readContext(), emptyContext());
});

test("authenticated same-origin deletion erases account memory without touching billing", async () => {
  let billingTouches = 0;
  const workerEnv = createEnv({
    BILLING: {
      getByName() {
        billingTouches += 1;
        throw new Error("Billing must not be used by memory deletion");
      },
    },
  });
  const identity = await authenticatedIdentity(
    workerEnv,
    "memory-deletion-route-user",
  );
  const stub = env.SESSIONS.getByName(identity.objectName);
  const generation = await stub.readGeneration();

  await stub.recordExchange(
    {
      user: "Remember this account context.",
      assistant: "Account context stored.",
      awaitingSafetyAnswer: true,
    },
    generation,
  );

  const response = await worker.fetch(
    new Request("https://stabilize.test/api/account/memory", {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Cookie: identity.cookie,
        Origin: "https://stabilize.test",
      },
    }),
    workerEnv,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(await stub.readContext(), emptyContext());
  assert.equal(await stub.readGeneration(), generation + 1);
  assert.equal(billingTouches, 0);

  const restoredIdentity = await authenticatedIdentity(
    workerEnv,
    "memory-deletion-route-user",
  );
  assert.equal(restoredIdentity.objectName, identity.objectName);
  assert.deepEqual(
    await env.SESSIONS.getByName(restoredIdentity.objectName).readContext(),
    emptyContext(),
  );
});

test("memory deletion requires authentication and same-origin browser requests", async () => {
  const workerEnv = createEnv();

  const unsigned = await worker.fetch(
    new Request("https://stabilize.test/api/account/memory", {
      method: "DELETE",
      headers: { Origin: "https://stabilize.test" },
    }),
    workerEnv,
  );
  assert.equal(unsigned.status, 401);
  assert.deepEqual(await unsigned.json(), {
    error: COPY.api.signInRequired,
  });

  const identity = await authenticatedIdentity(
    workerEnv,
    "memory-deletion-origin-user",
  );
  const crossOrigin = await worker.fetch(
    new Request("https://stabilize.test/api/account/memory", {
      method: "DELETE",
      headers: {
        Cookie: identity.cookie,
        Origin: "https://attacker.invalid",
      },
    }),
    workerEnv,
  );
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(await crossOrigin.json(), {
    error: COPY.api.crossOriginRequest,
  });

  const wrongMethod = await worker.fetch(
    new Request("https://stabilize.test/api/account/memory", {
      method: "GET",
      headers: {
        Cookie: identity.cookie,
        Origin: "https://stabilize.test",
      },
    }),
    workerEnv,
  );
  assert.equal(wrongMethod.status, 405);
  assert.deepEqual(await wrongMethod.json(), {
    error: COPY.api.methodNotAllowed,
  });
});

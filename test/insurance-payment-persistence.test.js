"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const DiseasePayment = require("../disease-payment-service");
const Persistence = require("../insurance-payment-persistence");

function createRepository(initialState, options = {}) {
  return Persistence.createInMemoryInsurancePaymentRepository(initialState, {
    createdAt: "2026-07-29T01:00:00.000Z",
    ...options
  });
}

function command(overrides = {}) {
  return {
    commandId: "cmd-calculate-001",
    commandType: "disease-payment.calculate-all",
    payload: { mode: "DRG" },
    expectedVersion: 0,
    actor: "insurance-operator",
    traceId: "trace-calculate-001",
    occurredAt: "2026-07-29T02:00:00.000Z",
    ...overrides
  };
}

test("commits disease-payment state command receipt and outbox event atomically", async () => {
  const repository = Persistence.createInMemoryInsurancePaymentRepository(DiseasePayment.seedDiseasePaymentState(), { createdAt: "2026-07-29T01:00:00.000Z" });
  const committed = await Persistence.executeInsurancePaymentCommand(repository, command(), (state) => {
    const nextState = DiseasePayment.calculateAll(state, "insurance-operator");
    return {
      nextState,
      result: { calculated: nextState.cases.length },
      eventType: "disease-payment.calculated",
      eventPayload: { mode: nextState.mode, caseCount: nextState.cases.length }
    };
  });

  assert.equal(committed.idempotentReplay, false);
  assert.equal(committed.snapshot.version, 1);
  assert.equal(committed.result.calculated, 3);
  assert.equal(committed.outboxEvent.aggregateVersion, 1);
  assert.equal(committed.outboxEvent.status, "pending");
  assert.equal(committed.outboxEvent.payload.caseCount, 3);
  assert.equal(committed.snapshot.state.cases.every((item) => item.calculation), true);
  const checkpoint = await repository.exportCheckpoint();
  assert.equal(Persistence.verifyPersistenceRecord(checkpoint), true);
  assert.equal(checkpoint.commands.length, 1);
  assert.equal(checkpoint.outbox.length, 1);
});

test("replays the same command without a second mutation and rejects key reuse", async () => {
  const repository = createRepository({ counter: 0 });
  let mutationCount = 0;
  const mutate = (state) => {
    mutationCount += 1;
    state.counter += 1;
    return { result: { counter: state.counter }, eventType: "counter.incremented", eventPayload: { counter: state.counter } };
  };
  const first = await repository.transact(command({ commandType: "counter.increment", payload: { amount: 1 } }), mutate);
  const replay = await repository.transact(command({ commandType: "counter.increment", payload: { amount: 1 } }), mutate);

  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.result.counter, 1);
  assert.equal(replay.snapshot.version, 1);
  assert.equal(mutationCount, 1);
  await assert.rejects(
    repository.transact(command({ commandType: "counter.increment", payload: { amount: 2 } }), mutate),
    (error) => error.code === "PERSISTENCE_COMMAND_CONFLICT" && error.status === 409
  );
});

test("serializes concurrent writes and rejects a stale expected version", async () => {
  const repository = createRepository({ values: [] });
  const mutate = (value) => async (state) => {
    await new Promise((resolve) => setTimeout(resolve, value === "first" ? 10 : 0));
    state.values.push(value);
    return { result: value, eventType: "value.appended", eventPayload: { value } };
  };
  const outcomes = await Promise.allSettled([
    repository.transact(command({ commandId: "cmd-first", commandType: "append", payload: { value: "first" } }), mutate("first")),
    repository.transact(command({ commandId: "cmd-second", commandType: "append", payload: { value: "second" } }), mutate("second"))
  ]);

  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[1].status, "rejected");
  assert.equal(outcomes[1].reason.code, "PERSISTENCE_VERSION_CONFLICT");
  assert.deepEqual((await repository.load()).state.values, ["first"]);
});

test("rolls back state event and command receipt when the mutator fails", async () => {
  const repository = createRepository({ counter: 0 });
  await assert.rejects(repository.transact(command(), (state) => {
    state.counter = 99;
    throw new Error("domain validation failed");
  }), /domain validation failed/);
  const snapshot = await repository.load();
  const checkpoint = await repository.exportCheckpoint();
  assert.equal(snapshot.version, 0);
  assert.equal(snapshot.state.counter, 0);
  assert.equal(checkpoint.commands.length, 0);
  assert.equal(checkpoint.outbox.length, 0);
});

test("rejects transaction time regression before committing state", async () => {
  const repository = createRepository({ counter: 0 });
  await assert.rejects(
    repository.transact(command({ occurredAt: "2026-07-29T00:59:59.999Z" }), (state) => { state.counter += 1; }),
    (error) => error.code === "PERSISTENCE_TIME_REGRESSION" && error.status === 409
  );
  assert.equal((await repository.load()).version, 0);
});

test("uses leases for at-least-once outbox delivery and makes acknowledgement idempotent", async () => {
  const repository = createRepository({ counter: 0 });
  await repository.transact(command({ commandType: "counter.increment" }), (state) => {
    state.counter += 1;
    return { eventType: "counter.incremented", eventPayload: { counter: state.counter } };
  });
  const [claimed] = await repository.claimOutbox({ workerId: "worker-a", now: "2026-07-29T02:00:01.000Z", leaseMs: 5_000 });
  assert.equal(claimed.status, "processing");
  assert.equal(claimed.attempts, 1);
  await assert.rejects(
    repository.acknowledgeOutbox(claimed.id, { workerId: "worker-b", leaseToken: claimed.leaseToken }),
    (error) => error.code === "OUTBOX_LEASE_CONFLICT"
  );
  const acknowledged = await repository.acknowledgeOutbox(claimed.id, {
    workerId: "worker-a",
    leaseToken: claimed.leaseToken,
    publishedAt: "2026-07-29T02:00:02.000Z"
  });
  assert.equal(acknowledged.event.status, "published");
  assert.equal(acknowledged.idempotentReplay, false);
  const replay = await repository.acknowledgeOutbox(claimed.id, { workerId: "worker-a", leaseToken: claimed.leaseToken });
  assert.equal(replay.idempotentReplay, true);
  assert.deepEqual((await repository.outboxStatus()).counts, { pending: 0, processing: 0, published: 1, "dead-letter": 0 });
});

test("reclaims an expired outbox lease and blocks the stale worker", async () => {
  const repository = createRepository({ counter: 0 });
  await repository.transact(command(), (state) => {
    state.counter += 1;
    return { eventType: "counter.incremented" };
  });
  const [first] = await repository.claimOutbox({ workerId: "worker-a", now: "2026-07-29T02:00:01.000Z", leaseMs: 1_000 });
  const [reclaimed] = await repository.claimOutbox({ workerId: "worker-b", now: "2026-07-29T02:00:02.000Z", leaseMs: 1_000 });
  assert.equal(reclaimed.id, first.id);
  assert.equal(reclaimed.attempts, 2);
  assert.notEqual(reclaimed.leaseToken, first.leaseToken);
  await assert.rejects(
    repository.acknowledgeOutbox(first.id, { workerId: "worker-a", leaseToken: first.leaseToken }),
    (error) => error.code === "OUTBOX_LEASE_CONFLICT"
  );
});

test("retries failed delivery with backoff then dead-letters at the configured limit", async () => {
  const repository = createRepository({ counter: 0 }, {
    maxAttempts: 2,
    retryBaseMs: 1_000,
    retryMaxMs: 5_000
  });
  await repository.transact(command(), (state) => {
    state.counter += 1;
    return { eventType: "counter.incremented", eventPayload: { counter: 1 } };
  });

  const [first] = await repository.claimOutbox({ workerId: "worker-a", now: "2026-07-29T02:00:01.000Z" });
  const retry = await repository.failOutbox(first.id, {
    workerId: "worker-a",
    leaseToken: first.leaseToken,
    failedAt: "2026-07-29T02:00:02.000Z",
    errorCode: "PROVIDER_TIMEOUT",
    errorMessage: "provider credential must never be persisted in clear text"
  });
  assert.equal(retry.status, "pending");
  assert.equal(retry.nextAttemptAt, "2026-07-29T02:00:03.000Z");
  assert.equal(retry.lastErrorDigest.startsWith("sha256:"), true);
  assert.equal(JSON.stringify(retry).includes("credential must never"), false);
  assert.equal((await repository.claimOutbox({ workerId: "worker-b", now: "2026-07-29T02:00:02.999Z" })).length, 0);

  const [second] = await repository.claimOutbox({ workerId: "worker-b", now: "2026-07-29T02:00:03.000Z" });
  const deadLetter = await repository.failOutbox(second.id, {
    workerId: "worker-b",
    leaseToken: second.leaseToken,
    failedAt: "2026-07-29T02:00:04.000Z",
    errorCode: "PROVIDER_UNAVAILABLE"
  });
  assert.equal(deadLetter.status, "dead-letter");
  assert.equal(deadLetter.attempts, 2);
  assert.equal((await repository.outboxStatus()).healthy, false);
});

test("rejects tampered or stale checkpoints and restores a valid durable snapshot", async () => {
  const source = createRepository({ counter: 0 });
  await source.transact(command(), (state) => {
    state.counter += 1;
    return { eventType: "counter.incremented" };
  });
  const checkpoint = await source.exportCheckpoint();
  const restored = createRepository({ counter: 0 });
  assert.equal((await restored.restoreCheckpoint(checkpoint)).version, 1);
  assert.equal((await restored.load()).state.counter, 1);

  const tampered = structuredClone(checkpoint);
  tampered.state.counter = 99;
  await assert.rejects(restored.restoreCheckpoint(tampered), (error) => error.code === "PERSISTENCE_CHECKPOINT_INVALID");

  const stale = createRepository({ counter: 0 });
  const staleCheckpoint = await stale.exportCheckpoint();
  await assert.rejects(restored.restoreCheckpoint(staleCheckpoint), (error) => error.code === "PERSISTENCE_CHECKPOINT_STALE");
});

test("publishes an explicit production adapter contract", () => {
  const contract = Persistence.persistenceContract();
  assert.equal(contract.id, "insurance-payment-persistence-v1");
  assert.deepEqual(contract.requiredAdapterMethods, ["load", "transact", "claimOutbox", "acknowledgeOutbox", "failOutbox", "exportCheckpoint"]);
  assert.match(contract.productionBoundary, /生产适配器/);
  assert.equal(contract.invariants.length, 6);
});

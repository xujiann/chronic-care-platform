const test = require("node:test");
const assert = require("node:assert/strict");

const NursingService = require("../internet-nursing-service");
const EscortService = require("../escort-service");
const Runtime = require("../care-service-runtime");

const NOW = "2026-07-23T01:00:00.000Z";

function nursingEvent(overrides = {}) {
  return {
    ...NursingService.buildOutboxEvent({
      aggregateId: "ino-runtime-001",
      eventType: "internet-nursing-order-created",
      occurredAt: NOW,
      idempotencyKey: "nursing:ino-runtime-001:create:runtime",
      payload: { orderId: "ino-runtime-001", residentId: "r1", status: "requested" }
    }),
    ...overrides
  };
}

function escortEvent(overrides = {}) {
  return {
    ...EscortService.buildOutboxEvent({
      aggregateId: "eso-runtime-001",
      eventType: "escort-service-order-created",
      occurredAt: "2026-07-23T01:00:01.000Z",
      idempotencyKey: "escort:eso-runtime-001:create:runtime",
      payload: { orderId: "eso-runtime-001", residentId: "r1", status: "requested" }
    }),
    ...overrides
  };
}

function state(overrides = {}) {
  return {
    internetNursingOutbox: [nursingEvent()],
    escortServiceOutbox: [escortEvent()],
    ...overrides
  };
}

test("outbox claims are ordered, leased and exclusively reclaimed after expiry", () => {
  const original = state();
  const first = Runtime.claimOutboxEvents(original, {
    workerId: "worker-a",
    at: NOW,
    batchSize: 1,
    leaseSeconds: 30
  });
  assert.equal(first.claimed.length, 1);
  assert.equal(first.claimed[0].domain, "nursing");
  assert.equal(first.state.internetNursingOutbox[0].status, "processing");
  assert.equal(first.state.internetNursingOutbox[0].claimedBy, "worker-a");
  assert.equal(first.state.internetNursingOutbox[0].attempts, 1);
  assert.equal(original.internetNursingOutbox[0].status, "pending");

  const second = Runtime.claimOutboxEvents(first.state, {
    workerId: "worker-b",
    at: "2026-07-23T01:00:10.000Z",
    batchSize: 2,
    leaseSeconds: 30
  });
  assert.deepEqual(second.claimed.map((item) => item.domain), ["escort"]);
  assert.equal(second.state.internetNursingOutbox[0].claimedBy, "worker-a");

  const reclaimed = Runtime.claimOutboxEvents(second.state, {
    workerId: "worker-b",
    at: "2026-07-23T01:00:31.000Z",
    batchSize: 1,
    leaseSeconds: 30
  });
  assert.equal(reclaimed.claimed[0].domain, "nursing");
  assert.equal(reclaimed.state.internetNursingOutbox[0].claimedBy, "worker-b");
  assert.equal(reclaimed.state.internetNursingOutbox[0].attempts, 2);
  assert.equal(reclaimed.state.internetNursingOutbox[0].deliveryHistory[0].action, "lease-reclaimed");
});

test("delivery receipts bind worker, attempt and payload digest", () => {
  const claimed = Runtime.claimOutboxEvents(state(), {
    workerId: "worker-a",
    at: NOW,
    batchSize: 1
  });
  const claim = claimed.claimed[0];
  assert.throws(
    () => Runtime.recordOutboxDelivery(
      claimed.state,
      { ...claim, payloadDigest: "sha256:forged" },
      { status: "accepted", providerMessageId: "provider-001" },
      { workerId: "worker-a", at: "2026-07-23T01:00:02.000Z" }
    ),
    (error) => error.code === "CARE_OUTBOX_CLAIM_BINDING_INVALID"
  );
  assert.throws(
    () => Runtime.recordOutboxDelivery(
      claimed.state,
      claim,
      { status: "accepted", providerMessageId: "provider-001" },
      { workerId: "worker-b", at: "2026-07-23T01:00:02.000Z" }
    ),
    (error) => error.code === "CARE_OUTBOX_LEASE_OWNER_MISMATCH"
  );

  const delivered = Runtime.recordOutboxDelivery(
    claimed.state,
    claim,
    { status: "delivered", providerMessageId: "provider-001", providerCode: "OK" },
    { workerId: "worker-a", at: "2026-07-23T01:00:02.000Z" }
  );
  assert.equal(delivered.event.status, "delivered");
  assert.equal(delivered.event.deliveryReceipt.payloadDigest, claim.payloadDigest);
  assert.equal(delivered.event.deliveryReceipt.providerMessageId, "provider-001");
  assert.equal(delivered.event.leaseExpiresAt, "");
});

test("failed delivery backs off, dead-letters at the limit and requires audited requeue", () => {
  const claimed = Runtime.claimOutboxEvents(state({ escortServiceOutbox: [] }), {
    workerId: "worker-a",
    at: NOW,
    batchSize: 1
  });
  const firstFailure = Runtime.recordOutboxFailure(
    claimed.state,
    claimed.claimed[0],
    { code: "SMS_TIMEOUT", message: "provider timeout with no sensitive payload" },
    {
      workerId: "worker-a",
      at: "2026-07-23T01:00:05.000Z",
      maxAttempts: 2,
      retryBaseSeconds: 30
    }
  );
  assert.equal(firstFailure.deadLetter, false);
  assert.equal(firstFailure.event.status, "retry");
  assert.equal(firstFailure.nextAttemptAt, "2026-07-23T01:00:35.000Z");
  assert.equal(Runtime.claimOutboxEvents(firstFailure.state, {
    workerId: "worker-b",
    at: "2026-07-23T01:00:34.000Z"
  }).claimed.length, 0);

  const retried = Runtime.claimOutboxEvents(firstFailure.state, {
    workerId: "worker-b",
    at: "2026-07-23T01:00:35.000Z"
  });
  const secondFailure = Runtime.recordOutboxFailure(
    retried.state,
    retried.claimed[0],
    { code: "SMS_REJECTED", message: "provider rejected message" },
    {
      workerId: "worker-b",
      at: "2026-07-23T01:00:36.000Z",
      maxAttempts: 2
    }
  );
  assert.equal(secondFailure.deadLetter, true);
  assert.equal(secondFailure.event.status, "dead-letter");
  assert.equal(secondFailure.state.careServiceOutboxDeadLetters[0].status, "open");
  assert.equal(Runtime.buildOutboxHealth(secondFailure.state, {
    at: "2026-07-23T01:00:37.000Z"
  }).ok, false);

  assert.throws(
    () => Runtime.requeueDeadLetter(
      secondFailure.state,
      "nursing",
      secondFailure.event.id,
      { role: "commission", id: "ops-001" },
      { at: "2026-07-23T01:00:40.000Z", evidenceRef: "incident/INC-001", confirmation: "wrong" }
    ),
    (error) => error.code === "CARE_DEAD_LETTER_CONFIRMATION_REQUIRED"
  );
  const requeued = Runtime.requeueDeadLetter(
    secondFailure.state,
    "nursing",
    secondFailure.event.id,
    { role: "commission", id: "ops-001" },
    {
      at: "2026-07-23T01:00:40.000Z",
      evidenceRef: "incident/INC-001",
      confirmation: Runtime.DEAD_LETTER_CONFIRMATION
    }
  );
  assert.equal(requeued.event.status, "pending");
  assert.equal(requeued.event.attempts, 0);
  assert.equal(requeued.event.totalAttempts, 2);
  assert.equal(requeued.state.careServiceOutboxDeadLetters[0].status, "resolved");
  assert.equal(requeued.state.careServiceOutboxDeadLetters[0].resolutionEvidenceRef, "incident/INC-001");
});

test("worker delivers both domains and safely schedules missing adapters for retry", async () => {
  const delivered = await Runtime.runOutboxWorker(state(), {
    nursing: async (event, context) => ({
      status: "accepted",
      providerMessageId: `nursing-provider:${context.idempotencyKey}`,
      occurredAt: event.occurredAt
    }),
    escort: async (event, context) => ({
      status: "sent",
      providerMessageId: `escort-provider:${context.payloadDigest.slice(-12)}`,
      occurredAt: event.occurredAt
    })
  }, {
    workerId: "worker-runtime",
    at: "2026-07-23T01:00:02.000Z",
    batchSize: 10
  });
  assert.equal(delivered.claimed, 2);
  assert.equal(delivered.delivered, 2);
  assert.equal(delivered.retried, 0);
  assert.equal(delivered.health.ok, true);
  assert.equal(delivered.state.internetNursingOutbox[0].status, "delivered");
  assert.equal(delivered.state.escortServiceOutbox[0].status, "delivered");

  const missing = await Runtime.runOutboxWorker(state({ internetNursingOutbox: [] }), {}, {
    workerId: "worker-runtime",
    at: "2026-07-23T01:00:02.000Z",
    batchSize: 10
  });
  assert.equal(missing.retried, 1);
  assert.equal(missing.results[0].errorCode, "DELIVERY_ADAPTER_MISSING");
  assert.equal(missing.state.escortServiceOutbox[0].status, "retry");
});

test("outbox integrity failure blocks worker claims before external delivery", async () => {
  const tampered = state();
  tampered.internetNursingOutbox[0].payload.residentId = "forged-resident";
  assert.throws(
    () => Runtime.claimOutboxEvents(tampered, { workerId: "worker-a", at: NOW }),
    (error) => error.code === "CARE_OUTBOX_INTEGRITY_INVALID"
      && error.details.reasons.includes("outbox-payload-digest-invalid")
  );
  const health = Runtime.buildOutboxHealth(tampered, { at: NOW });
  assert.equal(health.ok, false);
  assert.equal(health.summary.integrityFailures, 1);
});

function memoryRepository(initialState) {
  let committed = structuredClone(initialState);
  let version = 1;
  return {
    current() {
      return { state: structuredClone(committed), version };
    },
    async transaction(callback) {
      let staged = structuredClone(committed);
      let stagedVersion = version;
      const result = await callback({
        async readState() {
          return { state: structuredClone(staged), version: stagedVersion };
        },
        async writeState(next, options = {}) {
          if (options.expectedVersion !== stagedVersion) throw new Error("optimistic version conflict");
          staged = structuredClone(next);
          stagedVersion += 1;
          return { version: stagedVersion };
        }
      });
      committed = staged;
      version = stagedVersion;
      return result;
    }
  };
}

test("transaction executor commits order and outbox together and rolls back command failures", async () => {
  const repository = memoryRepository({ internetNursingOrders: [], internetNursingOutbox: [] });
  const committed = await Runtime.executeTransactionalCommand(
    repository,
    (source) => ({
      state: {
        ...source,
        internetNursingOrders: [{ id: "ino-atomic-001" }],
        internetNursingOutbox: [nursingEvent()]
      },
      orderId: "ino-atomic-001"
    }),
    {
      commandId: "create-ino-atomic-001",
      collections: ["internetNursingOrders", "internetNursingOutbox"]
    }
  );
  assert.equal(committed.committed, true);
  assert.equal(committed.state, undefined);
  assert.equal(repository.current().state.internetNursingOrders.length, 1);
  assert.equal(repository.current().state.internetNursingOutbox.length, 1);
  assert.equal(repository.current().version, 2);

  await assert.rejects(
    () => Runtime.executeTransactionalCommand(
      repository,
      () => {
        throw new Error("domain command failed");
      },
      { commandId: "failing-command" }
    ),
    /domain command failed/
  );
  assert.equal(repository.current().state.internetNursingOrders.length, 1);
  assert.equal(repository.current().version, 2);
});

test("transactional worker commits leases before network delivery and records receipts separately", async () => {
  const repository = memoryRepository(state());
  const observed = [];
  const result = await Runtime.runTransactionalOutboxWorker(repository, {
    nursing: async (event, context) => {
      const persisted = repository.current().state.internetNursingOutbox.find((item) => item.id === event.id);
      observed.push({ domain: context.domain, statusDuringNetwork: persisted.status, claimedBy: persisted.claimedBy });
      return { status: "accepted", providerMessageId: "nursing-transactional-001" };
    },
    escort: async (event, context) => {
      const persisted = repository.current().state.escortServiceOutbox.find((item) => item.id === event.id);
      observed.push({ domain: context.domain, statusDuringNetwork: persisted.status, claimedBy: persisted.claimedBy });
      const error = new Error("temporary escort gateway failure");
      error.code = "ESCORT_GATEWAY_TIMEOUT";
      throw error;
    }
  }, {
    workerId: "worker-transactional",
    runId: "run-001",
    at: "2026-07-23T01:00:02.000Z",
    batchSize: 10,
    maxAttempts: 3
  });

  assert.equal(result.claimed, 2);
  assert.equal(result.delivered, 1);
  assert.equal(result.retried, 1);
  assert.deepEqual(observed, [
    { domain: "nursing", statusDuringNetwork: "processing", claimedBy: "worker-transactional" },
    { domain: "escort", statusDuringNetwork: "processing", claimedBy: "worker-transactional" }
  ]);
  assert.equal(repository.current().state.internetNursingOutbox[0].status, "delivered");
  assert.equal(repository.current().state.escortServiceOutbox[0].status, "retry");
  assert.equal(repository.current().state.escortServiceOutbox[0].lastError.code, "ESCORT_GATEWAY_TIMEOUT");
  assert.equal(repository.current().version, 4);
});

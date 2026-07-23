const assert = require("node:assert/strict");
const test = require("node:test");

const sourceData = require("../data/db.json");
const {
  applyPublicHealthCoordinationActionToState,
  buildPublicHealthCoordinationRuntime
} = require("../public-health-coordination-runtime");
const {
  enqueuePublicHealthExternalDispatchToState
} = require("../public-health-external-adapter-runtime");
const {
  signPublicHealthExternalReceipt
} = require("../public-health-external-adapter-service");
const {
  loadPublicHealthLaneCredentials
} = require("../public-health-external-key-provider");
const {
  processPublicHealthExternalDispatch
} = require("../public-health-external-worker");

const REQUEST_SECRET = "worker-request-secret-1234567890-123456";
const RECEIPT_SECRET = "worker-receipt-secret-1234567890-123456";
const ENV = {
  NODE_ENV: "test",
  PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: "https://immunization.worker.test/dispatch",
  PUBLIC_HEALTH_IMMUNIZATION_REQUEST_SECRET: REQUEST_SECRET,
  PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_SECRET: RECEIPT_SECRET
};

function prepareOutbox() {
  const data = JSON.parse(JSON.stringify(sourceData));
  const handoff = buildPublicHealthCoordinationRuntime({ data }).handoffs
    .find((item) => item.laneId === "immunization");
  const user = { id: "worker-test-admin", name: "worker test admin", role: "commission" };
  const assigned = applyPublicHealthCoordinationActionToState(data, handoff.id, {
    action: "assign-coordination",
    idempotencyKey: "worker-test-assign",
    expectedVersion: 1,
    assignedTo: handoff.owner,
    dueAt: "2026-07-31",
    note: "assign worker test",
    at: "2026-07-23T08:00:00.000Z"
  }, user);
  const started = applyPublicHealthCoordinationActionToState(assigned.nextData, handoff.id, {
    action: "start-coordination",
    idempotencyKey: "worker-test-start",
    expectedVersion: 2,
    note: "start worker test",
    at: "2026-07-23T08:00:05.000Z"
  }, user);
  const credentials = {
    endpoint: ENV.PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT,
    requestKeyring: REQUEST_SECRET,
    receiptKeyring: RECEIPT_SECRET,
    maxAttempts: 3
  };
  return enqueuePublicHealthExternalDispatchToState(started.nextData, handoff.id, {
    idempotencyKey: "worker-test-enqueue",
    operation: "coordination-handoff",
    evidenceRefs: ["worker-test-request"],
    exceptionOwner: "worker compensation team",
    exceptionDueAt: "2026-07-31",
    at: "2026-07-23T08:00:10.000Z"
  }, credentials);
}

test("worker injects full keyrings at server times and persists claim before attempt", async () => {
  const enqueued = prepareOutbox();
  const writes = [];
  const times = ["2026-07-23T08:00:30.000Z", "2026-07-23T08:01:00.000Z"];
  const result = await processPublicHealthExternalDispatch({
    data: enqueued.nextData,
    dispatchId: enqueued.dispatch.id,
    expectedVersion: 1,
    workerId: "worker-test-1",
    idempotencyKey: "worker-cycle-1",
    clock: () => times.shift(),
    loadCredentials: (laneId, options) => loadPublicHealthLaneCredentials(laneId, {
      ...options,
      env: ENV
    }),
    transport: async (envelope) => {
      assert.equal(envelope.endpoint, ENV.PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT);
      assert.doesNotMatch(JSON.stringify(envelope), new RegExp(REQUEST_SECRET));
      assert.doesNotMatch(JSON.stringify(envelope), new RegExp(RECEIPT_SECRET));
      return {
        transportStatus: 200,
        receipt: signPublicHealthExternalReceipt({
          dispatchId: envelope.dispatchId,
          requestDigest: envelope.requestDigest,
          laneId: envelope.laneId,
          handoffId: envelope.request.handoffId,
          status: "accepted",
          receiptCode: "WORKER-ACCEPT-001",
          evidenceRefs: ["worker-signed-receipt"],
          receivedAt: "2026-07-23T08:00:45.000Z",
          issuedAt: "2026-07-23T08:00:45.000Z"
        }, RECEIPT_SECRET)
      };
    },
    writeState: async (state, metadata) => {
      writes.push({ state: JSON.parse(JSON.stringify(state)), metadata });
    }
  });
  assert.equal(result.attempted.deliveryState, "delivered");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].metadata.event, "public-health-external-claim");
  assert.equal(writes[0].state.publicHealthExternalDispatches[0].outboxVersion, 2);
  assert.equal(writes[1].metadata.event, "public-health-external-attempt");
  assert.equal(writes[1].state.publicHealthExternalDispatches[0].outboxVersion, 3);
  assert.equal(writes[1].state.publicHealthExternalDispatches[0].attempts[0].at, "2026-07-23T08:01:00.000Z");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(serialized, new RegExp(RECEIPT_SECRET));
  assert.doesNotMatch(serialized, /requestKeyring|receiptKeyring/);
});

test("worker transport failures stay generic and never trigger automatic recovery", async () => {
  const enqueued = prepareOutbox();
  const times = ["2026-07-23T08:00:30.000Z", "2026-07-23T08:01:00.000Z"];
  const result = await processPublicHealthExternalDispatch({
    data: enqueued.nextData,
    dispatchId: enqueued.dispatch.id,
    expectedVersion: 1,
    workerId: "worker-test-2",
    idempotencyKey: "worker-cycle-2",
    clock: () => times.shift(),
    loadCredentials: (laneId, options) => loadPublicHealthLaneCredentials(laneId, {
      ...options,
      env: ENV
    }),
    transport: async () => {
      throw new Error(`provider failed with ${REQUEST_SECRET}`);
    },
    writeState: async () => {}
  });
  const dispatch = result.nextData.publicHealthExternalDispatches[0];
  assert.equal(dispatch.deliveryState, "retry-scheduled");
  assert.equal(dispatch.attempts[0].reason, "network-error");
  assert.equal(dispatch.attempts[0].receiptDigest, "");
  assert.equal(dispatch.recovery, undefined);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(REQUEST_SECRET));
});

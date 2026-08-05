"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sourceData = require("../data/db.json");
const {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  applyInfectiousReportingAction,
  buildInfectiousReportingCaseFromSources
} = require("../public-health-event-reporting-service");
const {
  enqueueDirectReportDeliveryToState
} = require("../public-health-direct-report-outbox-service");
const {
  processDirectReportDelivery
} = require("../public-health-direct-report-worker");

const WORKER_ENV = {
  NODE_ENV: "production",
  PUBLIC_HEALTH_REFERENCE_SECRET: "public-health-reference-secret-for-worker-tests"
};

function queuedState(maxAttempts = 3) {
  const event = sourceData.publicHealthEvents.find(
    (item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.publicHealthEventId
  );
  const report = sourceData.phase2DiseaseReportQueue.find(
    (item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.reportId
  );
  let workflow = buildInfectiousReportingCaseFromSources({
    event,
    report,
    link: DEFAULT_INFECTIOUS_EVENT_LINK
  });
  const actor = { name: "commission reporter", role: "commission" };
  workflow = applyInfectiousReportingAction(workflow, {
    action: "validate-event",
    idempotencyKey: "worker:validate",
    at: "2026-08-05T08:00:00.000Z"
  }, actor).case;
  workflow = applyInfectiousReportingAction(workflow, {
    action: "create-report-card",
    idempotencyKey: "worker:card",
    at: "2026-08-05T08:01:00.000Z",
    reportCard: {
      sourceInstitutionCode: "210200001",
      testCode: "TB-PCR",
      resultFlag: "positive",
      occurredAt: "2026-08-05T07:30:00.000Z",
      reportedAt: "2026-08-05T08:01:00.000Z"
    }
  }, actor).case;
  workflow = applyInfectiousReportingAction(workflow, {
    action: "submit-report",
    idempotencyKey: "worker:submit:1",
    at: "2026-08-05T08:02:00.000Z"
  }, actor).case;
  return enqueueDirectReportDeliveryToState({
    publicHealthInfectiousReportingCases: [workflow]
  }, workflow, {
    at: "2026-08-05T08:02:00.000Z",
    maxAttempts
  });
}

function sequenceClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test("worker durably claims before sending and stores only minimized provider acknowledgement", async () => {
  const queued = queuedState();
  const writes = [];
  let sentRequest = null;
  const result = await processDirectReportDelivery({
    data: queued.nextData,
    deliveryId: queued.delivery.id,
    expectedVersion: queued.delivery.version,
    workerId: "worker-a",
    randomUUID: () => "worker-lease-token",
    clock: sequenceClock([
      "2026-08-05T08:03:00.000Z",
      "2026-08-05T08:03:05.000Z"
    ]),
    dispatchOptions: {
      env: WORKER_ENV,
      nowMs: Date.parse("2026-08-05T08:03:00.000Z")
    },
    dispatch: async (request) => {
      assert.equal(writes.length, 1);
      sentRequest = structuredClone(request);
      return {
        receiptId: "provider-receipt-worker-1",
        requestId: request.requestId,
        status: "accepted",
        acceptedAt: "2026-08-05T08:03:04.000Z",
        attempts: 1
      };
    },
    writeState: async (data, metadata) => {
      writes.push({ data: structuredClone(data), metadata: structuredClone(metadata) });
    }
  });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].metadata.event, "public-health-direct-report-delivery-claimed");
  assert.equal(writes[1].metadata.event, "public-health-direct-report-delivery-attempted");
  assert.equal(result.delivery.state, "awaiting-callback");
  assert.equal(result.delivery.providerReceipt.receiptId, "provider-receipt-worker-1");
  assert.match(sentRequest.payload.subjectReference, /^hmac-sha256:v1:[a-f0-9]{64}$/);
  assert.equal(result.productionReady, false);
  assert.equal(Object.hasOwn(result.delivery, "residentId"), false);
  assert.equal(Object.hasOwn(result.delivery, "sampleNo"), false);
  assert.equal(Object.hasOwn(result.delivery, "payload"), false);
  assert.doesNotMatch(JSON.stringify(result.delivery), /lease-token|reference-secret/);
});

test("worker converts generic transport failures into bounded retry then dead letter", async () => {
  const queued = queuedState(2);
  const transportFailure = Object.assign(new Error("raw provider outage detail"), {
    code: "UPSTREAM_TIMEOUT",
    retryable: true
  });
  const first = await processDirectReportDelivery({
    data: queued.nextData,
    deliveryId: queued.delivery.id,
    expectedVersion: queued.delivery.version,
    workerId: "worker-a",
    randomUUID: () => "worker-lease-token-a",
    clock: sequenceClock([
      "2026-08-05T08:03:00.000Z",
      "2026-08-05T08:03:05.000Z"
    ]),
    dispatchOptions: {
      env: WORKER_ENV,
      nowMs: Date.parse("2026-08-05T08:03:00.000Z")
    },
    dispatch: async () => { throw transportFailure; },
    writeState: async () => {}
  });
  assert.equal(first.delivery.state, "retry-scheduled");
  assert.equal(first.delivery.lastFailure.code, "UPSTREAM_TIMEOUT");
  assert.doesNotMatch(JSON.stringify(first.nextData), /raw provider outage detail/);

  const second = await processDirectReportDelivery({
    data: first.nextData,
    deliveryId: queued.delivery.id,
    expectedVersion: first.delivery.version,
    workerId: "worker-b",
    randomUUID: () => "worker-lease-token-b",
    clock: sequenceClock([
      "2026-08-05T08:04:00.000Z",
      "2026-08-05T08:04:05.000Z"
    ]),
    dispatchOptions: {
      env: WORKER_ENV,
      nowMs: Date.parse("2026-08-05T08:04:00.000Z")
    },
    dispatch: async () => { throw transportFailure; },
    writeState: async () => {}
  });
  assert.equal(second.delivery.state, "dead-letter");
  assert.equal(second.delivery.attemptCount, 2);
  assert.doesNotMatch(JSON.stringify(second.nextData), /raw provider outage detail/);
});

test("worker never sends if the claimed lease cannot be durably persisted", async () => {
  const queued = queuedState();
  let sends = 0;
  await assert.rejects(
    processDirectReportDelivery({
      data: queued.nextData,
      deliveryId: queued.delivery.id,
      expectedVersion: queued.delivery.version,
      workerId: "worker-a",
      randomUUID: () => "worker-lease-token",
      clock: () => "2026-08-05T08:03:00.000Z",
      dispatch: async () => {
        sends += 1;
        return {};
      },
      writeState: async () => {
        throw new Error("durable write failed");
      }
    }),
    /durable write failed/
  );
  assert.equal(sends, 0);
});

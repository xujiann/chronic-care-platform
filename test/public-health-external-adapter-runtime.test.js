const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sourceData = require("../data/db.json");
const {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  buildInfectiousReportingCaseFromSources
} = require("../public-health-event-reporting-service");
const {
  PRIORITY_STANDARD_REVIEW_TRACKS,
  buildPriorityStandardReviewPack
} = require("../public-health-priority-standard-review-service");
const { buildPublicHealthCoordinationCenter } = require("../public-health-coordination-service");
const {
  applyPublicHealthCoordinationActionToState,
  buildPublicHealthCoordinationRuntime
} = require("../public-health-coordination-runtime");
const {
  enqueuePublicHealthExternalDispatchToState,
  recordPublicHealthExternalAttemptToState,
  verifyRuntimeStateSignature
} = require("../public-health-external-adapter-runtime");
const {
  signPublicHealthExternalReceipt,
  verifyPublicHealthExternalReceipt
} = require("../public-health-external-adapter-service");

const ROOT = path.resolve(__dirname, "..");
const REQUEST_SECRET = "runtime-request-secret-1234567890-123456";
const RECEIPT_SECRET = "runtime-receipt-secret-1234567890-123456";

function buildDependencies(data = sourceData) {
  const eventReporting = buildInfectiousReportingCaseFromSources({
    event: data.publicHealthEvents.find((item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.publicHealthEventId),
    report: data.phase2DiseaseReportQueue.find((item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.reportId),
    receipt: data.phase2DiseaseReportReceipts.find((item) => item.reportId === DEFAULT_INFECTIOUS_EVENT_LINK.reportId)
  });
  const artifactAvailability = Object.fromEntries(
    PRIORITY_STANDARD_REVIEW_TRACKS.flatMap((track) => track.artifactEvidence)
      .map((file) => [file, fs.existsSync(path.join(ROOT, file))])
  );
  const standardReview = buildPriorityStandardReviewPack({
    ledger: data.publicHealthStandardImplementationLedger,
    data,
    artifactAvailability
  });
  const center = buildPublicHealthCoordinationCenter({ data, eventReporting, standardReview });
  return { eventReporting, standardReview, center };
}

function credentials(overrides = {}) {
  return {
    endpoint: "https://external-runtime.example.test/dispatch",
    requestSecret: REQUEST_SECRET,
    receiptSecret: RECEIPT_SECRET,
    maxAttempts: 2,
    ...overrides
  };
}

function advanceToInProgress(laneId) {
  const data = JSON.parse(JSON.stringify(sourceData));
  const dependencies = buildDependencies(data);
  const initial = dependencies.center.handoffs.find((item) => item.laneId === laneId);
  const owner = { name: `${laneId}责任人`, role: initial.ownerRole };
  const assigned = applyPublicHealthCoordinationActionToState(data, initial.id, {
    action: "assign-coordination",
    idempotencyKey: `${initial.id}:runtime:assign`,
    expectedVersion: 1,
    assignedTo: initial.owner,
    dueAt: "2026-07-31",
    note: "外部适配运行时验收分派"
  }, owner, dependencies);
  const started = applyPublicHealthCoordinationActionToState(assigned.nextData, initial.id, {
    action: "start-coordination",
    idempotencyKey: `${initial.id}:runtime:start`,
    expectedVersion: 2,
    note: "进入外部适配投递"
  }, owner, dependencies);
  return { data: started.nextData, dependencies, handoffId: initial.id };
}

function enqueueLane(laneId) {
  const prepared = advanceToInProgress(laneId);
  const enqueued = enqueuePublicHealthExternalDispatchToState(
    prepared.data,
    prepared.handoffId,
    {
      idempotencyKey: `${laneId}:external:enqueue`,
      operation: "coordination-handoff",
      evidenceRefs: [`${laneId}-request-evidence`],
      exceptionOwner: `${laneId}接口补偿专班`,
      exceptionDueAt: "2026-07-31",
      at: "2026-07-23T08:00:00.000Z"
    },
    credentials(),
    prepared.dependencies
  );
  return { ...prepared, enqueued };
}

function signedReceipt(dispatch, overrides = {}) {
  return signPublicHealthExternalReceipt({
    dispatchId: dispatch.id,
    requestDigest: dispatch.requestDigest,
    laneId: dispatch.laneId,
    handoffId: dispatch.handoffId,
    status: "accepted",
    receiptCode: `${dispatch.laneId}-ACCEPT-001`,
    evidenceRefs: [`${dispatch.laneId}-signed-receipt`],
    receivedAt: "2026-07-23T08:01:00.000Z",
    ...overrides
  }, RECEIPT_SECRET);
}

function attemptOptions(idempotencyKey, at = "2026-07-23T08:01:30.000Z") {
  return {
    requestSecret: REQUEST_SECRET,
    receiptSecret: RECEIPT_SECRET,
    attemptIdempotencyKey: idempotencyKey,
    at
  };
}

test("external outbox enqueue is persisted, signed, private and idempotent", () => {
  const { data, dependencies, handoffId, enqueued } = enqueueLane("chronic-management");
  assert.equal(enqueued.idempotent, false);
  assert.equal(enqueued.nextData.publicHealthExternalDispatches.length, 1);
  assert.equal(enqueued.nextData.publicHealthExternalDispatchAudit.length, 1);
  assert.equal(verifyRuntimeStateSignature(enqueued.dispatch, REQUEST_SECRET), true);
  const serialized = JSON.stringify(enqueued.nextData.publicHealthExternalDispatches);
  assert.equal(serialized.includes(REQUEST_SECRET), false);
  assert.equal(serialized.includes(RECEIPT_SECRET), false);
  assert.equal(serialized.includes("residentId"), false);

  const replay = enqueuePublicHealthExternalDispatchToState(
    data,
    handoffId,
    {
      idempotencyKey: "chronic-management:external:enqueue",
      exceptionOwner: "chronic-management接口补偿专班",
      exceptionDueAt: "2026-07-31"
    },
    credentials(),
    dependencies
  );
  assert.equal(replay.idempotent, false);

  const persistedReplay = enqueuePublicHealthExternalDispatchToState(
    enqueued.nextData,
    handoffId,
    {
      idempotencyKey: "chronic-management:external:enqueue",
      operation: "coordination-handoff",
      evidenceRefs: ["chronic-management-request-evidence"],
      exceptionOwner: "chronic-management接口补偿专班",
      exceptionDueAt: "2026-07-31"
    },
    credentials(),
    dependencies
  );
  assert.equal(persistedReplay.idempotent, true);
  assert.equal(persistedReplay.nextData.publicHealthExternalDispatchAudit.length, 1);
});

test("verified accepted receipt advances the coordination handoff exactly once", () => {
  const prepared = enqueueLane("maternal-child");
  const dispatch = prepared.enqueued.dispatch;
  const delivered = recordPublicHealthExternalAttemptToState(
    prepared.enqueued.nextData,
    dispatch.id,
    { transportStatus: 200, receipt: signedReceipt(dispatch) },
    attemptOptions("mch:attempt:accepted"),
    prepared.dependencies
  );
  const runtime = buildPublicHealthCoordinationRuntime({
    data: delivered.nextData,
    ...prepared.dependencies
  });
  const handoff = runtime.handoffs.find((item) => item.id === prepared.handoffId);
  assert.equal(delivered.dispatch.deliveryState, "delivered");
  assert.equal(verifyPublicHealthExternalReceipt(delivered.dispatch, delivered.dispatch.receipt, RECEIPT_SECRET).ok, true);
  assert.equal(delivered.coordinationAction.action, "record-coordination-receipt");
  assert.equal(handoff.state, "receipt-confirmed");
  assert.equal(handoff.receipt.status, "accepted");
  assert.equal(delivered.externalRuntime.summary.delivered, 1);
  assert.equal(delivered.productionReady, false);

  const replay = recordPublicHealthExternalAttemptToState(
    delivered.nextData,
    dispatch.id,
    { transportStatus: 200, receipt: signedReceipt(dispatch) },
    attemptOptions("mch:attempt:accepted"),
    prepared.dependencies
  );
  assert.equal(replay.idempotent, true);
  assert.equal(replay.nextData.publicHealthExternalDispatchAudit.length, 2);
  assert.equal(buildPublicHealthCoordinationRuntime({ data: replay.nextData, ...prepared.dependencies })
    .handoffs.find((item) => item.id === prepared.handoffId).version, handoff.version);

  const enqueueReplay = enqueuePublicHealthExternalDispatchToState(
    delivered.nextData,
    prepared.handoffId,
    { idempotencyKey: "maternal-child:external:enqueue" },
    credentials(),
    prepared.dependencies
  );
  assert.equal(enqueueReplay.idempotent, true);
  assert.equal(enqueueReplay.dispatch.deliveryState, "delivered");
  assert.throws(() => enqueuePublicHealthExternalDispatchToState(
    delivered.nextData,
    prepared.handoffId,
    {
      idempotencyKey: "maternal-child:external:enqueue",
      operation: "different-operation"
    },
    credentials(),
    prepared.dependencies
  ), /idempotency key was reused with a different payload/);
});

test("verified rejection opens the signed compensation exception", () => {
  const prepared = enqueueLane("immunization");
  const dispatch = prepared.enqueued.dispatch;
  const receipt = signedReceipt(dispatch, {
    status: "rejected",
    receiptCode: "IMM-REJECT-002",
    reason: "接种档案版本不匹配",
    exceptionOwner: "免疫规划接口专班",
    dueAt: "2026-07-30"
  });
  const rejected = recordPublicHealthExternalAttemptToState(
    prepared.enqueued.nextData,
    dispatch.id,
    { transportStatus: 200, receipt },
    attemptOptions("immunization:attempt:rejected"),
    prepared.dependencies
  );
  const handoff = buildPublicHealthCoordinationRuntime({ data: rejected.nextData, ...prepared.dependencies })
    .handoffs.find((item) => item.id === prepared.handoffId);
  assert.equal(rejected.dispatch.deliveryState, "dead-letter");
  assert.equal(handoff.state, "exception-open");
  assert.equal(handoff.receipt.status, "rejected");
  assert.equal(handoff.exception.owner, "免疫规划接口专班");
  assert.equal(handoff.exception.dueAt, "2026-07-30");
});

test("retry exhaustion opens a receipt-free compensation exception", () => {
  const prepared = enqueueLane("health-education");
  const dispatch = prepared.enqueued.dispatch;
  const retry = recordPublicHealthExternalAttemptToState(
    prepared.enqueued.nextData,
    dispatch.id,
    { transportStatus: 503 },
    attemptOptions("education:attempt:one", "2026-07-23T08:01:00.000Z"),
    prepared.dependencies
  );
  assert.equal(retry.dispatch.deliveryState, "retry-scheduled");
  assert.equal(retry.coordinationAction, null);
  const deadLetter = recordPublicHealthExternalAttemptToState(
    retry.nextData,
    dispatch.id,
    { networkError: "connection reset" },
    attemptOptions("education:attempt:two", "2026-07-23T08:03:00.000Z"),
    prepared.dependencies
  );
  const handoff = buildPublicHealthCoordinationRuntime({ data: deadLetter.nextData, ...prepared.dependencies })
    .handoffs.find((item) => item.id === prepared.handoffId);
  assert.equal(deadLetter.dispatch.deliveryState, "dead-letter");
  assert.equal(deadLetter.coordinationAction.action, "open-coordination-exception");
  assert.equal(handoff.state, "exception-open");
  assert.equal(handoff.receipt, null);
  assert.equal(handoff.exception.owner, "health-education接口补偿专班");
  assert.deepEqual(handoff.exception.evidenceRefs, [dispatch.id]);
});

test("persisted outbox state tampering is rejected before callback processing", () => {
  const prepared = enqueueLane("family-doctor");
  const tampered = JSON.parse(JSON.stringify(prepared.enqueued.nextData));
  tampered.publicHealthExternalDispatches[0].maxAttempts = 10;
  assert.throws(() => recordPublicHealthExternalAttemptToState(
    tampered,
    prepared.enqueued.dispatch.id,
    { transportStatus: 503 },
    attemptOptions("family:attempt:tampered"),
    prepared.dependencies
  ), /runtime-state-signature-invalid/);
});

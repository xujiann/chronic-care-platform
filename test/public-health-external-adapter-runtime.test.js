const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
  claimPublicHealthExternalDispatchToState,
  enqueuePublicHealthExternalDispatchToState,
  listDuePublicHealthExternalDispatches,
  recordClaimedPublicHealthExternalAttemptToState,
  recordPublicHealthExternalAttemptToState,
  requeuePublicHealthExternalDeadLetterToState,
  verifyPublicHealthExternalAuditChain,
  verifyRuntimeStateSignature
} = require("../public-health-external-adapter-runtime");
const {
  signPublicHealthExternalReceipt,
  verifyPublicHealthExternalReceipt
} = require("../public-health-external-adapter-service");
const {
  verifyPublicHealthExternalLaneControlAuditChain
} = require("../public-health-external-resilience-service");
const {
  buildPublicHealthExternalContractGovernance,
  signPublicHealthExternalContractAttestation
} = require("../public-health-external-contract-governance-service");

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

function attemptOptions(idempotencyKey, at = "2026-07-23T08:01:30.000Z", expectedVersion = 1) {
  return {
    requestSecret: REQUEST_SECRET,
    receiptSecret: RECEIPT_SECRET,
    attemptIdempotencyKey: idempotencyKey,
    expectedVersion,
    at
  };
}

function runtimeContractGovernance(at) {
  const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const attestation = signPublicHealthExternalContractAttestation({
    laneId: "family-doctor",
    fromContract: "family-doctor-fulfillment-v1",
    toContract: "family-doctor-fulfillment-v2",
    requestSchemaVersion: "public-health-external-dispatch/v2",
    receiptSchemaVersion: "public-health-external-receipt/v2",
    changeType: "additive",
    fieldDictionaryDigest: digest("runtime-family-doctor-fields-v2"),
    sampleRequestDigest: digest("runtime-family-doctor-request-v2"),
    sampleReceiptDigest: digest("runtime-family-doctor-receipt-v2"),
    runtimeReleaseDigest: digest("runtime-family-doctor-release-v2"),
    producerApproval: {
      organizationId: "family-doctor-platform",
      role: "producer-contract-owner",
      approverIdHash: digest("runtime-producer"),
      approvedAt: "2026-07-22T08:00:00.000Z"
    },
    consumerApproval: {
      organizationId: "district-health-platform",
      role: "consumer-contract-owner",
      approverIdHash: digest("runtime-consumer"),
      approvedAt: "2026-07-22T09:00:00.000Z"
    },
    evidenceRefs: ["field-dictionary-v2", "producer-approval", "consumer-approval"],
    effectiveAt: "2026-07-25T00:00:00.000Z",
    sunsetAt: "2026-08-15T00:00:00.000Z",
    status: "approved",
    issuedAt: "2026-07-23T08:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    nonce: "runtime-family-doctor-contract-v2"
  }, REQUEST_SECRET);
  return buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: REQUEST_SECRET,
    at
  });
}

function rejectedLane(laneId) {
  const prepared = enqueueLane(laneId);
  const dispatch = prepared.enqueued.dispatch;
  const receipt = signedReceipt(dispatch, {
    status: "rejected",
    receiptCode: `${laneId}-REJECT-RECOVERY`,
    reason: "外部字段版本不匹配",
    exceptionOwner: `${laneId}原异常专班`,
    dueAt: "2026-07-30"
  });
  const rejected = recordPublicHealthExternalAttemptToState(
    prepared.enqueued.nextData,
    dispatch.id,
    { transportStatus: 200, receipt },
    attemptOptions(`${laneId}:attempt:recovery-reject`),
    prepared.dependencies
  );
  return { ...prepared, rejected };
}

test("external outbox enqueue is persisted, signed, private and idempotent", () => {
  const { data, dependencies, handoffId, enqueued } = enqueueLane("chronic-management");
  assert.equal(enqueued.idempotent, false);
  assert.equal(enqueued.nextData.publicHealthExternalDispatches.length, 1);
  assert.equal(enqueued.nextData.publicHealthExternalDispatchAudit.length, 1);
  assert.equal(verifyRuntimeStateSignature(enqueued.dispatch, REQUEST_SECRET), true);
  assert.deepEqual(verifyPublicHealthExternalAuditChain(
    enqueued.nextData,
    enqueued.dispatch.id,
    REQUEST_SECRET
  ), {
    ok: true,
    reason: "verified",
    entries: 1,
    auditHead: enqueued.dispatch.auditHead
  });
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
  assert.equal(verifyPublicHealthExternalAuditChain(
    delivered.nextData,
    delivered.dispatch.id,
    REQUEST_SECRET
  ).entries, 2);
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

test("a signed callback nonce cannot be replayed under a different idempotency key", () => {
  const prepared = enqueueLane("immunization");
  const dispatch = prepared.enqueued.dispatch;
  const receipt = signedReceipt(dispatch, { nonce: "immunization-callback-nonce-001" });
  const delivered = recordPublicHealthExternalAttemptToState(
    prepared.enqueued.nextData,
    dispatch.id,
    { transportStatus: 200, receipt },
    attemptOptions("immunization:callback:first"),
    prepared.dependencies
  );
  assert.match(
    delivered.nextData.publicHealthExternalDispatchAudit[1].receiptReplayKeyHash,
    /^[a-f0-9]{64}$/
  );
  assert.throws(() => recordPublicHealthExternalAttemptToState(
    delivered.nextData,
    dispatch.id,
    { transportStatus: 200, receipt },
    attemptOptions("immunization:callback:replay", "2026-07-23T08:02:00.000Z", 2),
    prepared.dependencies
  ), /receipt replay detected/);
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

test("authorized dead-letter recovery seals the original and creates one successor", () => {
  const prepared = rejectedLane("immunization");
  const original = prepared.rejected.dispatch;
  const input = {
    idempotencyKey: "immunization:dead-letter:requeue",
    expectedVersion: 2,
    coordinationExpectedVersion: 4,
    note: "已完成字段版本修复并复核映射",
    remediationEvidenceRefs: ["immunization-field-map-v2", "remediation-review-signoff"],
    exceptionOwner: "免疫规划恢复专班",
    exceptionDueAt: "2026-08-02",
    at: "2026-07-23T09:00:00.000Z"
  };
  const recovered = requeuePublicHealthExternalDeadLetterToState(
    prepared.rejected.nextData,
    original.id,
    input,
    credentials(),
    { name: "免疫规划责任人", role: "cdc" },
    prepared.dependencies
  );
  const coordination = buildPublicHealthCoordinationRuntime({
    data: recovered.nextData,
    ...prepared.dependencies
  }).handoffs.find((item) => item.id === prepared.handoffId);
  assert.equal(recovered.originalDispatch.deliveryState, "dead-letter");
  assert.equal(recovered.originalDispatch.outboxVersion, 3);
  assert.equal(recovered.originalDispatch.recovery.state, "requeued");
  assert.equal(recovered.originalDispatch.recovery.successorDispatchId, recovered.successorDispatch.id);
  assert.equal(recovered.successorDispatch.deliveryState, "pending");
  assert.equal(recovered.successorDispatch.predecessorDispatchId, original.id);
  assert.deepEqual(recovered.successorDispatch.remediationEvidenceRefs, input.remediationEvidenceRefs.sort());
  assert.equal(verifyRuntimeStateSignature(recovered.originalDispatch, REQUEST_SECRET), true);
  assert.equal(verifyRuntimeStateSignature(recovered.successorDispatch, REQUEST_SECRET), true);
  assert.equal(verifyPublicHealthExternalAuditChain(
    recovered.nextData,
    recovered.originalDispatch.id,
    REQUEST_SECRET
  ).entries, 3);
  assert.equal(verifyPublicHealthExternalAuditChain(
    recovered.nextData,
    recovered.successorDispatch.id,
    REQUEST_SECRET
  ).entries, 1);
  assert.equal(recovered.externalRuntime.summary.recoveredDeadLetters, 1);
  assert.equal(recovered.externalRuntime.summary.recoverySuccessors, 1);
  assert.equal(coordination.state, "in-progress");
  assert.equal(coordination.exception.status, "retry-submitted");
  assert.equal(listDuePublicHealthExternalDispatches(recovered.nextData, {
    now: "2026-07-23T09:00:01.000Z"
  }).map((item) => item.id).includes(recovered.successorDispatch.id), true);

  const replay = requeuePublicHealthExternalDeadLetterToState(
    recovered.nextData,
    original.id,
    input,
    credentials(),
    { name: "免疫规划责任人", role: "cdc" },
    prepared.dependencies
  );
  assert.equal(replay.idempotent, true);
  assert.equal(replay.nextData.publicHealthExternalDispatches.length, 2);
  assert.equal(replay.nextData.publicHealthExternalDispatchAudit.length, 4);
  assert.throws(() => requeuePublicHealthExternalDeadLetterToState(
    recovered.nextData,
    original.id,
    { ...input, idempotencyKey: "immunization:second-requeue" },
    credentials(),
    { name: "免疫规划责任人", role: "cdc" },
    prepared.dependencies
  ), /already been requeued/);
});

test("dead-letter recovery after sunset creates a signed active-contract successor", () => {
  const prepared = rejectedLane("family-doctor");
  const retiredGovernance = runtimeContractGovernance("2026-08-15T00:00:00.000Z");
  const recovered = requeuePublicHealthExternalDeadLetterToState(
    prepared.rejected.nextData,
    prepared.rejected.dispatch.id,
    {
      idempotencyKey: "family-doctor:contract-cutover:requeue",
      expectedVersion: 2,
      coordinationExpectedVersion: 4,
      note: "old contract dead letter migrated to the active contract",
      remediationEvidenceRefs: ["family-doctor-v2-migration-review"],
      exceptionOwner: "family-doctor-contract-owner",
      exceptionDueAt: "2026-08-20",
      at: "2026-08-15T00:01:00.000Z"
    },
    credentials({ contractGovernance: retiredGovernance }),
    { name: "family doctor contract owner", role: "primary-care" },
    prepared.dependencies
  );
  assert.equal(recovered.originalDispatch.contract, "family-doctor-fulfillment-v1");
  assert.equal(recovered.originalDispatch.recovery.state, "requeued");
  assert.equal(recovered.successorDispatch.contract, "family-doctor-fulfillment-v2");
  assert.equal(recovered.successorDispatch.request.schemaVersion, "public-health-external-dispatch/v2");
  assert.equal(recovered.successorDispatch.predecessorDispatchId, recovered.originalDispatch.id);
  assert.equal(verifyRuntimeStateSignature(recovered.successorDispatch, REQUEST_SECRET), true);
  assert.equal(verifyPublicHealthExternalAuditChain(
    recovered.nextData,
    recovered.successorDispatch.id,
    REQUEST_SECRET
  ).ok, true);
});

test("dead-letter recovery requires the lane owner, evidence and current versions", () => {
  const prepared = rejectedLane("immunization");
  const original = prepared.rejected.dispatch;
  const input = {
    idempotencyKey: "immunization:dead-letter:governed-requeue",
    expectedVersion: 2,
    coordinationExpectedVersion: 4,
    note: "完成修复",
    remediationEvidenceRefs: ["approved-remediation"],
    exceptionOwner: "免疫规划恢复专班",
    exceptionDueAt: "2026-08-02"
  };
  assert.throws(() => requeuePublicHealthExternalDeadLetterToState(
    prepared.rejected.nextData,
    original.id,
    input,
    credentials(),
    { name: "基层人员", role: "primary-care" },
    prepared.dependencies
  ), /role primary-care is not allowed/);
  assert.throws(() => requeuePublicHealthExternalDeadLetterToState(
    prepared.rejected.nextData,
    original.id,
    { ...input, remediationEvidenceRefs: [] },
    credentials(),
    { name: "免疫规划责任人", role: "cdc" },
    prepared.dependencies
  ), /remediationEvidenceRefs are required/);
  assert.throws(() => requeuePublicHealthExternalDeadLetterToState(
    prepared.rejected.nextData,
    original.id,
    { ...input, expectedVersion: 1 },
    credentials(),
    { name: "免疫规划责任人", role: "cdc" },
    prepared.dependencies
  ), /external dispatch version conflict/);
  assert.throws(() => requeuePublicHealthExternalDeadLetterToState(
    prepared.rejected.nextData,
    original.id,
    { ...input, coordinationExpectedVersion: 3 },
    credentials(),
    { name: "免疫规划责任人", role: "cdc" },
    prepared.dependencies
  ), /version conflict/);
  assert.equal(prepared.rejected.nextData.publicHealthExternalDispatches.length, 1);
});

test("retry exhaustion opens a receipt-free compensation exception", () => {
  const prepared = enqueueLane("health-education");
  const dispatch = prepared.enqueued.dispatch;
  const firstClaim = claimPublicHealthExternalDispatchToState(
    prepared.enqueued.nextData,
    dispatch.id,
    {
      workerId: "education-worker-1",
      idempotencyKey: "education:claim:one",
      expectedVersion: 1,
      now: "2026-07-23T08:00:30.000Z",
      leaseSeconds: 60
    },
    credentials()
  );
  const retry = recordClaimedPublicHealthExternalAttemptToState(
    firstClaim.nextData,
    dispatch.id,
    { transportStatus: 503 },
    {
      ...attemptOptions("education:attempt:one", "2026-07-23T08:01:00.000Z", 2),
      workerId: "education-worker-1",
      leaseToken: firstClaim.leaseToken
    },
    prepared.dependencies
  );
  assert.equal(retry.dispatch.deliveryState, "retry-scheduled");
  assert.equal(retry.coordinationAction, null);
  assert.equal(retry.dispatch.lease, null);
  assert.equal(listDuePublicHealthExternalDispatches(retry.nextData, { now: "2026-07-23T08:02:00.000Z" }).length, 0);
  const secondClaim = claimPublicHealthExternalDispatchToState(
    retry.nextData,
    dispatch.id,
    {
      workerId: "education-worker-2",
      idempotencyKey: "education:claim:two",
      expectedVersion: 3,
      now: "2026-07-23T08:03:01.000Z",
      leaseSeconds: 60
    },
    credentials()
  );
  const deadLetter = recordClaimedPublicHealthExternalAttemptToState(
    secondClaim.nextData,
    dispatch.id,
    { networkError: "connection reset" },
    {
      ...attemptOptions("education:attempt:two", "2026-07-23T08:03:30.000Z", 4),
      workerId: "education-worker-2",
      leaseToken: secondClaim.leaseToken
    },
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

test("worker leases prevent concurrent delivery and allow expired lease takeover", () => {
  const prepared = enqueueLane("senior-health");
  const dispatchId = prepared.enqueued.dispatch.id;
  assert.equal(listDuePublicHealthExternalDispatches(prepared.enqueued.nextData, {
    now: "2026-07-23T08:00:00.000Z"
  })[0].outboxVersion, 1);
  assert.throws(() => claimPublicHealthExternalDispatchToState(
    prepared.enqueued.nextData,
    dispatchId,
    {
      workerId: "senior-worker-one",
      idempotencyKey: "senior:claim:stale-version",
      expectedVersion: 0,
      now: "2026-07-23T08:00:00.000Z",
      leaseSeconds: 15
    },
    credentials()
  ), /external dispatch version conflict/);
  const first = claimPublicHealthExternalDispatchToState(
    prepared.enqueued.nextData,
    dispatchId,
    {
      workerId: "senior-worker-one",
      idempotencyKey: "senior:claim:one",
      expectedVersion: 1,
      now: "2026-07-23T08:00:00.000Z",
      leaseSeconds: 15
    },
    credentials()
  );
  assert.match(first.leaseToken, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first.nextData).includes(first.leaseToken), false);
  assert.equal(first.externalRuntime.summary.leased, 1);
  assert.equal(listDuePublicHealthExternalDispatches(first.nextData, {
    now: "2026-07-23T08:00:10.000Z"
  }).length, 0);
  assert.throws(() => claimPublicHealthExternalDispatchToState(
    first.nextData,
    dispatchId,
    {
      workerId: "senior-worker-two",
      idempotencyKey: "senior:claim:two-early",
      expectedVersion: 2,
      now: "2026-07-23T08:00:10.000Z",
      leaseSeconds: 30
    },
    credentials()
  ), /already claimed/);

  const dueAfterExpiry = listDuePublicHealthExternalDispatches(first.nextData, {
    now: "2026-07-23T08:00:16.000Z"
  });
  assert.equal(dueAfterExpiry.length, 1);
  assert.equal(dueAfterExpiry[0].expiredLeaseReclaimable, true);
  const reclaimed = claimPublicHealthExternalDispatchToState(
    first.nextData,
    dispatchId,
    {
      workerId: "senior-worker-two",
      idempotencyKey: "senior:claim:two",
      expectedVersion: 2,
      now: "2026-07-23T08:00:16.000Z",
      leaseSeconds: 30
    },
    credentials()
  );
  assert.equal(reclaimed.nextData.publicHealthExternalDispatchAudit.at(-1).reclaimedExpiredLease, true);
  assert.throws(() => recordClaimedPublicHealthExternalAttemptToState(
    reclaimed.nextData,
    dispatchId,
    { transportStatus: 503 },
    {
      ...attemptOptions("senior:attempt:stale-worker", "2026-07-23T08:00:20.000Z", 3),
      workerId: "senior-worker-one",
      leaseToken: first.leaseToken
    },
    prepared.dependencies
  ), /lease token is invalid/);
});

test("unclaimed callbacks require a valid signed receipt and cannot force dead letter", () => {
  const prepared = enqueueLane("public-health-followup");
  const dispatch = prepared.enqueued.dispatch;
  assert.throws(() => recordPublicHealthExternalAttemptToState(
    prepared.enqueued.nextData,
    dispatch.id,
    { transportStatus: 200, receipt: signedReceipt(dispatch) },
    attemptOptions("followup:callback:stale-version", "2026-07-23T08:01:30.000Z", 0),
    prepared.dependencies
  ), /external dispatch version conflict/);
  const forged = { ...signedReceipt(dispatch), receiptCode: "FORGED-CALLBACK" };
  assert.throws(() => recordPublicHealthExternalAttemptToState(
    prepared.enqueued.nextData,
    dispatch.id,
    { transportStatus: 200, receipt: forged },
    attemptOptions("followup:callback:forged"),
    prepared.dependencies
  ), /unclaimed external callback rejected: receipt-signature-invalid/);
  assert.equal(prepared.enqueued.nextData.publicHealthExternalDispatches[0].deliveryState, "pending");
  assert.equal(prepared.enqueued.nextData.publicHealthExternalDispatchAudit.length, 1);
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

test("external audit modification deletion and unsigned append are rejected before writes", () => {
  const prepared = enqueueLane("chronic-management");
  const dispatch = prepared.enqueued.dispatch;
  const variants = [
    (data) => { data.publicHealthExternalDispatchAudit[0].action = "forged-action"; },
    (data) => { data.publicHealthExternalDispatchAudit = []; },
    (data) => {
      data.publicHealthExternalDispatchAudit.push({
        dispatchId: dispatch.id,
        action: "unsigned-append",
        previousAuditHash: dispatch.auditHead
      });
    }
  ];
  for (const mutate of variants) {
    const tampered = JSON.parse(JSON.stringify(prepared.enqueued.nextData));
    mutate(tampered);
    assert.equal(verifyPublicHealthExternalAuditChain(tampered, dispatch.id, REQUEST_SECRET).ok, false);
    assert.throws(() => claimPublicHealthExternalDispatchToState(
      tampered,
      dispatch.id,
      {
        workerId: "audit-chain-worker",
        idempotencyKey: "audit-chain-claim",
        expectedVersion: 1,
        now: "2026-07-23T08:00:30.000Z",
        leaseSeconds: 60
      },
      credentials()
    ), /persisted public health external audit rejected/);
  }
});

test("external audit chain remains verifiable across an authorized request-key rotation", () => {
  const oldRequestKeyring = {
    purpose: "public-health-request",
    activeKeyId: "request-2026-07",
    keys: [{
      keyId: "request-2026-07",
      secret: REQUEST_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
  const receiptKeyring = {
    purpose: "public-health-receipt",
    activeKeyId: "receipt-2026-07",
    keys: [{
      keyId: "receipt-2026-07",
      secret: RECEIPT_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
  const prepared = advanceToInProgress("senior-health");
  const enqueued = enqueuePublicHealthExternalDispatchToState(
    prepared.data,
    prepared.handoffId,
    {
      idempotencyKey: "senior-health:key-rotation:enqueue",
      operation: "coordination-handoff",
      evidenceRefs: ["senior-health-key-rotation"],
      exceptionOwner: "senior-health-interface-owner",
      exceptionDueAt: "2026-07-31",
      at: "2026-07-23T08:00:00.000Z"
    },
    {
      endpoint: "https://external-runtime.example.test/dispatch",
      requestKeyring: oldRequestKeyring,
      receiptKeyring,
      maxAttempts: 2
    },
    prepared.dependencies
  );
  const rotatedRequestKeyring = {
    purpose: "public-health-request",
    activeKeyId: "request-2026-08",
    keys: [
      { ...oldRequestKeyring.keys[0], status: "grace" },
      {
        keyId: "request-2026-08",
        secret: "runtime-request-next-secret-1234567890-1234",
        status: "active",
        notBefore: "2026-07-23T08:01:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
        revokedAt: ""
      }
    ]
  };
  const claimed = claimPublicHealthExternalDispatchToState(
    enqueued.nextData,
    enqueued.dispatch.id,
    {
      workerId: "public-health-worker-rotation",
      idempotencyKey: "senior-health:key-rotation:claim",
      expectedVersion: 1,
      now: "2026-07-23T08:02:00.000Z",
      leaseSeconds: 60
    },
    { requestKeyring: rotatedRequestKeyring }
  );
  assert.equal(enqueued.dispatch.requestSignatureKeyId, "request-2026-07");
  assert.equal(claimed.dispatch.runtimeStateKeyId, "request-2026-08");
  assert.deepEqual(
    claimed.nextData.publicHealthExternalDispatchAudit.map((item) => item.auditKeyId),
    ["request-2026-07", "request-2026-08"]
  );
  assert.equal(verifyRuntimeStateSignature(claimed.dispatch, rotatedRequestKeyring), true);
  assert.equal(verifyPublicHealthExternalAuditChain(
    claimed.nextData,
    claimed.dispatch.id,
    rotatedRequestKeyring
  ).ok, true);
});

test("configured backpressure rejects a second queued dispatch before persistence", () => {
  const prepared = enqueueLane("maternal-child");
  assert.throws(() => enqueuePublicHealthExternalDispatchToState(
    prepared.enqueued.nextData,
    prepared.handoffId,
    {
      idempotencyKey: "maternal-child:external:backpressure-second",
      operation: "coordination-handoff",
      evidenceRefs: ["maternal-child-second-request"],
      exceptionOwner: "maternal-child-interface-owner",
      exceptionDueAt: "2026-07-31",
      at: "2026-07-23T08:00:10.000Z"
    },
    credentials({
      resiliencePolicy: {
        failureThreshold: 1,
        openSeconds: 30,
        rateLimitPerMinute: 10,
        halfOpenMaxProbes: 1,
        maxPending: 1
      }
    }),
    prepared.dependencies
  ), /backpressure limit reached/);
  assert.equal(prepared.enqueued.nextData.publicHealthExternalDispatches.length, 1);
});

test("claimed delivery opens the signed circuit and a half-open probe closes it", () => {
  const policy = {
    failureThreshold: 1,
    openSeconds: 30,
    rateLimitPerMinute: 10,
    halfOpenMaxProbes: 1,
    maxPending: 10
  };
  const prepared = enqueueLane("health-education");
  const firstClaim = claimPublicHealthExternalDispatchToState(
    prepared.enqueued.nextData,
    prepared.enqueued.dispatch.id,
    {
      workerId: "health-education-resilience-worker-1",
      idempotencyKey: "health-education:resilience:claim-1",
      expectedVersion: 1,
      expectedLaneControlVersion: 0,
      now: "2026-07-23T08:00:10.000Z",
      leaseSeconds: 60
    },
    credentials({ resiliencePolicy: policy })
  );
  assert.equal(firstClaim.laneControl.version, 1);
  assert.equal(firstClaim.laneControl.circuitState, "closed");

  const failed = recordClaimedPublicHealthExternalAttemptToState(
    firstClaim.nextData,
    firstClaim.dispatch.id,
    { transportStatus: 503 },
    {
      ...attemptOptions("health-education:resilience:attempt-1", "2026-07-23T08:00:20.000Z", 2),
      workerId: "health-education-resilience-worker-1",
      leaseToken: firstClaim.leaseToken,
      expectedLaneControlVersion: 1,
      resiliencePolicy: policy
    },
    prepared.dependencies
  );
  assert.equal(failed.dispatch.deliveryState, "retry-scheduled");
  assert.equal(failed.laneControl.version, 2);
  assert.equal(failed.laneControl.circuitState, "open");
  assert.equal(failed.laneControl.openUntil, "2026-07-23T08:00:50.000Z");

  const secondEnqueue = enqueuePublicHealthExternalDispatchToState(
    failed.nextData,
    prepared.handoffId,
    {
      idempotencyKey: "health-education:resilience:enqueue-2",
      operation: "coordination-handoff",
      evidenceRefs: ["health-education-probe-request"],
      exceptionOwner: "health-education-interface-owner",
      exceptionDueAt: "2026-07-31",
      at: "2026-07-23T08:00:25.000Z"
    },
    credentials({ resiliencePolicy: policy }),
    prepared.dependencies
  );
  assert.throws(() => claimPublicHealthExternalDispatchToState(
    secondEnqueue.nextData,
    secondEnqueue.dispatch.id,
    {
      workerId: "health-education-resilience-worker-2",
      idempotencyKey: "health-education:resilience:blocked-claim",
      expectedVersion: 1,
      expectedLaneControlVersion: 2,
      now: "2026-07-23T08:00:30.000Z",
      leaseSeconds: 60
    },
    credentials({ resiliencePolicy: policy })
  ), /circuit is open/);

  const probe = claimPublicHealthExternalDispatchToState(
    secondEnqueue.nextData,
    secondEnqueue.dispatch.id,
    {
      workerId: "health-education-resilience-worker-2",
      idempotencyKey: "health-education:resilience:probe-claim",
      expectedVersion: 1,
      expectedLaneControlVersion: 2,
      now: "2026-07-23T08:00:50.000Z",
      leaseSeconds: 60
    },
    credentials({ resiliencePolicy: policy })
  );
  assert.equal(probe.laneControl.version, 3);
  assert.equal(probe.laneControl.circuitState, "half-open");

  const receipt = signedReceipt(probe.dispatch, {
    receiptCode: "HEALTH-EDUCATION-PROBE-ACCEPT",
    receivedAt: "2026-07-23T08:01:00.000Z",
    nonce: "health-education-probe-nonce"
  });
  const recovered = recordClaimedPublicHealthExternalAttemptToState(
    probe.nextData,
    probe.dispatch.id,
    { transportStatus: 200, receipt },
    {
      ...attemptOptions("health-education:resilience:probe-success", "2026-07-23T08:01:00.000Z", 2),
      workerId: "health-education-resilience-worker-2",
      leaseToken: probe.leaseToken,
      expectedLaneControlVersion: 3,
      resiliencePolicy: policy
    },
    prepared.dependencies
  );
  assert.equal(recovered.dispatch.deliveryState, "delivered");
  assert.equal(recovered.laneControl.version, 4);
  assert.equal(recovered.laneControl.circuitState, "closed");
  assert.equal(recovered.externalRuntime.summary.openCircuits, 0);
  assert.equal(recovered.externalRuntime.summary.resilienceLanes, 1);
  assert.equal(verifyPublicHealthExternalLaneControlAuditChain(
    recovered.nextData,
    "health-education",
    REQUEST_SECRET
  ).entries, 4);
});

test("contract governance allows deprecated work, blocks retired claims and emits the active next version", () => {
  const deprecated = enqueueLane("family-doctor");
  const deprecatedGovernance = runtimeContractGovernance("2026-07-25T00:00:00.000Z");
  const claimed = claimPublicHealthExternalDispatchToState(
    deprecated.enqueued.nextData,
    deprecated.enqueued.dispatch.id,
    {
      workerId: "family-doctor-contract-worker",
      idempotencyKey: "family-doctor:contract:deprecated-claim",
      expectedVersion: 1,
      now: "2026-07-25T00:00:00.000Z",
      leaseSeconds: 60
    },
    credentials({ contractGovernance: deprecatedGovernance })
  );
  assert.equal(claimed.contractAuthorization.reason, "contract-version-deprecated");

  const retired = enqueueLane("family-doctor");
  const retiredGovernance = runtimeContractGovernance("2026-08-15T00:00:00.000Z");
  assert.throws(() => claimPublicHealthExternalDispatchToState(
    retired.enqueued.nextData,
    retired.enqueued.dispatch.id,
    {
      workerId: "family-doctor-contract-worker",
      idempotencyKey: "family-doctor:contract:retired-claim",
      expectedVersion: 1,
      now: "2026-08-15T00:00:00.000Z",
      leaseSeconds: 60
    },
    credentials({ contractGovernance: retiredGovernance })
  ), /contract-version-retired/);

  const prepared = advanceToInProgress("family-doctor");
  const nextVersion = enqueuePublicHealthExternalDispatchToState(
    prepared.data,
    prepared.handoffId,
    {
      idempotencyKey: "family-doctor:contract:retired-enqueue",
      operation: "coordination-handoff",
      evidenceRefs: ["family-doctor-retired-contract-request"],
      exceptionOwner: "family-doctor-interface-owner",
      exceptionDueAt: "2026-08-31",
      at: "2026-08-15T00:00:00.000Z"
    },
    credentials({ contractGovernance: retiredGovernance }),
    prepared.dependencies
  );
  assert.equal(nextVersion.dispatch.contract, "family-doctor-fulfillment-v2");
  assert.equal(nextVersion.dispatch.request.schemaVersion, "public-health-external-dispatch/v2");
  assert.equal(nextVersion.contractAuthorization.reason, "verified");
  const nextVersionClaim = claimPublicHealthExternalDispatchToState(
    nextVersion.nextData,
    nextVersion.dispatch.id,
    {
      workerId: "family-doctor-contract-v2-worker",
      idempotencyKey: "family-doctor:contract:v2-claim",
      expectedVersion: 1,
      now: "2026-08-15T00:00:10.000Z",
      leaseSeconds: 60
    },
    credentials({ contractGovernance: retiredGovernance })
  );
  assert.equal(nextVersionClaim.contractAuthorization.reason, "verified");
});

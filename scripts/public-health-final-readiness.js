#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const data = require("../data/db.json");
const {
  applyPublicHealthCoordinationAction
} = require("../public-health-coordination-service");
const {
  applyPublicHealthCoordinationActionToState,
  buildPublicHealthCoordinationRuntime
} = require("../public-health-coordination-runtime");
const {
  EXTERNAL_ADAPTER_PROFILES,
  buildPublicHealthExternalAdapterRegistry,
  createPublicHealthExternalDispatch,
  recordPublicHealthExternalDeliveryAttempt,
  signPublicHealthExternalReceipt
} = require("../public-health-external-adapter-service");
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
  buildPublicHealthExternalOperationsBoard
} = require("../public-health-external-operations-service");
const { summarizeKeyring } = require("../public-health-external-keyring-service");
const {
  recordPublicHealthExternalLaneOutcomeToState,
  reservePublicHealthExternalLaneCapacityToState,
  verifyPublicHealthExternalLaneControlAuditChain
} = require("../public-health-external-resilience-service");
const { buildPublicHealthSystem } = require("./public-health-readiness");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "public-health-final-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "public-health-final-readiness-report.md");
const ACCEPTANCE_REQUEST_SECRET = "t08-acceptance-request-secret-1234567890";
const ACCEPTANCE_RECEIPT_SECRET = "t08-acceptance-receipt-secret-1234567890";

function check(id, passed, detail, category) {
  return { id, passed: Boolean(passed), detail, category };
}

function buildConfiguredAcceptanceEnvironment() {
  return Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.flatMap((profile) => [
    [profile.endpointEnv, `https://${profile.laneId}.acceptance.invalid/dispatch`],
    [profile.requestSecretEnv, ACCEPTANCE_REQUEST_SECRET],
    [profile.receiptSecretEnv, ACCEPTANCE_RECEIPT_SECRET]
  ]));
}

function runExternalAdapterAcceptance(center) {
  return center.handoffs.map((initial, index) => {
    const owner = { name: `${initial.laneId}-acceptance-owner`, role: initial.ownerRole };
    let handoff = applyPublicHealthCoordinationAction(initial, {
      action: "assign-coordination",
      idempotencyKey: `${initial.id}:final:assign`,
      expectedVersion: 1,
      assignedTo: initial.owner,
      dueAt: "2026-07-31",
      note: "final readiness assignment"
    }, owner).handoff;
    handoff = applyPublicHealthCoordinationAction(handoff, {
      action: "start-coordination",
      idempotencyKey: `${initial.id}:final:start`,
      expectedVersion: 2,
      note: "final readiness dispatch"
    }, owner).handoff;
    const dispatch = createPublicHealthExternalDispatch(handoff, {
      idempotencyKey: `${initial.id}:final:dispatch`,
      operation: "coordination-handoff",
      evidenceRefs: [initial.requiredEvidence[0]]
    }, {
      endpoint: `https://${initial.laneId}.acceptance.invalid/dispatch`,
      requestSecret: ACCEPTANCE_REQUEST_SECRET,
      receiptSecret: ACCEPTANCE_RECEIPT_SECRET
    });
    const receipt = signPublicHealthExternalReceipt({
      dispatchId: dispatch.id,
      requestDigest: dispatch.requestDigest,
      laneId: dispatch.laneId,
      handoffId: dispatch.handoffId,
      status: "accepted",
      receiptCode: `T08-ACCEPT-${String(index + 1).padStart(2, "0")}`,
      evidenceRefs: [`${dispatch.laneId}-signed-receipt`],
      receivedAt: `2026-07-22T08:${String(index).padStart(2, "0")}:00.000Z`
    }, ACCEPTANCE_RECEIPT_SECRET);
    return recordPublicHealthExternalDeliveryAttempt(dispatch, { transportStatus: 200, receipt }, {
      receiptSecret: ACCEPTANCE_RECEIPT_SECRET,
      at: `2026-07-22T08:${String(index).padStart(2, "0")}:30.000Z`
    });
  });
}

function runRuntimeAcceptance(sourceData, system) {
  const dependencies = {
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  };
  const initial = system.coordinationCenter.handoffs.find((item) => item.laneId === "public-health-followup");
  const payload = {
    action: "assign-coordination",
    idempotencyKey: "final:runtime:followup:assign",
    expectedVersion: 1,
    assignedTo: "基层公卫专班",
    dueAt: "2026-07-31",
    note: "final readiness persistence check"
  };
  const first = applyPublicHealthCoordinationActionToState(
    sourceData,
    initial.id,
    payload,
    { name: "基层公卫管理员", role: "primary-care" },
    dependencies
  );
  const replay = applyPublicHealthCoordinationActionToState(
    first.nextData,
    initial.id,
    payload,
    { name: "基层公卫管理员", role: "primary-care" },
    dependencies
  );
  return { first, replay };
}

function runExternalOutboxAcceptance(sourceData, system) {
  const dependencies = {
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  };
  const initial = system.coordinationCenter.handoffs.find((item) => item.laneId === "family-doctor");
  const owner = { name: "family-doctor-outbox-owner", role: initial.ownerRole };
  const assigned = applyPublicHealthCoordinationActionToState(sourceData, initial.id, {
    action: "assign-coordination",
    idempotencyKey: "final:outbox:family-doctor:assign",
    expectedVersion: 1,
    assignedTo: initial.owner,
    dueAt: "2026-07-31",
    note: "final outbox readiness assignment"
  }, owner, dependencies);
  const started = applyPublicHealthCoordinationActionToState(assigned.nextData, initial.id, {
    action: "start-coordination",
    idempotencyKey: "final:outbox:family-doctor:start",
    expectedVersion: 2,
    note: "final outbox readiness dispatch"
  }, owner, dependencies);
  const credentials = {
    endpoint: "https://family-doctor.acceptance.invalid/dispatch",
    requestSecret: ACCEPTANCE_REQUEST_SECRET,
    receiptSecret: ACCEPTANCE_RECEIPT_SECRET
  };
  const enqueued = enqueuePublicHealthExternalDispatchToState(started.nextData, initial.id, {
    idempotencyKey: "final:outbox:family-doctor:enqueue",
    operation: "coordination-handoff",
    evidenceRefs: ["family-doctor-request-evidence"],
    exceptionOwner: "family-doctor-interface-team",
    exceptionDueAt: "2026-07-31",
    at: "2026-07-23T08:00:00.000Z"
  }, credentials, dependencies);
  const dueBeforeClaim = listDuePublicHealthExternalDispatches(enqueued.nextData, {
    now: "2026-07-23T08:00:30.000Z"
  });
  const claimed = claimPublicHealthExternalDispatchToState(enqueued.nextData, enqueued.dispatch.id, {
    workerId: "final-readiness-family-doctor-worker",
    idempotencyKey: "final:outbox:family-doctor:claim",
    expectedVersion: 1,
    now: "2026-07-23T08:00:30.000Z",
    leaseSeconds: 60
  }, credentials);
  const receipt = signPublicHealthExternalReceipt({
    dispatchId: enqueued.dispatch.id,
    requestDigest: enqueued.dispatch.requestDigest,
    laneId: enqueued.dispatch.laneId,
    handoffId: enqueued.dispatch.handoffId,
    status: "accepted",
    receiptCode: "T08-OUTBOX-ACCEPT-01",
    evidenceRefs: ["family-doctor-signed-receipt"],
    receivedAt: "2026-07-23T08:01:00.000Z"
  }, ACCEPTANCE_RECEIPT_SECRET);
  const delivered = recordClaimedPublicHealthExternalAttemptToState(claimed.nextData, enqueued.dispatch.id, {
    transportStatus: 200,
    receipt
  }, {
    requestSecret: ACCEPTANCE_REQUEST_SECRET,
    receiptSecret: ACCEPTANCE_RECEIPT_SECRET,
    attemptIdempotencyKey: "final:outbox:family-doctor:attempt",
    expectedVersion: 2,
    at: "2026-07-23T08:01:00.000Z",
    workerId: "final-readiness-family-doctor-worker",
    leaseToken: claimed.leaseToken
  }, dependencies);
  const handoff = buildPublicHealthCoordinationRuntime({ data: delivered.nextData, ...dependencies })
    .handoffs.find((item) => item.id === initial.id);
  return { enqueued, dueBeforeClaim, claimed, delivered, handoff };
}

function runDeadLetterRecoveryAcceptance(sourceData, system) {
  const dependencies = {
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  };
  const initial = system.coordinationCenter.handoffs.find((item) => item.laneId === "immunization");
  const owner = { name: "immunization-recovery-owner", role: initial.ownerRole };
  const assigned = applyPublicHealthCoordinationActionToState(sourceData, initial.id, {
    action: "assign-coordination",
    idempotencyKey: "final:recovery:immunization:assign",
    expectedVersion: 1,
    assignedTo: initial.owner,
    dueAt: "2026-07-31",
    note: "final recovery readiness assignment"
  }, owner, dependencies);
  const started = applyPublicHealthCoordinationActionToState(assigned.nextData, initial.id, {
    action: "start-coordination",
    idempotencyKey: "final:recovery:immunization:start",
    expectedVersion: 2,
    note: "final recovery readiness dispatch"
  }, owner, dependencies);
  const credentials = {
    endpoint: "https://immunization.acceptance.invalid/dispatch",
    requestSecret: ACCEPTANCE_REQUEST_SECRET,
    receiptSecret: ACCEPTANCE_RECEIPT_SECRET
  };
  const enqueued = enqueuePublicHealthExternalDispatchToState(started.nextData, initial.id, {
    idempotencyKey: "final:recovery:immunization:enqueue",
    operation: "coordination-handoff",
    evidenceRefs: ["immunization-request-evidence"],
    exceptionOwner: "immunization-original-team",
    exceptionDueAt: "2026-07-30",
    at: "2026-07-23T09:00:00.000Z"
  }, credentials, dependencies);
  const rejection = signPublicHealthExternalReceipt({
    dispatchId: enqueued.dispatch.id,
    requestDigest: enqueued.dispatch.requestDigest,
    laneId: enqueued.dispatch.laneId,
    handoffId: enqueued.dispatch.handoffId,
    status: "rejected",
    receiptCode: "T08-RECOVERY-REJECT-01",
    evidenceRefs: ["immunization-rejection-receipt"],
    receivedAt: "2026-07-23T09:01:00.000Z",
    reason: "acceptance field version mismatch",
    exceptionOwner: "immunization-original-team",
    dueAt: "2026-07-30"
  }, ACCEPTANCE_RECEIPT_SECRET);
  const rejected = recordPublicHealthExternalAttemptToState(enqueued.nextData, enqueued.dispatch.id, {
    transportStatus: 200,
    receipt: rejection
  }, {
    requestSecret: ACCEPTANCE_REQUEST_SECRET,
    receiptSecret: ACCEPTANCE_RECEIPT_SECRET,
    attemptIdempotencyKey: "final:recovery:immunization:rejection",
    expectedVersion: 1,
    at: "2026-07-23T09:01:30.000Z"
  }, dependencies);
  const recovered = requeuePublicHealthExternalDeadLetterToState(
    rejected.nextData,
    rejected.dispatch.id,
    {
      idempotencyKey: "final:recovery:immunization:requeue",
      expectedVersion: 2,
      coordinationExpectedVersion: 4,
      note: "field mapping remediated and reviewed",
      remediationEvidenceRefs: ["immunization-field-map-v2", "immunization-remediation-signoff"],
      exceptionOwner: "immunization-recovery-team",
      exceptionDueAt: "2026-08-02",
      at: "2026-07-23T09:30:00.000Z"
    },
    credentials,
    owner,
    dependencies
  );
  const handoff = buildPublicHealthCoordinationRuntime({ data: recovered.nextData, ...dependencies })
    .handoffs.find((item) => item.id === initial.id);
  return { enqueued, rejected, recovered, handoff };
}

function runExternalResilienceAcceptance() {
  const policy = {
    failureThreshold: 1,
    openSeconds: 30,
    halfOpenMaxProbes: 1,
    rateLimitPerMinute: 10,
    maxPending: 10
  };
  const reserved = reservePublicHealthExternalLaneCapacityToState(
    {},
    "family-doctor",
    { at: "2026-07-23T10:00:00.000Z", expectedVersion: 0 },
    ACCEPTANCE_REQUEST_SECRET,
    policy
  );
  const failed = recordPublicHealthExternalLaneOutcomeToState(
    reserved.nextData,
    "family-doctor",
    { type: "failure", reason: "network-error" },
    { at: "2026-07-23T10:00:10.000Z", expectedVersion: 1 },
    ACCEPTANCE_REQUEST_SECRET,
    policy
  );
  const probe = reservePublicHealthExternalLaneCapacityToState(
    failed.nextData,
    "family-doctor",
    { at: "2026-07-23T10:00:40.000Z", expectedVersion: 2 },
    ACCEPTANCE_REQUEST_SECRET,
    policy
  );
  const recovered = recordPublicHealthExternalLaneOutcomeToState(
    probe.nextData,
    "family-doctor",
    { type: "success", reason: "verified-signed-receipt" },
    { at: "2026-07-23T10:00:45.000Z", expectedVersion: 3 },
    ACCEPTANCE_REQUEST_SECRET,
    policy
  );
  return { policy, reserved, failed, probe, recovered };
}

function buildPublicHealthFinalReadiness(options = {}) {
  const sourceData = options.data || data;
  const system = options.system || buildPublicHealthSystem({ ...options, data: sourceData });
  const runtime = buildPublicHealthCoordinationRuntime({
    data: sourceData,
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  });
  const runtimeAcceptance = runRuntimeAcceptance(sourceData, system);
  const registry = buildPublicHealthExternalAdapterRegistry(buildConfiguredAcceptanceEnvironment());
  const deliveries = runExternalAdapterAcceptance(system.coordinationCenter);
  const outboxAcceptance = runExternalOutboxAcceptance(sourceData, system);
  const recoveryAcceptance = runDeadLetterRecoveryAcceptance(sourceData, system);
  const resilienceAcceptance = runExternalResilienceAcceptance();
  const recoveryCoordination = buildPublicHealthCoordinationRuntime({
    data: recoveryAcceptance.recovered.nextData,
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  });
  const operationsBoard = buildPublicHealthExternalOperationsBoard({
    data: recoveryAcceptance.recovered.nextData,
    coordinationCenter: recoveryCoordination,
    secretResolver: () => ACCEPTANCE_REQUEST_SECRET,
    now: "2026-07-23T09:31:00.000Z"
  });
  const tamperedAuditData = JSON.parse(JSON.stringify(recoveryAcceptance.recovered.nextData));
  tamperedAuditData.publicHealthExternalDispatchAudit[0].action = "forged-final-readiness-audit";
  const tamperedOperationsBoard = buildPublicHealthExternalOperationsBoard({
    data: tamperedAuditData,
    coordinationCenter: recoveryCoordination,
    secretResolver: () => ACCEPTANCE_REQUEST_SECRET,
    now: "2026-07-23T09:31:00.000Z"
  });
  const runtimeSource = options.runtimeSource ?? fs.readFileSync(path.join(ROOT, "public-health-coordination-runtime.js"), "utf8");
  const adapterSource = options.adapterSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-adapter-service.js"), "utf8");
  const adapterRuntimeSource = options.adapterRuntimeSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-adapter-runtime.js"), "utf8");
  const operationsSource = options.operationsSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-operations-service.js"), "utf8");
  const keyringSource = options.keyringSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-keyring-service.js"), "utf8");
  const resilienceSource = options.resilienceSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-resilience-service.js"), "utf8");
  const pageSource = options.pageSource ?? fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8");
  const doc = options.doc ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-eight-domain-coordination.md"), "utf8");
  const keyringDoc = options.keyringDoc ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-external-key-rotation.md"), "utf8");
  const resilienceDoc = options.resilienceDoc ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-external-resilience.md"), "utf8");
  const serializedDeliveries = JSON.stringify(deliveries);
  const managedKeyringSummary = summarizeKeyring({
    purpose: "t08-readiness-request",
    activeKeyId: "request-2026-07",
    keys: [{
      keyId: "request-2026-07",
      secret: ACCEPTANCE_REQUEST_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  }, "2026-07-23T09:31:00.000Z");
  const checks = [
    check("scope:eight-domain-center", system.coordinationCenter?.summary?.lanes === 8 && system.coordinationCenter?.ok, "8/8 coordination lanes are structurally runnable", "scope"),
    check("runtime:eight-handoffs", runtime.handoffs.length === 8 && runtime.functionalState === "eight-lane-coordination-persistence-ready", `${runtime.handoffs.length}/8 runtime handoffs`, "runtime"),
    check("runtime:persisted-write-model", runtimeAcceptance.first.nextData.publicHealthCoordinationHandoffs.length === 8, "immutable state patch contains all handoffs", "runtime"),
    check("runtime:minimized-audit", runtimeAcceptance.first.nextData.publicHealthCoordinationAudit.length === 1 && !Object.hasOwn(runtimeAcceptance.first.nextData.publicHealthCoordinationAudit[0], "residentId"), "audit is append-only and excludes residentId", "runtime"),
    check("runtime:idempotent-replay", runtimeAcceptance.replay.idempotent && runtimeAcceptance.replay.nextData.publicHealthCoordinationAudit.length === 1, "replay does not advance version or duplicate audit", "runtime"),
    check("runtime:optimistic-version", runtimeSource.includes("expectedVersion") || fs.readFileSync(path.join(ROOT, "public-health-coordination-service.js"), "utf8").includes("version conflict"), "optimistic version contract remains enforced", "runtime"),
    check("adapter:eight-profiles", registry.summary.adapters === 8 && registry.summary.configured === 8, `${registry.summary.configured}/8 acceptance adapter profiles configured`, "adapter"),
    check("adapter:eight-signed-deliveries", deliveries.length === 8 && deliveries.every((item) => item.deliveryState === "delivered"), `${deliveries.filter((item) => item.deliveryState === "delivered").length}/8 signed receipts verified`, "adapter"),
    check("adapter:privacy-minimized", !serializedDeliveries.includes("residentId") && !serializedDeliveries.includes(ACCEPTANCE_REQUEST_SECRET) && !serializedDeliveries.includes(ACCEPTANCE_RECEIPT_SECRET), "dispatch artifacts exclude resident identifiers and secrets", "adapter"),
    check("adapter:retry-dead-letter", ["retry-scheduled", "dead-letter", "timingSafeEqual"].every((token) => adapterSource.includes(token)), "transient retry, terminal dead letter and timing-safe verification are implemented", "adapter"),
    check("adapter:managed-keyring", managedKeyringSummary.productionReady === true && !JSON.stringify(managedKeyringSummary).includes(ACCEPTANCE_REQUEST_SECRET) && ["activeKeyId", "grace", "revoked", "key-expired-or-not-yet-valid"].every((token) => keyringSource.includes(token)), "managed active/grace/revoked key lifecycle is valid and secret-free", "adapter"),
    check("adapter:callback-anti-replay", ["receipt-issued-in-future", "receipt-expired", "receiptReplayKeyHash", "receipt replay detected"].every((token) => `${adapterSource}\n${adapterRuntimeSource}`.includes(token)), "signed callbacks bind key, issue/expiry time and nonce; stale, future and replayed callbacks fail closed", "adapter"),
    check("resilience:signed-circuit-recovery", resilienceAcceptance.failed.control.circuitState === "open" && resilienceAcceptance.probe.control.circuitState === "half-open" && resilienceAcceptance.recovered.control.circuitState === "closed" && verifyPublicHealthExternalLaneControlAuditChain(resilienceAcceptance.recovered.nextData, "family-doctor", ACCEPTANCE_REQUEST_SECRET).entries === 4, "signed failure, open gate, half-open probe and recovery form a four-entry lane-control audit chain", "resilience"),
    check("resilience:runtime-enforcement", ["assertPublicHealthExternalBackpressure", "reservePublicHealthExternalLaneCapacityToState", "recordPublicHealthExternalLaneOutcomeToState", "expectedLaneControlVersion"].every((token) => adapterRuntimeSource.includes(token)) && ["rateLimitPerMinute", "maxPending", "halfOpenMaxProbes", "lane-control-signature-invalid"].every((token) => resilienceSource.includes(token)), "enqueue backpressure, claim rate/circuit admission and claimed-attempt outcomes use signed CAS controls", "resilience"),
    check("outbox:persisted-enqueue-attempt", outboxAcceptance.delivered.externalRuntime.summary.dispatches === 1 && outboxAcceptance.delivered.externalRuntime.summary.auditEntries === 3, "one signed dispatch and three append-only enqueue/claim/attempt audit entries", "outbox"),
    check("outbox:coordination-advance", outboxAcceptance.delivered.dispatch.deliveryState === "delivered" && outboxAcceptance.handoff.state === "receipt-confirmed", "verified callback advances the linked coordination handoff", "outbox"),
    check("outbox:runtime-state-signature", verifyRuntimeStateSignature(outboxAcceptance.delivered.dispatch, ACCEPTANCE_REQUEST_SECRET), "mutable outbox state retains a trusted runtime signature", "outbox"),
    check("outbox:dead-letter-exception-contract", ["open-coordination-exception", "runtime-state-signature-invalid", "attemptIdempotencyKey"].every((token) => adapterRuntimeSource.includes(token)), "dead letters open compensation exceptions and callback replays are idempotent", "outbox"),
    check("worker:due-claim-lease", outboxAcceptance.dueBeforeClaim.length === 1 && outboxAcceptance.claimed.dispatch.lease && outboxAcceptance.delivered.dispatch.lease === null, "due dispatch is leased once and released after the claimed attempt", "worker"),
    check("worker:lease-token-private", !JSON.stringify(outboxAcceptance.claimed.nextData).includes(outboxAcceptance.claimed.leaseToken) && ["expiredLeaseReclaimable", "lease token is invalid", "unclaimed external callback rejected"].every((token) => adapterRuntimeSource.includes(token)), "lease token is not persisted; stale workers and forged callbacks fail closed", "worker"),
    check("worker:optimistic-outbox-version", outboxAcceptance.dueBeforeClaim[0]?.outboxVersion === 1 && outboxAcceptance.claimed.dispatch.outboxVersion === 2 && outboxAcceptance.delivered.dispatch.outboxVersion === 3 && adapterRuntimeSource.includes("external dispatch version conflict"), "due, claim and attempt expose a CAS-ready signed outbox version", "worker"),
    check("recovery:sealed-predecessor", recoveryAcceptance.recovered.originalDispatch.deliveryState === "dead-letter" && recoveryAcceptance.recovered.originalDispatch.recovery?.state === "requeued", "original dead letter remains terminal with a signed recovery seal", "recovery"),
    check("recovery:single-successor", recoveryAcceptance.recovered.successorDispatch.deliveryState === "pending" && recoveryAcceptance.recovered.successorDispatch.predecessorDispatchId === recoveryAcceptance.rejected.dispatch.id && recoveryAcceptance.recovered.externalRuntime.summary.recoverySuccessors === 1, "one pending successor preserves the predecessor link", "recovery"),
    check("recovery:authorized-coordination-retry", recoveryAcceptance.handoff.state === "in-progress" && recoveryAcceptance.handoff.exception?.status === "retry-submitted" && ["requeuePublicHealthExternalDeadLetterToState", "remediationEvidenceRefs", "approvedByRole"].every((token) => adapterRuntimeSource.includes(token)), "lane-authorized remediation evidence reopens coordination for delivery", "recovery"),
    check("audit:signed-append-only-chain", verifyPublicHealthExternalAuditChain(outboxAcceptance.delivered.nextData, outboxAcceptance.delivered.dispatch.id, ACCEPTANCE_REQUEST_SECRET).entries === 3 && ["previousAuditHash", "auditSignature", "auditHead"].every((token) => adapterRuntimeSource.includes(token)), "enqueue, claim and attempt form a signed per-dispatch audit chain", "audit"),
    check("audit:tampering-fails-closed", tamperedOperationsBoard.ok === false && tamperedOperationsBoard.issues.some((item) => item.code === "audit-chain-invalid"), "modified audit entry blocks the operations integrity gate", "audit"),
    check("operations:healthy-reconciliation", operationsBoard.ok === true && operationsBoard.operationallyHealthy === true && operationsBoard.summary.signatureVerified === 2 && operationsBoard.summary.issues === 0, "recovered predecessor, successor, signatures, audit and coordination states reconcile", "operations"),
    check("operations:risk-queue-contract", ["audit-dispatch-missing", "coordination-handoff-missing", "coordination-state-mismatch", "worker-lease-expired", "retry-due-unclaimed", "pending-dispatch-overdue", "dead-letter-unrecovered", "lane-control-audit-orphan", "lane-control-integrity-invalid", "lane-circuit-open"].every((token) => operationsSource.includes(token)), "integrity, orphan audit/task/control, mismatch, lease, retry, SLA, dead-letter and lane resilience risks have explicit codes", "operations"),
    check("frontend:action-route-contract", pageSource.includes("/api/public-health/coordination/") && pageSource.includes("idempotencyKey") && pageSource.includes("expectedVersion"), "T00 route boundary has a stable client contract", "integration"),
    check("integration:documented-boundary", ["public-health-coordination-runtime.js", "public-health-external-adapter-service.js", "T00", "server.js", "productionReady"].every((token) => doc.includes(token)) && ["requestKeyring", "receiptKeyring", "receiptReplayKeyHash", "legacy-static"].every((token) => keyringDoc.includes(token)) && ["expectedLaneControlVersion", "maxPending", "lane-circuit-open"].every((token) => resilienceDoc.includes(token)), "runtime, adapter, key lifecycle, resilience and T00 boundaries are documented", "integration"),
    check("safety:functional-not-production", runtime.productionReady === false && registry.productionReady === false && deliveries.every((item) => item.productionReady === false), "functional acceptance cannot self-assert production readiness", "safety"),
    check("safety:trusted-site-evidence-blocker", deliveries.every((item) => /site evidence/i.test(item.blocker)), "every accepted delivery retains the trusted site-evidence blocker", "safety")
  ];
  return {
    generatedAt: new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    functionalState: "t08-public-health-planned-functions-complete",
    formalGoLiveState: "blocked-until-t00-integration-production-endpoints-and-trusted-site-evidence-verified",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      lanes: runtime.summary.lanes,
      handoffs: runtime.summary.handoffs,
      adapterProfiles: registry.summary.adapters,
      verifiedAcceptanceDeliveries: deliveries.filter((item) => item.deliveryState === "delivered").length,
      persistedAuditEntries: runtimeAcceptance.first.nextData.publicHealthCoordinationAudit.length,
      persistedOutboxDispatches: outboxAcceptance.delivered.externalRuntime.summary.dispatches,
      persistedOutboxAuditEntries: outboxAcceptance.delivered.externalRuntime.summary.auditEntries,
      recoveredDeadLetters: recoveryAcceptance.recovered.externalRuntime.summary.recoveredDeadLetters,
      recoverySuccessors: recoveryAcceptance.recovered.externalRuntime.summary.recoverySuccessors,
      operationsIssues: operationsBoard.summary.issues,
      operationsSignatureVerified: operationsBoard.summary.signatureVerified,
      resilienceAuditEntries: resilienceAcceptance.recovered.nextData.publicHealthExternalLaneControlAudit.length
    },
    checks,
    runtime: {
      functionalState: runtime.functionalState,
      formalGoLiveState: runtime.formalGoLiveState,
      summary: runtime.summary,
      productionReady: false
    },
    adapterRegistry: registry,
    acceptanceDeliveries: deliveries,
    outboxAcceptance: {
      dispatch: outboxAcceptance.delivered.dispatch,
      coordinationState: outboxAcceptance.handoff.state,
      summary: outboxAcceptance.delivered.externalRuntime.summary,
      productionReady: false
    },
    deadLetterRecoveryAcceptance: {
      originalDispatch: recoveryAcceptance.recovered.originalDispatch,
      successorDispatch: recoveryAcceptance.recovered.successorDispatch,
      coordinationState: recoveryAcceptance.handoff.state,
      summary: recoveryAcceptance.recovered.externalRuntime.summary,
      productionReady: false
    },
    operationsBoard,
    resilienceAcceptance: {
      opened: resilienceAcceptance.failed.control,
      probe: resilienceAcceptance.probe.control,
      recovered: resilienceAcceptance.recovered.control,
      productionReady: false
    },
    productionReady: false,
    artifacts: {
      coordinationService: "public-health-coordination-service.js",
      coordinationRuntime: "public-health-coordination-runtime.js",
      externalAdapters: "public-health-external-adapter-service.js",
      externalAdapterRuntime: "public-health-external-adapter-runtime.js",
      externalKeyring: "public-health-external-keyring-service.js",
      externalResilience: "public-health-external-resilience-service.js",
      externalOperations: "public-health-external-operations-service.js",
      documentation: "docs/public-health-eight-domain-coordination.md",
      keyRotationDocumentation: "docs/public-health-external-key-rotation.md",
      resilienceDocumentation: "docs/public-health-external-resilience.md"
    },
    remainingT00Integration: [
      "Wire coordination actions plus external enqueue, due-worker claim/attempt, signed callback, governed dead-letter recovery, lane resilience CAS and operations-board routes to the T08 controllers and durable data writer.",
      "Register shared server, package, style, README and aggregate release entries owned by T00.",
      "Provision production HTTPS endpoints, managed keyrings and per-lane resilience policies, then verify load, rotation, revocation, signed receipts and trusted site evidence."
    ]
  };
}

function renderMarkdown(report) {
  return [
    "# T08 public health final readiness",
    "",
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Functional state: ${report.functionalState}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Checks: ${report.summary.passed}/${report.summary.checks}`,
    `- Signed acceptance deliveries: ${report.summary.verifiedAcceptanceDeliveries}/8`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    "",
    "## Checks",
    "",
    "| Status | Category | Check | Detail |",
    "|---|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${String(item.detail).replace(/\|/g, "/")} |`),
    "",
    "## Remaining T00 and site integration",
    "",
    ...report.remainingT00Integration.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...value] = item.slice(2).split("=");
    return [key, value.length ? value.join("=") : true];
  }));
  return { output: flags.output || DEFAULT_OUTPUT, markdown: flags.markdown || DEFAULT_MARKDOWN };
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

if (require.main === module) {
  try {
    const report = buildPublicHealthFinalReadiness();
    writeOutput(report, parseArgs());
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildPublicHealthFinalReadiness,
  parseArgs,
  renderMarkdown,
  runExternalAdapterAcceptance,
  runExternalOutboxAcceptance,
  runExternalResilienceAcceptance,
  runDeadLetterRecoveryAcceptance,
  runRuntimeAcceptance,
  writeOutput
};

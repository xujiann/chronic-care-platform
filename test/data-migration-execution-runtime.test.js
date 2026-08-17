"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  STATES,
  assessMigrationExecutionState,
  createMemoryMigrationExecutionRepository,
  createMigrationExecutionRuntime,
  validateMigrationExecutionProgram
} = require("../src/platform/data/migration-execution-runtime");
const {
  TRANSITIONS,
  advanceMigrationRun,
  createMigrationRun
} = require("../src/platform/data/migration-control-center");
const { parseArgs, readRecoveryState, writeReport } = require("../scripts/data-migration-execution-readiness");

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const T0 = "2026-08-17T04:00:00.000Z";
const T31 = "2026-08-17T04:00:31.000Z";

function plan(overrides = {}) {
  return {
    executionContext: "background-worker",
    batchId: "migration-batch-001",
    runId: "migration-run-001",
    waveId: "wave-identity-contract",
    sourceTransactionId: "sqlite-tx-001",
    sourceVersion: "snapshot-001",
    manifestDigest: DIGEST_A,
    sourceRange: { firstSequence: 1, lastSequence: 3, eventCount: 3 },
    plannedAt: T0,
    ...overrides
  };
}

function runtime(options = {}) {
  let lease = 0;
  return createMigrationExecutionRuntime({
    now: () => T0,
    newLeaseKey: () => `ephemeral-lease-${++lease}`,
    ...options
  });
}

function localControlRun(checkpointId = "checkpoint-003") {
  const base = (overrides = {}) => ({ evidenceRef: "evidence://migration/test", artifactDigest: DIGEST_A, completedAt: T0, ...overrides });
  let run = createMigrationRun({ runId: "migration-run-001", waveId: "wave-identity-contract" });
  run = advanceMigrationRun(run, TRANSITIONS.REHEARSAL_COMPLETED, base({ environment: "preproduction", sourceVersion: "snapshot-001", sourceCount: 3 }));
  run = advanceMigrationRun(run, TRANSITIONS.RECONCILIATION_PASSED, base({
    sourceCount: 3, targetCount: 3, mismatchCount: 0, duplicateCount: 0,
    sourceVersion: "snapshot-001", sourceDigest: DIGEST_A, targetDigest: DIGEST_A,
    outboxCheckpoint: checkpointId
  }));
  run = advanceMigrationRun(run, TRANSITIONS.ROLLBACK_VERIFIED, base({
    snapshotDigest: DIGEST_B, restoreDigest: DIGEST_B, rpoSeconds: 20, rtoSeconds: 300,
    approvals: [
      { role: "data-owner", evidenceRef: "approval://data-owner/test", digest: DIGEST_A },
      { role: "release-manager", evidenceRef: "approval://release-manager/test", digest: DIGEST_B }
    ]
  }));
  return advanceMigrationRun(run, TRANSITIONS.QUALITY_GATE_PASSED, base({
    completenessPct: 100, validityPct: 100, uniquenessPct: 100,
    freshnessLagSeconds: 5, criticalIssueCount: 0, unresolvedIssueCount: 0
  }));
}

function executeToCompletion(service) {
  service.plan(plan());
  const claimed = service.claim({ executionContext: "background-worker", batchId: "migration-batch-001", workerId: "worker-a", leaseSeconds: 60, now: T0 });
  service.recordCheckpoint({
    executionContext: "background-worker", batchId: "migration-batch-001",
    leaseKey: claimed.claim.leaseKey, leaseVersion: claimed.claim.leaseVersion,
    checkpointId: "checkpoint-003", sourceOutboxSequence: 3, appliedEventCount: 3,
    targetDigest: DIGEST_A, recordedAt: T0
  });
  return service.completeApply({
    executionContext: "background-worker", batchId: "migration-batch-001",
    leaseKey: claimed.claim.leaseKey, leaseVersion: claimed.claim.leaseVersion, completedAt: T0
  });
}

test("execution program fixes the outbox, checkpoint, reconciliation and fail-closed boundaries", () => {
  assert.equal(validateMigrationExecutionProgram(), true);
  const invalid = structuredClone(require("../config/data-migration-execution.json"));
  invalid.requestPathDualWrite = true;
  assert.throws(() => validateMigrationExecutionProgram(invalid), /prohibit request-path dual writes/);
  invalid.requestPathDualWrite = false;
  invalid.productionActivationAuthorized = true;
  assert.throws(() => validateMigrationExecutionProgram(invalid), /cannot authorize production/);
});

test("planning atomically commits metadata-only outbox evidence and is idempotent", () => {
  const service = runtime();
  const first = service.plan(plan());
  const replay = service.plan(plan());
  assert.equal(first.idempotentReplay, false);
  assert.equal(first.outboxEvent.commitState, "committed");
  assert.equal(first.outboxEvent.sequence, 1);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(service.exportRecoveryState().outboxEvents.length, 1);
  assert.throws(() => service.plan(plan({ manifestDigest: DIGEST_B })), (error) => error.code === "DATA_MIGRATION_EXECUTION_IDEMPOTENCY_CONFLICT");
  assert.equal(service.exportRecoveryState().batches.length, 1);
});

test("request-path execution and sensitive migration evidence are rejected", () => {
  const service = runtime();
  assert.throws(() => service.plan(plan({ executionContext: "request-path" })), (error) => error.code === "DATA_MIGRATION_REQUEST_PATH_WRITE_PROHIBITED");
  assert.throws(() => service.plan(plan({ patientPayload: "forbidden" })), (error) => error.code === "TECHNICAL_EVIDENCE_SENSITIVE_FIELD");
  assert.equal(service.exportRecoveryState().batches.length, 0);
});

test("leases are exclusive, stale workers are fenced and lease material is never persisted", () => {
  const service = runtime();
  service.plan(plan());
  const first = service.claim({ executionContext: "background-worker", batchId: "migration-batch-001", workerId: "worker-a", leaseSeconds: 30, now: T0 });
  assert.equal(first.batch.state, STATES.LEASED);
  assert.throws(() => service.claim({ executionContext: "background-worker", batchId: "migration-batch-001", workerId: "worker-b", leaseSeconds: 30, now: T0 }), (error) => error.code === "DATA_MIGRATION_EXECUTION_BATCH_BUSY");
  const persisted = JSON.stringify(service.exportRecoveryState());
  assert.doesNotMatch(persisted, /ephemeral-lease-1|worker-a/);
  assert.equal(service.exportRecoveryState().batches[0].leaseClaimDigest.startsWith("sha256:"), true);
});

test("crash recovery preserves a monotonic checkpoint and fences the expired lease", () => {
  const service = runtime();
  service.plan(plan());
  const first = service.claim({ executionContext: "background-worker", batchId: "migration-batch-001", workerId: "worker-a", leaseSeconds: 30, now: T0 });
  service.recordCheckpoint({ executionContext: "background-worker", batchId: "migration-batch-001", leaseKey: first.claim.leaseKey, leaseVersion: 1, checkpointId: "checkpoint-001", sourceOutboxSequence: 1, appliedEventCount: 1, targetDigest: DIGEST_A, recordedAt: T0 });
  const recovered = service.recoverExpiredLeases({ executionContext: "background-worker", now: T31 });
  assert.equal(recovered.recovered, 1);
  assert.equal(recovered.batches[0].checkpoint.checkpointId, "checkpoint-001");
  const second = service.claim({ executionContext: "background-worker", batchId: "migration-batch-001", workerId: "worker-b", leaseSeconds: 30, now: T31 });
  assert.equal(second.recoveredFromCheckpoint, true);
  assert.equal(second.claim.leaseVersion, 2);
  assert.throws(() => service.recordCheckpoint({ executionContext: "background-worker", batchId: "migration-batch-001", leaseKey: first.claim.leaseKey, leaseVersion: 1, checkpointId: "checkpoint-002", sourceOutboxSequence: 2, appliedEventCount: 2, targetDigest: DIGEST_A, recordedAt: T31 }), (error) => error.code === "DATA_MIGRATION_EXECUTION_STALE_LEASE");
  assert.throws(() => service.recordCheckpoint({ executionContext: "background-worker", batchId: "migration-batch-001", leaseKey: second.claim.leaseKey, leaseVersion: 2, checkpointId: "checkpoint-regression", sourceOutboxSequence: 1, appliedEventCount: 1, targetDigest: DIGEST_A, recordedAt: T31 }), (error) => error.code === "DATA_MIGRATION_EXECUTION_CHECKPOINT_REGRESSION");
  const final = service.recordCheckpoint({ executionContext: "background-worker", batchId: "migration-batch-001", leaseKey: second.claim.leaseKey, leaseVersion: 2, checkpointId: "checkpoint-003", sourceOutboxSequence: 3, appliedEventCount: 3, targetDigest: DIGEST_A, recordedAt: T31 });
  assert.equal(final.batch.checkpoint.sourceOutboxSequence, 3);
});

test("repeated crashes fail closed after the configured recovery limit", () => {
  const service = runtime();
  service.plan(plan());
  const times = [
    [T0, "2026-08-17T04:00:31.000Z"],
    ["2026-08-17T04:00:31.000Z", "2026-08-17T04:01:02.000Z"],
    ["2026-08-17T04:01:02.000Z", "2026-08-17T04:01:33.000Z"],
    ["2026-08-17T04:01:33.000Z", "2026-08-17T04:02:04.000Z"]
  ];
  for (const [claimedAt, expiredAt] of times) {
    service.claim({ executionContext: "background-worker", batchId: "migration-batch-001", workerId: `worker-${claimedAt}`, leaseSeconds: 30, now: claimedAt });
    service.recoverExpiredLeases({ executionContext: "background-worker", now: expiredAt });
  }
  const state = service.operations();
  assert.equal(state.summary.states[STATES.RECOVERY_EXHAUSTED], 1);
  assert.throws(() => service.claim({ executionContext: "background-worker", batchId: "migration-batch-001", workerId: "worker-final", leaseSeconds: 30, now: "2026-08-17T04:02:04.000Z" }), (error) => error.code === "DATA_MIGRATION_EXECUTION_NOT_CLAIMABLE");
});

test("completion requires the final checkpoint and reconciliation fails closed on drift", () => {
  const service = runtime();
  executeToCompletion(service);
  assert.throws(() => service.reconcile({
    executionContext: "background-worker", batchId: "migration-batch-001", evidenceRef: "evidence://reconcile/drift",
    sourceCount: 3, targetCount: 2, mismatchCount: 1, duplicateCount: 0,
    sourceDigest: DIGEST_A, targetDigest: DIGEST_B, checkpointId: "checkpoint-003", completedAt: T0
  }), (error) => error.code === "DATA_MIGRATION_EXECUTION_RECONCILIATION_FAILED");
  assert.equal(service.operations().summary.states[STATES.AWAITING_RECONCILIATION], 1);
});

test("only exact reconciliation bound to the control-center checkpoint yields a local candidate", () => {
  const service = runtime();
  executeToCompletion(service);
  const reconciled = service.reconcile({
    executionContext: "background-worker", batchId: "migration-batch-001", evidenceRef: "evidence://reconcile/exact",
    sourceCount: 3, targetCount: 3, mismatchCount: 0, duplicateCount: 0,
    sourceDigest: DIGEST_A, targetDigest: DIGEST_A, checkpointId: "checkpoint-003", completedAt: T0
  });
  assert.equal(reconciled.state, STATES.RECONCILED);
  const plannedControl = createMigrationRun({ runId: "migration-run-001", waveId: "wave-identity-contract" });
  assert.throws(() => service.qualifyLocalCandidate({ executionContext: "background-worker", batchId: "migration-batch-001", controlRun: plannedControl, qualifiedAt: T0 }), (error) => error.code === "DATA_MIGRATION_EXECUTION_CANDIDATE_GATE_BLOCKED");
  const candidate = service.qualifyLocalCandidate({ executionContext: "background-worker", batchId: "migration-batch-001", controlRun: localControlRun(), qualifiedAt: T0 });
  assert.equal(candidate.state, STATES.LOCAL_CANDIDATE);
  assert.equal(candidate.localCandidate, true);
  assert.equal(candidate.productionReady, false);
  assert.equal(candidate.productionPrimary, false);
  assert.equal(candidate.activationAuthorized, false);
});

test("readiness validates recovery metadata while keeping production closed", (t) => {
  const service = runtime();
  executeToCompletion(service);
  service.reconcile({ executionContext: "background-worker", batchId: "migration-batch-001", evidenceRef: "evidence://reconcile/exact", sourceCount: 3, targetCount: 3, mismatchCount: 0, duplicateCount: 0, sourceDigest: DIGEST_A, targetDigest: DIGEST_A, checkpointId: "checkpoint-003", completedAt: T0 });
  service.qualifyLocalCandidate({ executionContext: "background-worker", batchId: "migration-batch-001", controlRun: localControlRun(), qualifiedAt: T0 });
  const report = assessMigrationExecutionState(service.exportRecoveryState(), { now: T0 });
  assert.equal(report.ok, true);
  assert.equal(report.localGateReady, true);
  assert.equal(report.productionReady, false);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "migration-execution-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, "state.json");
  const output = path.join(directory, "report.json");
  fs.writeFileSync(input, JSON.stringify(service.exportRecoveryState()), "utf8");
  writeReport(assessMigrationExecutionState(readRecoveryState(input), { now: T0 }), output);
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).productionReady, false);
  assert.deepEqual(parseArgs([`--input=${input}`, `--output=${output}`, "--write"]), { input, output, write: true });
});

test("recovery state tampering cannot pass readiness", () => {
  const service = runtime();
  service.plan(plan());
  const state = service.exportRecoveryState();
  state.batches[0].productionReady = true;
  const report = assessMigrationExecutionState(state, { now: T0 });
  assert.equal(report.ok, false);
  assert.equal(report.localGateReady, false);
  assert.equal(report.productionReady, false);

  const forgedCandidate = service.exportRecoveryState();
  forgedCandidate.batches[0].state = STATES.LOCAL_CANDIDATE;
  assert.equal(assessMigrationExecutionState(forgedCandidate, { now: T0 }).ok, false);

  const forgedEvent = service.exportRecoveryState();
  forgedEvent.outboxEvents[0].detail.sourceRange.eventCount = 999;
  assert.equal(assessMigrationExecutionState(forgedEvent, { now: T0 }).ok, false);
});

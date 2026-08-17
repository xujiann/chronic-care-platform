"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  analyzeImpact,
  buildDataGovernanceControlPlane,
  validateDataGovernanceControlProgram
} = require("../src/platform/data/data-governance-control-plane");
const {
  TRANSITIONS,
  advanceMigrationRun,
  createMigrationRun
} = require("../src/platform/data/migration-control-center");
const { createMigrationExecutionRuntime } = require("../src/platform/data/migration-execution-runtime");
const { buildPlatformWorkItemCenter } = require("../src/platform/productization/work-item-center");
const { parseArgs, readInput, writeReport } = require("../scripts/data-governance-control-plane-readiness");

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const NOW = "2026-08-17T06:00:00.000Z";

function candidateRun(checkpointId = "checkpoint-003") {
  const evidence = (overrides = {}) => ({ evidenceRef: "evidence://data-governance/test", artifactDigest: DIGEST_A, completedAt: NOW, ...overrides });
  let run = createMigrationRun({ runId: "governance-run-001", waveId: "wave-identity-contract" });
  run = advanceMigrationRun(run, TRANSITIONS.REHEARSAL_COMPLETED, evidence({ environment: "preproduction", sourceVersion: "snapshot-001", sourceCount: 3 }));
  run = advanceMigrationRun(run, TRANSITIONS.RECONCILIATION_PASSED, evidence({
    sourceCount: 3, targetCount: 3, mismatchCount: 0, duplicateCount: 0,
    sourceVersion: "snapshot-001", sourceDigest: DIGEST_A, targetDigest: DIGEST_A,
    outboxCheckpoint: checkpointId
  }));
  run = advanceMigrationRun(run, TRANSITIONS.ROLLBACK_VERIFIED, evidence({
    snapshotDigest: DIGEST_B, restoreDigest: DIGEST_B, rpoSeconds: 30, rtoSeconds: 300,
    approvals: [
      { role: "data-owner", evidenceRef: "approval://data-owner/test", digest: DIGEST_A },
      { role: "release-manager", evidenceRef: "approval://release-manager/test", digest: DIGEST_B }
    ]
  }));
  return advanceMigrationRun(run, TRANSITIONS.QUALITY_GATE_PASSED, evidence({
    completenessPct: 100, validityPct: 100, uniquenessPct: 100,
    freshnessLagSeconds: 10, criticalIssueCount: 0, unresolvedIssueCount: 0
  }));
}

function candidateExecutionState() {
  let leaseIndex = 0;
  const runtime = createMigrationExecutionRuntime({ now: () => NOW, newLeaseKey: () => `governance-lease-${++leaseIndex}` });
  runtime.plan({
    executionContext: "background-worker", batchId: "governance-batch-001",
    runId: "governance-run-001", waveId: "wave-identity-contract",
    sourceTransactionId: "sqlite-transaction-001", sourceVersion: "snapshot-001",
    manifestDigest: DIGEST_A, sourceRange: { firstSequence: 1, lastSequence: 3, eventCount: 3 }, plannedAt: NOW
  });
  const claim = runtime.claim({ executionContext: "background-worker", batchId: "governance-batch-001", workerId: "governance-worker", leaseSeconds: 60, now: NOW });
  runtime.recordCheckpoint({
    executionContext: "background-worker", batchId: "governance-batch-001",
    leaseKey: claim.claim.leaseKey, leaseVersion: claim.claim.leaseVersion,
    checkpointId: "checkpoint-003", sourceOutboxSequence: 3, appliedEventCount: 3,
    targetDigest: DIGEST_A, recordedAt: NOW
  });
  runtime.completeApply({ executionContext: "background-worker", batchId: "governance-batch-001", leaseKey: claim.claim.leaseKey, leaseVersion: claim.claim.leaseVersion, completedAt: NOW });
  runtime.reconcile({
    executionContext: "background-worker", batchId: "governance-batch-001",
    evidenceRef: "evidence://data-governance/reconciliation", sourceCount: 3, targetCount: 3,
    mismatchCount: 0, duplicateCount: 0, sourceDigest: DIGEST_A, targetDigest: DIGEST_A,
    checkpointId: "checkpoint-003", completedAt: NOW
  });
  runtime.qualifyLocalCandidate({ executionContext: "background-worker", batchId: "governance-batch-001", controlRun: candidateRun(), qualifiedAt: NOW });
  return runtime.exportRecoveryState();
}

function reconciliationIssue(overrides = {}) {
  return {
    id: "reconciliation-issue-001",
    batchId: "governance-batch-001",
    runId: "governance-run-001",
    waveId: "wave-identity-contract",
    exceptionType: "digest-mismatch",
    severity: "critical",
    status: "open",
    detectedAt: NOW,
    evidenceRef: "evidence://data-governance/reconciliation-issue",
    evidenceDigest: DIGEST_A,
    ...overrides
  };
}

function qualityFinding(overrides = {}) {
  return {
    id: "quality-finding-001",
    ruleId: "migration-completeness",
    waveId: "wave-identity-contract",
    collection: "accounts",
    severity: "high",
    status: "open",
    observedValue: 98.5,
    detectedAt: NOW,
    evidenceRef: "evidence://data-governance/quality-finding",
    evidenceDigest: DIGEST_B,
    ...overrides
  };
}

test("control program contains six iterations, strong quality rules and an acyclic lineage topology", () => {
  assert.equal(validateDataGovernanceControlProgram(), true);
  const invalid = structuredClone(require("../config/data-governance-control-plane.json"));
  invalid.iterations.pop();
  assert.throws(() => validateDataGovernanceControlProgram(invalid), /exactly six/);
  const cycle = structuredClone(require("../config/data-governance-control-plane.json"));
  cycle.topology.edges.push({ from: "local-candidate", to: "sqlite-authoritative-store", control: "invalid-cycle" });
  assert.throws(() => validateDataGovernanceControlProgram(cycle), /acyclic/);
});

test("empty control plane is structurally ready while the local and production gates stay closed", () => {
  const report = buildDataGovernanceControlPlane({}, { now: NOW });
  assert.equal(report.ok, true);
  assert.equal(report.summary.iterations, 6);
  assert.equal(report.summary.lineageRecords, 12);
  assert.equal(report.localGateReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.productionPrimary, false);
  assert.equal(report.activationAuthorized, false);
  assert.equal(report.decision, "NO-GO");
});

test("matching execution, checkpoint, reconciliation, rollback and quality evidence yields only a local candidate", () => {
  const report = buildDataGovernanceControlPlane({ migrationRuns: [candidateRun()], executionState: candidateExecutionState() }, { now: NOW });
  assert.equal(report.ok, true);
  assert.equal(report.localGateReady, true);
  assert.equal(report.summary.candidateBindings, 1);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.productionReady, false);
  assert.equal(report.decision, "NO-GO");
});

test("candidate checkpoint drift and incomplete rollback approval fail closed", () => {
  const drifted = candidateExecutionState();
  drifted.batches[0].checkpoint.checkpointId = "checkpoint-other";
  const driftedReport = buildDataGovernanceControlPlane({ migrationRuns: [candidateRun()], executionState: drifted }, { now: NOW });
  assert.equal(driftedReport.ok, false);
  assert.equal(driftedReport.localGateReady, false);
  assert.equal(driftedReport.checks.find((item) => item.id === "dataGovernanceControl:migrationExecution").passed, false);

  const weakRollback = structuredClone(candidateRun());
  weakRollback.controls.rollback.approvals.pop();
  const report = buildDataGovernanceControlPlane({ migrationRuns: [weakRollback] }, { now: NOW });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "dataGovernanceControl:rollbackGate").passed, false);
  assert.equal(report.productionReady, false);
});

test("open reconciliation and quality issues become safe unified-center work items", () => {
  const report = buildDataGovernanceControlPlane({
    reconciliationExceptions: [reconciliationIssue()],
    qualityFindings: [qualityFinding()]
  }, { now: NOW });
  assert.equal(report.ok, false);
  assert.equal(report.summary.projectedWorkItems, 2);
  assert.equal(report.workItems.every((item) => item.status === "queued" && item.domain === "platform-governance"), true);
  assert.equal(report.workItems.every((item) => item.productionReady === false && item.payloadsExposed === false && item.credentialsExposed === false), true);
  const center = buildPlatformWorkItemCenter({ platformWorkItems: report.workItems }, { now: NOW });
  assert.equal(center.summary.total, 2);
  assert.equal(center.summary.open, 2);
  assert.equal(center.items.some((item) => item.label === "数据迁移对账异常"), true);
  assert.equal(center.items.some((item) => item.label === "数据质量治理问题"), true);
  assert.doesNotMatch(JSON.stringify(center), /governance-batch-001|observedValue|sourceDigest|targetDigest/);
});

test("resolved issues are observed and sensitive or raw message fields are rejected", () => {
  const report = buildDataGovernanceControlPlane({ reconciliationExceptions: [reconciliationIssue({ status: "resolved" })] }, { now: NOW });
  assert.equal(report.ok, true);
  assert.equal(report.workItems[0].status, "observed");
  assert.throws(() => buildDataGovernanceControlPlane({ qualityFindings: [qualityFinding({ patientPayload: "forbidden" })] }), (error) => error.code === "TECHNICAL_EVIDENCE_SENSITIVE_FIELD");
  assert.throws(() => buildDataGovernanceControlPlane({ reconciliationExceptions: [reconciliationIssue({ rawMessage: "forbidden" })] }), (error) => error.code === "DATA_GOVERNANCE_FIELD_NOT_ALLOWED");
});

test("impact analysis traverses downstream controls without carrying collection data", () => {
  const impact = analyzeImpact({
    changeId: "change-transactional-outbox-001",
    changedNodes: ["transactional-outbox"],
    waveId: "wave-identity-contract",
    collection: "accounts",
    requestedAt: NOW,
    evidenceRef: "evidence://data-governance/change",
    evidenceDigest: DIGEST_A
  });
  assert.equal(impact.blocksLocalCandidate, true);
  assert.equal(impact.impactedNodes.includes("recoverable-checkpoint"), true);
  assert.equal(impact.impactedNodes.includes("local-candidate"), true);
  assert.equal(impact.impactedControls.includes("background-lease"), true);
  assert.match(impact.impactDigest, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => analyzeImpact({
    changeId: "change-unknown-node-001", changedNodes: ["unknown-node"],
    waveId: "wave-identity-contract", collection: "accounts", requestedAt: NOW,
    evidenceRef: "evidence://data-governance/change", evidenceDigest: DIGEST_A
  }), /known changed nodes/);
});

test("quality findings must bind to a configured rule, severity, wave and collection", () => {
  assert.throws(() => buildDataGovernanceControlPlane({ qualityFindings: [qualityFinding({ ruleId: "unknown-rule" })] }), (error) => error.code === "DATA_GOVERNANCE_QUALITY_RULE_UNKNOWN");
  assert.throws(() => buildDataGovernanceControlPlane({ qualityFindings: [qualityFinding({ severity: "low" })] }), (error) => error.code === "DATA_GOVERNANCE_QUALITY_FINDING_INVALID");
  assert.throws(() => buildDataGovernanceControlPlane({ qualityFindings: [qualityFinding({ collection: "referralSystem" })] }), (error) => error.code === "DATA_GOVERNANCE_LINEAGE_COLLECTION_INVALID");
  assert.throws(() => buildDataGovernanceControlPlane({ qualityFindings: [qualityFinding({ observedValue: 100 })] }), (error) => error.code === "DATA_GOVERNANCE_QUALITY_FINDING_NOT_VIOLATED");
  assert.throws(() => buildDataGovernanceControlPlane({ qualityFindings: [qualityFinding({ dueAt: "2026-08-18T06:00:00.000Z" })] }), (error) => error.code === "DATA_GOVERNANCE_SLA_INVALID");
  assert.throws(() => buildDataGovernanceControlPlane({ qualityFindings: [qualityFinding(), qualityFinding()] }), (error) => error.code === "DATA_GOVERNANCE_ISSUE_DUPLICATED");
});

test("readiness helpers persist a metadata-only NO-GO report", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "data-governance-control-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, "input.json");
  const output = path.join(directory, "report.json");
  fs.writeFileSync(input, JSON.stringify({ changes: [{
    changeId: "change-quality-rule-001", changedNodes: ["quality-rule-gate"],
    waveId: "wave-identity-contract", collection: "accounts", requestedAt: NOW,
    evidenceRef: "evidence://data-governance/change", evidenceDigest: DIGEST_A
  }] }), "utf8");
  const report = buildDataGovernanceControlPlane(readInput(input), { now: NOW });
  writeReport(report, output);
  const persisted = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(persisted.ok, true);
  assert.equal(persisted.productionReady, false);
  assert.equal(persisted.decision, "NO-GO");
  assert.deepEqual(parseArgs([`--input=${input}`, `--output=${output}`, "--write"]), { input, output, write: true });
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  STATES,
  TRANSITIONS,
  advanceMigrationRun,
  buildDataMigrationControlCenter,
  createMigrationRun,
  validateDataMigrationProgram
} = require("../src/platform/data/migration-control-center");
const { parseArgs, readRuns, writeReport } = require("../scripts/data-migration-readiness");

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const AT = "2026-08-17T03:00:00.000Z";

function baseEvidence(overrides = {}) {
  return { evidenceRef: "evidence://controlled/rehearsal-1", artifactDigest: DIGEST_A, completedAt: AT, ...overrides };
}

function advanceToLocalCandidate() {
  let run = createMigrationRun({ runId: "migration-wave-001", waveId: "wave-identity-contract" });
  run = advanceMigrationRun(run, TRANSITIONS.REHEARSAL_COMPLETED, baseEvidence({ environment: "preproduction", sourceVersion: "snapshot-42", sourceCount: 100 }));
  run = advanceMigrationRun(run, TRANSITIONS.RECONCILIATION_PASSED, baseEvidence({
    evidenceRef: "evidence://controlled/reconciliation-1",
    sourceCount: 100,
    targetCount: 100,
    mismatchCount: 0,
    duplicateCount: 0,
    sourceVersion: "snapshot-42",
    sourceDigest: DIGEST_A,
    targetDigest: DIGEST_A,
    outboxCheckpoint: "outbox-000042"
  }));
  run = advanceMigrationRun(run, TRANSITIONS.ROLLBACK_VERIFIED, baseEvidence({
    evidenceRef: "evidence://controlled/rollback-1",
    snapshotDigest: DIGEST_B,
    restoreDigest: DIGEST_B,
    rpoSeconds: 30,
    rtoSeconds: 420,
    approvals: [
      { role: "data-owner", evidenceRef: "approval://data-owner/42", digest: DIGEST_A },
      { role: "release-manager", evidenceRef: "approval://release-manager/42", digest: DIGEST_B }
    ]
  }));
  return advanceMigrationRun(run, TRANSITIONS.QUALITY_GATE_PASSED, baseEvidence({
    evidenceRef: "evidence://controlled/quality-1",
    completenessPct: 99.8,
    validityPct: 99.5,
    uniquenessPct: 100,
    freshnessLagSeconds: 60,
    criticalIssueCount: 0,
    unresolvedIssueCount: 0
  }));
}

test("migration control advances through rehearsal, reconciliation, rollback and quality gates", () => {
  const run = advanceToLocalCandidate();
  assert.equal(run.state, STATES.LOCAL_CANDIDATE);
  assert.equal(run.history.length, 4);
  assert.equal(run.controls.reconciliation.sourceCount, 100);
  assert.equal(run.controls.rollback.rtoSeconds, 420);
  assert.equal(run.controls.quality.completenessPct, 99.8);
  assert.match(run.history[0].evidenceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(run.productionReady, false);
  assert.equal(run.productionPrimary, false);
  assert.equal(run.cutoverAuthorized, false);
});

test("migration control rejects skipped or repeated transitions", () => {
  const run = createMigrationRun({ runId: "migration-wave-002", waveId: "wave-integration-channel" });
  assert.throws(() => advanceMigrationRun(run, TRANSITIONS.RECONCILIATION_PASSED, baseEvidence()), (error) => error.code === "DATA_MIGRATION_TRANSITION_INVALID");
  const rehearsed = advanceMigrationRun(run, TRANSITIONS.REHEARSAL_COMPLETED, baseEvidence({ environment: "staging", sourceVersion: "v2", sourceCount: 2 }));
  assert.throws(() => advanceMigrationRun(rehearsed, TRANSITIONS.REHEARSAL_COMPLETED, baseEvidence({ environment: "staging", sourceVersion: "v2", sourceCount: 2 })), (error) => error.code === "DATA_MIGRATION_TRANSITION_INVALID");
});

test("migration rehearsal rejects production and sensitive evidence fields", () => {
  const run = createMigrationRun({ runId: "migration-wave-003", waveId: "wave-public-health-referral" });
  assert.throws(() => advanceMigrationRun(run, TRANSITIONS.REHEARSAL_COMPLETED, baseEvidence({ environment: "production", sourceVersion: "v3", sourceCount: 10 })), (error) => error.code === "DATA_MIGRATION_REHEARSAL_ENVIRONMENT_BLOCKED");
  assert.throws(() => advanceMigrationRun(run, TRANSITIONS.REHEARSAL_COMPLETED, baseEvidence({ environment: "test", sourceVersion: "v3", sourceCount: 10, patientPayload: "forbidden" })), (error) => error.code === "TECHNICAL_EVIDENCE_SENSITIVE_FIELD");
});

test("reconciliation fails closed on count, digest, mismatch or duplicate drift", () => {
  let run = createMigrationRun({ runId: "migration-wave-004", waveId: "wave-identity-contract" });
  run = advanceMigrationRun(run, TRANSITIONS.REHEARSAL_COMPLETED, baseEvidence({ environment: "test", sourceVersion: "v4", sourceCount: 10 }));
  const evidence = baseEvidence({
    sourceCount: 10,
    targetCount: 9,
    mismatchCount: 1,
    duplicateCount: 1,
    sourceVersion: "v4",
    sourceDigest: DIGEST_A,
    targetDigest: DIGEST_B,
    outboxCheckpoint: "outbox-4"
  });
  assert.throws(() => advanceMigrationRun(run, TRANSITIONS.RECONCILIATION_PASSED, evidence), (error) => error.code === "DATA_MIGRATION_RECONCILIATION_FAILED");
  assert.equal(run.state, STATES.REHEARSED);
});

test("rollback requires matching restoration digest, objectives and independent roles", () => {
  let run = createMigrationRun({ runId: "migration-wave-005", waveId: "wave-identity-contract" });
  run = advanceMigrationRun(run, TRANSITIONS.REHEARSAL_COMPLETED, baseEvidence({ environment: "test", sourceVersion: "v5", sourceCount: 10 }));
  run = advanceMigrationRun(run, TRANSITIONS.RECONCILIATION_PASSED, baseEvidence({ sourceCount: 10, targetCount: 10, mismatchCount: 0, duplicateCount: 0, sourceVersion: "v5", sourceDigest: DIGEST_A, targetDigest: DIGEST_A, outboxCheckpoint: "outbox-5" }));
  assert.throws(() => advanceMigrationRun(run, TRANSITIONS.ROLLBACK_VERIFIED, baseEvidence({
    snapshotDigest: DIGEST_A,
    restoreDigest: DIGEST_B,
    rpoSeconds: 301,
    rtoSeconds: 1801,
    approvals: [
      { role: "data-owner", evidenceRef: "approval://one", digest: DIGEST_A },
      { role: "data-owner", evidenceRef: "approval://two", digest: DIGEST_B }
    ]
  })), (error) => error.code === "DATA_MIGRATION_ROLLBACK_GATE_FAILED");
});

test("quality gate blocks threshold regression and leaves production closed", () => {
  let run = advanceToLocalCandidate();
  assert.equal(buildDataMigrationControlCenter([run], { now: AT }).localGateReady, true);
  assert.equal(buildDataMigrationControlCenter([run], { now: AT }).productionReady, false);

  run = { ...run, state: STATES.ROLLBACK_VERIFIED, history: run.history.slice(0, 3) };
  assert.throws(() => advanceMigrationRun(run, TRANSITIONS.QUALITY_GATE_PASSED, baseEvidence({ completenessPct: 99.4, validityPct: 99.5, uniquenessPct: 100, freshnessLagSeconds: 60, criticalIssueCount: 0, unresolvedIssueCount: 0 })), (error) => error.code === "DATA_MIGRATION_QUALITY_GATE_FAILED");
  assert.throws(() => advanceMigrationRun(run, TRANSITIONS.QUALITY_GATE_PASSED, baseEvidence({ completenessPct: 101, validityPct: 99.5, uniquenessPct: 100, freshnessLagSeconds: 60, criticalIssueCount: 0, unresolvedIssueCount: 0 })), (error) => error.code === "DATA_MIGRATION_QUALITY_METRIC_INVALID");
});

test("readiness rejects a forged local candidate without a complete evidence history", () => {
  const planned = createMigrationRun({ runId: "migration-wave-006", waveId: "wave-identity-contract" });
  const forged = { ...planned, state: STATES.LOCAL_CANDIDATE };
  const report = buildDataMigrationControlCenter([forged], { now: AT });
  assert.equal(report.ok, false);
  assert.equal(report.localGateReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.find((item) => item.id === "dataMigration:runIntegrity").passed, false);
});

test("program validation rejects dual writes and incomplete P0 coverage", () => {
  const program = structuredClone(require("../config/data-migration-program.json"));
  program.requestPathDualWrite = true;
  assert.throws(() => validateDataMigrationProgram(program), /without request-path dual writes/);
  const incomplete = structuredClone(require("../config/data-migration-program.json"));
  incomplete.waves[0].collections.pop();
  assert.throws(() => validateDataMigrationProgram(incomplete), /cover every promoted P0 collection/);
});

test("readiness CLI helpers emit a metadata-only, fail-closed report", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "data-migration-control-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, "runs.json");
  const output = path.join(directory, "report.json");
  fs.writeFileSync(input, JSON.stringify({ runs: [advanceToLocalCandidate()] }), "utf8");
  const runs = readRuns(input);
  const report = buildDataMigrationControlCenter(runs, { now: AT });
  writeReport(report, output);
  const persisted = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(persisted.ok, true);
  assert.equal(persisted.localGateReady, true);
  assert.equal(persisted.productionReady, false);
  assert.deepEqual(parseArgs([`--input=${input}`, `--output=${output}`, "--write"]), { input, output, write: true });
});

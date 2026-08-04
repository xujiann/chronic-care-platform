"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateOperationalControlPlane,
  loadOperationalControls
} = require("../src/platform/governance/operational-control-plane");

const NOW = "2030-08-04T12:00:00.000Z";

function localSnapshot(config) {
  return {
    security: {
      roleBindings: config.security.requiredRoles.map((role) => ({
        role, reviewed: true, excessPrivileges: 0
      })),
      auditRepository: { healthy: true, appendOnly: true },
      keyAgeDays: 30,
      openCriticalFindings: 0
    },
    monitoring: {
      signals: config.monitoring.requiredSignals.map((id) => ({ id, healthy: true, ageSeconds: 30 })),
      drills: config.monitoring.requiredDrillScenarios.map((id) => ({
        id, passed: true, receiptRef: `evidence://monitoring/${id}`
      })),
      onCallOwner: "on-call-team-a",
      escalationPolicyRef: "cmdb://on-call/escalation-a"
    },
    dataGovernance: {
      generatedAt: "2030-08-04T11:30:00.000Z",
      checks: config.dataGovernance.requiredChecks.map((id) => ({
        id, passed: true, reportDigest: `sha256:${"a".repeat(64)}`
      })),
      auditRetentionDays: 365,
      exports: { metadataOnly: true, patientDataIncluded: false, secretsIncluded: false }
    }
  };
}

function externalEvidence(config) {
  const ids = [
    ...config.security.externalGates,
    ...config.monitoring.externalGates,
    ...config.dataGovernance.externalGates
  ];
  return ids.map((id, index) => ({
    id,
    status: "accepted",
    evidenceRef: `evidence://operations/${id}`,
    evidenceDigest: `sha256:${((index % 9) + 1).toString().repeat(64)}`
  }));
}

test("complete local controls remain blocked while external operational evidence is absent", () => {
  const config = loadOperationalControls();
  const report = evaluateOperationalControlPlane({
    config,
    snapshot: localSnapshot(config),
    now: NOW
  });
  assert.equal(report.localReady, true);
  assert.equal(report.externalReady, false);
  assert.equal(report.operationalReady, false);
  assert.equal(report.productionReady, false);
});

test("controlled external references can satisfy the operational report without exposing contents", () => {
  const config = loadOperationalControls();
  const report = evaluateOperationalControlPlane({
    config,
    snapshot: localSnapshot(config),
    externalEvidence: externalEvidence(config),
    now: NOW
  });
  assert.equal(report.operationalReady, true);
  assert.equal(report.externalEvidenceInferred, false);
  assert.equal(report.sensitiveDataExposed, false);
  assert.doesNotMatch(JSON.stringify(report), /on-call-team-a|reportDigest/);
});

test("operational snapshots reject patient and secret-bearing fields", () => {
  const config = loadOperationalControls();
  const snapshot = localSnapshot(config);
  snapshot.security.password = "must-not-enter-evidence";
  assert.throws(
    () => evaluateOperationalControlPlane({ config, snapshot, now: NOW }),
    (error) => error.code === "OPERATIONAL_CONTROL_SENSITIVE_FIELD"
  );
});

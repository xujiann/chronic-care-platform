const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CUTOVER_EVIDENCE_REQUIREMENTS,
  REQUIRED_APPROVAL_ROLES,
  approveCutover,
  completeProductionCutover,
  createCutoverEvidencePack,
  evaluateProductionCutover,
  recordCutoverEvidence,
  rollbackProductionCutover,
  startProductionCutover,
  verifyCutoverEvidence
} = require("../digital-hospital-cutover-governance");
const {
  createExecutionState,
  evaluateCutoverWindow,
  sha256
} = require("../digital-hospital-integration-execution");

function readyState() {
  return createExecutionState({
    environments: [{ id: "ENV-PROD", status: "healthy" }],
    vaultEntries: [{
      id: "VAULT-001",
      connectorId: "CONN-001",
      environmentId: "ENV-PROD",
      status: "active"
    }],
    jobs: [{
      id: "JOB-001",
      connectorId: "CONN-001",
      environmentId: "ENV-PROD",
      jobType: "full-chain",
      status: "succeeded",
      payloadDigest: "a".repeat(64)
    }],
    cutoverWindows: [{
      id: "CUT-001",
      environmentId: "ENV-PROD",
      connectorIds: ["CONN-001"],
      integrationApproved: true,
      rollbackPlan: "Restore previous route and reconcile queued messages.",
      status: "blocked"
    }]
  });
}

function completeEvidenceAndApprovals(state, packId) {
  CUTOVER_EVIDENCE_REQUIREMENTS.forEach((requirement, index) => {
    const evidence = recordCutoverEvidence(state, packId, {
      requirementId: requirement.id,
      artifactName: `${requirement.id}.json`,
      artifactDigest: sha256(`${packId}:${requirement.id}`),
      sourceSystem: "pilot-evidence-vault",
      submittedBy: `submitter-${index}`,
      role: requirement.ownerRole,
      now: `2026-07-29T03:${String(index).padStart(2, "0")}:00.000Z`
    });
    verifyCutoverEvidence(state, packId, evidence.id, {
      verifiedBy: `reviewer-${index}`,
      verificationNote: "Digest, signer, timestamp and site scope independently verified.",
      role: requirement.ownerRole,
      now: `2026-07-29T04:${String(index).padStart(2, "0")}:00.000Z`
    });
  });
  REQUIRED_APPROVAL_ROLES.forEach((role, index) => {
    approveCutover(state, packId, {
      role,
      approver: `approver-${index}`,
      decision: "approve",
      note: "All production gate evidence has been reviewed.",
      now: `2026-07-29T05:${String(index).padStart(2, "0")}:00.000Z`
    });
  });
}

test("cutover evidence requires digest-only records and independent verification", () => {
  const state = readyState();
  const pack = createCutoverEvidencePack(state, {
    id: "PACK-001",
    windowId: "CUT-001",
    institutionId: "H001",
    releaseVersion: "v0.18",
    createdBy: "release-manager"
  });
  assert.throws(() => recordCutoverEvidence(state, pack.id, {
    requirementId: "joint-test-success",
    artifactName: "joint-test.json",
    artifactDigest: "b".repeat(64),
    sourceSystem: "evidence-vault",
    submittedBy: "integration-owner",
    payload: { raw: true }
  }), /cannot be persisted/);
  const evidence = recordCutoverEvidence(state, pack.id, {
    requirementId: "joint-test-success",
    artifactName: "joint-test.json",
    artifactDigest: "b".repeat(64),
    sourceSystem: "evidence-vault",
    submittedBy: "integration-owner"
  });
  assert.throws(() => verifyCutoverEvidence(state, pack.id, evidence.id, {
    verifiedBy: "integration-owner",
    verificationNote: "Self review is not acceptable."
  }), /independent verifier/);
  const verified = verifyCutoverEvidence(state, pack.id, evidence.id, {
    verifiedBy: "independent-reviewer",
    verificationNote: "Joint-test digest and signer were independently verified."
  });
  assert.equal(verified.status, "verified");
});

test("Go decision requires all evidence approvals clean runtime security and a ready window", () => {
  const state = readyState();
  evaluateCutoverWindow(state, "CUT-001", "2026-07-29T03:00:00.000Z");
  const pack = createCutoverEvidencePack(state, {
    id: "PACK-GO",
    windowId: "CUT-001",
    institutionId: "H001",
    releaseVersion: "v0.18",
    createdBy: "release-manager"
  });
  completeEvidenceAndApprovals(state, pack.id);
  const result = evaluateProductionCutover(state, pack.id, {
    now: "2026-07-29T06:00:00.000Z",
    actor: "release-committee",
    security: { productionReady: true },
    repository: { durableLeases: true, atomicClaims: true }
  });
  assert.equal(result.pack.decision, "GO");
  assert.equal(result.evidence.verified, CUTOVER_EVIDENCE_REQUIREMENTS.length);
  assert.equal(result.approvals.approved, REQUIRED_APPROVAL_ROLES.length);
  assert.equal(Object.values(result.checks).every(Boolean), true);

  const running = startProductionCutover(state, pack.id, {
    actor: "operations-command",
    role: "operations-owner",
    changeTicket: "CHG-20260729-001"
  });
  assert.equal(running.status, "running");
  const completed = completeProductionCutover(state, pack.id, {
    actor: "operations-command",
    role: "operations-owner",
    receiptDigest: "c".repeat(64)
  });
  assert.equal(completed.status, "completed");
  const rolledBack = rollbackProductionCutover(state, pack.id, {
    actor: "operations-command",
    role: "operations-owner",
    reason: "Post-cutover reconciliation exceeded the agreed threshold."
  });
  assert.equal(rolledBack.status, "rolled-back");
  assert.equal(rolledBack.decision, "NO-GO");
});

test("cutover remains NO-GO when external security dependencies are not configured", () => {
  const state = readyState();
  evaluateCutoverWindow(state, "CUT-001");
  const pack = createCutoverEvidencePack(state, {
    id: "PACK-BLOCKED",
    windowId: "CUT-001",
    institutionId: "H001",
    releaseVersion: "v0.18",
    createdBy: "release-manager"
  });
  completeEvidenceAndApprovals(state, pack.id);
  const result = evaluateProductionCutover(state, pack.id, {
    security: { productionReady: false },
    repository: { durableLeases: true, atomicClaims: true }
  });
  assert.equal(result.pack.decision, "NO-GO");
  assert.equal(result.checks.securityAdapterReady, false);
  assert.throws(
    () => startProductionCutover(state, pack.id, { actor: "operations-command" }),
    /requires a current GO/
  );
});

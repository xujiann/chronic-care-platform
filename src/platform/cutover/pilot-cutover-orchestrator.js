"use strict";

const { createHash } = require("node:crypto");
const {
  assertMetadataOnly,
  createTechnicalEvidenceFingerprint
} = require("../governance/technical-evidence");

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const CONTROLLED_REFERENCE = /^(?:vault|evidence|artifact|cmdb|ticket):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const APPROVAL_ROLES = Object.freeze([
  "platform-operations",
  "security-compliance",
  "data-platform",
  "project-owner"
]);
const EVIDENCE_DIGEST_IDS = Object.freeze([
  "adapterRuntime",
  "reconciliation",
  "jointTests",
  "businessLoop",
  "operations",
  "externalReleaseEvidence",
  "rollback",
  "disasterRecovery"
]);

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function createPilotCutoverEvidenceFingerprint(input = {}) {
  const release = Object.freeze({
    releaseId: clean(input.release?.releaseId, 160),
    sourceCommit: clean(input.release?.sourceCommit, 40),
    artifactDigest: clean(input.release?.artifactDigest, 80)
  });
  const evidenceDigests = Object.fromEntries(EVIDENCE_DIGEST_IDS.map((id) => [
    id,
    clean(input.evidenceDigests?.[id], 80)
  ]));
  return sha256({ release, evidenceDigests });
}

function createRollbackEvidenceFingerprint(input = {}) {
  return createTechnicalEvidenceFingerprint(
    "pilot-cutover-rollback-evidence-v1",
    input
  );
}

function createDisasterRecoveryEvidenceFingerprint(input = {}) {
  return createTechnicalEvidenceFingerprint(
    "pilot-cutover-disaster-recovery-evidence-v1",
    input
  );
}

function createPilotCutoverEvidenceBindings(input = {}) {
  const adapter = input.reports?.adapterRuntime || {};
  const jointTests = input.reports?.jointTests || {};
  const businessLoop = input.reports?.businessLoop || {};
  const operations = input.reports?.operations || {};
  return Object.freeze({
    adapterRuntime: createTechnicalEvidenceFingerprint(
      "platform-production-adapter-runtime-v1",
      {
        schema: adapter.schema,
        mode: adapter.mode,
        adapters: adapter.adapters,
        schemas: adapter.schemas,
        localChecks: adapter.localChecks,
        externalAuthorization: adapter.externalAuthorization,
        workersEligible: adapter.workersEligible
      }
    ),
    reconciliation: clean(input.reports?.reconciliation?.technicalEvidenceFingerprint, 80),
    jointTests: createTechnicalEvidenceFingerprint(
      "regional-joint-test-evidence-v1",
      {
        schema: jointTests.schema,
        registryDigest: jointTests.registryDigest,
        contracts: jointTests.contracts,
        externalEvidenceVerified: jointTests.externalEvidenceVerified,
        evidenceInferred: jointTests.evidenceInferred
      }
    ),
    businessLoop: createTechnicalEvidenceFingerprint(
      "regional-business-loop-report-v1",
      {
        schema: businessLoop.schema,
        ok: businessLoop.ok,
        loopId: businessLoop.loopId,
        phase: businessLoop.phase,
        version: businessLoop.version,
        checks: businessLoop.checks,
        eventChainDigest: businessLoop.eventChainDigest
      }
    ),
    operations: createTechnicalEvidenceFingerprint(
      "platform-operational-control-report-v1",
      {
        schema: operations.schema,
        domains: operations.domains,
        localReady: operations.localReady,
        externalReady: operations.externalReady,
        operationalReady: operations.operationalReady,
        externalEvidenceInferred: operations.externalEvidenceInferred,
        sensitiveDataExposed: operations.sensitiveDataExposed
      }
    ),
    externalReleaseEvidence: clean(input.reports?.externalReleaseEvidence?.evidenceFingerprint, 80),
    rollback: createRollbackEvidenceFingerprint(input.rollback),
    disasterRecovery: createDisasterRecoveryEvidenceFingerprint(input.disasterRecovery)
  });
}

function validateRollback(input = {}) {
  const required = ["freeze-writes", "restore-database", "restore-runtime", "verify-recovery"];
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const passed = new Set(steps.filter((item) =>
    item?.tested === true
    && CONTROLLED_REFERENCE.test(clean(item?.procedureRef, 240))
    && SHA256.test(clean(item?.testDigest, 80)))
    .map((item) => clean(item.id, 120)));
  const checks = Object.freeze({
    owner: Boolean(clean(input.owner, 160)),
    window: Number(input.maximumMinutes) > 0 && Number(input.maximumMinutes) <= 120,
    steps: required.every((id) => passed.has(id)),
    immutableSnapshot: SHA256.test(clean(input.snapshotDigest, 80))
      && CONTROLLED_REFERENCE.test(clean(input.snapshotRef, 240))
  });
  return Object.freeze({ ok: Object.values(checks).every(Boolean), checks });
}

function validateDisasterRecovery(input = {}) {
  const rpoTarget = Number(input.rpoTargetMinutes);
  const rtoTarget = Number(input.rtoTargetMinutes);
  const rpoActual = Number(input.rpoActualMinutes);
  const rtoActual = Number(input.rtoActualMinutes);
  const checks = Object.freeze({
    objective: rpoTarget > 0 && rtoTarget > 0
      && rpoActual >= 0 && rtoActual >= 0
      && rpoActual <= rpoTarget && rtoActual <= rtoTarget,
    rehearsal: input.passed === true,
    receipt: CONTROLLED_REFERENCE.test(clean(input.receiptRef, 240))
      && SHA256.test(clean(input.receiptDigest, 80)),
    independentVerifier: Boolean(clean(input.verifierAccount, 160))
      && clean(input.verifierAccount, 160) !== clean(input.executionAccount, 160)
  });
  return Object.freeze({ ok: Object.values(checks).every(Boolean), checks });
}

function validateApprovals(input = {}, fingerprint, now) {
  const approvals = Array.isArray(input.approvals) ? input.approvals : [];
  const accounts = approvals.map((item) => clean(item.account, 160)).filter(Boolean);
  const acceptedRoles = new Set(approvals.filter((item) =>
    item?.status === "approved"
    && CONTROLLED_REFERENCE.test(clean(item.evidenceRef, 240))
    && SHA256.test(clean(item.evidenceDigest, 80)))
    .map((item) => clean(item.role, 80)));
  const approvedAt = Date.parse(input.approvedAt || "");
  const expiresAt = Date.parse(input.expiresAt || "");
  const current = Date.parse(now);
  const checks = Object.freeze({
    roles: APPROVAL_ROLES.every((role) => acceptedRoles.has(role)),
    independentAccounts: accounts.length === APPROVAL_ROLES.length
      && new Set(accounts).size === APPROVAL_ROLES.length,
    currentWindow: Number.isFinite(approvedAt)
      && Number.isFinite(expiresAt)
      && approvedAt <= current
      && expiresAt > current,
    fingerprint: clean(input.evidenceFingerprint, 80) === fingerprint,
    decision: input.decision === "GO"
      && input.confirmation === "APPROVE PILOT CUTOVER",
    rollbackOwner: Boolean(clean(input.rollbackOwner, 160))
  });
  return Object.freeze({ ok: Object.values(checks).every(Boolean), checks });
}

function evaluatePilotCutover(input = {}, now = new Date().toISOString()) {
  assertMetadataOnly(input, "cutover");
  const fingerprint = createPilotCutoverEvidenceFingerprint(input);
  const evidenceBindings = createPilotCutoverEvidenceBindings(input);
  const evidenceDigestChecks = Object.freeze(Object.fromEntries(EVIDENCE_DIGEST_IDS.map((id) => [
    id,
    SHA256.test(clean(input.evidenceDigests?.[id], 80))
      && SHA256.test(evidenceBindings[id])
      && clean(input.evidenceDigests?.[id], 80) === evidenceBindings[id]
  ])));
  const release = Object.freeze({
    releaseId: Boolean(clean(input.release?.releaseId, 160)),
    sourceCommit: COMMIT.test(clean(input.release?.sourceCommit, 40)),
    artifactDigest: SHA256.test(clean(input.release?.artifactDigest, 80))
  });
  const local = Object.freeze({
    adapterRuntime: input.reports?.adapterRuntime?.schema === "platform-production-adapter-runtime-v1"
      && clean(input.reports?.adapterRuntime?.technicalEvidenceFingerprint, 80)
        === evidenceBindings.adapterRuntime
      && input.reports?.adapterRuntime?.localChecks?.schemaVerified === true
      && input.reports?.adapterRuntime?.localChecks?.adaptersConfigured === true
      && input.reports?.adapterRuntime?.localChecks?.adapterWritesEvidenceGated === true,
    reconciliation: input.reports?.reconciliation?.schema === "shadow-relay-control-plane-v1"
      && input.reports?.reconciliation?.ok === true
      && input.reports?.reconciliation?.domains?.referral?.ok === true
      && input.reports?.reconciliation?.domains?.emergency?.ok === true
      && input.reports?.reconciliation?.durableCheckpointVerified === true
      && input.reports?.reconciliation?.faultRecoveryVerified === true
      && input.reports?.reconciliation?.chainValid === true
      && SHA256.test(clean(input.reports?.reconciliation?.technicalEvidenceFingerprint, 80))
      && input.reports?.reconciliation?.payloadsExposed === false
      && input.reports?.reconciliation?.externalEvidenceVerified === false
      && input.reports?.reconciliation?.productionReady === false,
    businessLoop: input.reports?.businessLoop?.schema === "regional-business-loop-report-v1"
      && clean(input.reports?.businessLoop?.technicalEvidenceFingerprint, 80)
        === evidenceBindings.businessLoop
      && input.reports?.businessLoop?.ok === true,
    operations: input.reports?.operations?.schema === "platform-operational-control-report-v1"
      && clean(input.reports?.operations?.technicalEvidenceFingerprint, 80)
        === evidenceBindings.operations
      && input.reports?.operations?.localReady === true
  });
  const external = Object.freeze({
    jointTests: input.reports?.jointTests?.schema === "regional-joint-test-evidence-v1"
      && clean(input.reports?.jointTests?.technicalEvidenceFingerprint, 80)
        === evidenceBindings.jointTests
      && input.reports?.jointTests?.externalEvidenceVerified === true,
    operations: input.reports?.operations?.externalReady === true,
    releaseEvidence: input.reports?.externalReleaseEvidence?.ok === true
      && SHA256.test(clean(input.reports?.externalReleaseEvidence?.evidenceFingerprint, 80))
  });
  const rollback = validateRollback(input.rollback);
  const disasterRecovery = validateDisasterRecovery(input.disasterRecovery);
  const approvals = validateApprovals(input.authorization, fingerprint, now);
  const checks = Object.freeze({
    immutableRelease: Object.values(release).every(Boolean),
    evidenceDigests: Object.values(evidenceDigestChecks).every(Boolean),
    localGates: Object.values(local).every(Boolean),
    externalGates: Object.values(external).every(Boolean),
    rollback: rollback.ok,
    disasterRecovery: disasterRecovery.ok,
    approvals: approvals.ok
  });
  const goCandidate = Object.values(checks).every(Boolean);
  return Object.freeze({
    schema: "pilot-cutover-decision-v1",
    evaluatedAt: new Date(now).toISOString(),
    decision: goCandidate ? "GO-CANDIDATE" : "NO-GO",
    evidenceFingerprint: fingerprint,
    checks,
    details: Object.freeze({
      release,
      evidenceDigests: evidenceDigestChecks,
      evidenceBindings,
      local,
      external,
      rollback,
      disasterRecovery,
      approvals
    }),
    cutoverExecutionAuthorized: false,
    productionPrimary: false,
    productionReady: false,
    secretsExposed: false,
    patientDataExposed: false,
    boundary: "GO-CANDIDATE means the supplied evidence structure is internally consistent. A human cutover committee must still authorize and execute the pilot; this module never changes production state."
  });
}

module.exports = {
  APPROVAL_ROLES,
  EVIDENCE_DIGEST_IDS,
  createPilotCutoverEvidenceFingerprint,
  createPilotCutoverEvidenceBindings,
  createRollbackEvidenceFingerprint,
  createDisasterRecoveryEvidenceFingerprint,
  evaluatePilotCutover,
  validateApprovals,
  validateDisasterRecovery,
  validateRollback
};

"use strict";

const defaultProgram = require("../../../config/data-migration-program.json");
const promotionProgram = require("../../../config/p0-data-promotions.json");
const { validatePromotionProgram } = require("./promotion-contract");
const {
  SHA256,
  assertMetadataOnly,
  createTechnicalEvidenceFingerprint
} = require("../governance/technical-evidence");

const STATES = Object.freeze({
  PLANNED: "planned",
  REHEARSED: "rehearsed",
  RECONCILED: "reconciled",
  ROLLBACK_VERIFIED: "rollback-verified",
  LOCAL_CANDIDATE: "local-candidate"
});

const TRANSITIONS = Object.freeze({
  REHEARSAL_COMPLETED: "REHEARSAL_COMPLETED",
  RECONCILIATION_PASSED: "RECONCILIATION_PASSED",
  ROLLBACK_VERIFIED: "ROLLBACK_VERIFIED",
  QUALITY_GATE_PASSED: "QUALITY_GATE_PASSED"
});

const TRANSITION_GRAPH = Object.freeze({
  [TRANSITIONS.REHEARSAL_COMPLETED]: { from: STATES.PLANNED, to: STATES.REHEARSED },
  [TRANSITIONS.RECONCILIATION_PASSED]: { from: STATES.REHEARSED, to: STATES.RECONCILED },
  [TRANSITIONS.ROLLBACK_VERIFIED]: { from: STATES.RECONCILED, to: STATES.ROLLBACK_VERIFIED },
  [TRANSITIONS.QUALITY_GATE_PASSED]: { from: STATES.ROLLBACK_VERIFIED, to: STATES.LOCAL_CANDIDATE }
});

function controlError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function requireText(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw controlError("DATA_MIGRATION_METADATA_REQUIRED", `${field} is required`);
  return normalized;
}

function requireDigest(value, field) {
  const normalized = requireText(value, field);
  if (!SHA256.test(normalized)) throw controlError("DATA_MIGRATION_DIGEST_INVALID", `${field} must be a sha256 digest`);
  return normalized;
}

function requireTimestamp(value, field) {
  const normalized = requireText(value, field);
  if (Number.isNaN(Date.parse(normalized))) throw controlError("DATA_MIGRATION_TIMESTAMP_INVALID", `${field} must be an ISO timestamp`);
  return normalized;
}

function requireCount(value, field) {
  if (!Number.isInteger(value) || value < 0) throw controlError("DATA_MIGRATION_COUNT_INVALID", `${field} must be a non-negative integer`);
  return value;
}

function validateDataMigrationProgram(program = defaultProgram, promotions = promotionProgram) {
  validatePromotionProgram(promotions);
  if (program?.schemaVersion !== "data-migration-program-v1") throw new TypeError("data migration program schema is invalid");
  if (program.mode !== "outbox-shadow-then-cutover" || program.requestPathDualWrite !== false) {
    throw new TypeError("data migration program must use outbox shadow migration without request-path dual writes");
  }
  if (program.productionCutoverAuthorized !== false) throw new TypeError("data migration program cannot authorize production cutover");
  if (!Array.isArray(program.waves) || program.waves.length === 0) throw new TypeError("data migration program requires waves");
  const waveIds = new Set();
  const collections = [];
  for (const wave of program.waves) {
    if (!/^[a-z][a-z0-9-]+$/.test(wave.id || "") || waveIds.has(wave.id)) throw new TypeError("data migration wave id is invalid or duplicated");
    waveIds.add(wave.id);
    if (!Array.isArray(wave.collections) || wave.collections.length === 0) throw new TypeError(`data migration wave ${wave.id} requires collections`);
    collections.push(...wave.collections);
  }
  if (new Set(collections).size !== collections.length) throw new TypeError("data migration collections must appear in exactly one wave");
  const promoted = (promotions.collections || []).map((item) => item.collection).sort();
  if (JSON.stringify([...collections].sort()) !== JSON.stringify(promoted)) throw new TypeError("data migration waves must cover every promoted P0 collection exactly once");
  const reconciliation = program.reconciliation || {};
  if (reconciliation.allowedMismatchCount !== 0 || reconciliation.allowedDuplicateCount !== 0 || reconciliation.requireMatchingDigest !== true) {
    throw new TypeError("data migration reconciliation must require exact counts and matching digests");
  }
  const rollback = program.rollback || {};
  if (!Number.isFinite(rollback.maximumRpoSeconds) || !Number.isFinite(rollback.maximumRtoSeconds) || rollback.minimumIndependentApprovals < 2) {
    throw new TypeError("data migration rollback policy is invalid");
  }
  const quality = program.qualityThresholds || {};
  if (quality.minimumCompletenessPct < 99 || quality.minimumValidityPct < 99 || quality.minimumUniquenessPct < 99 || quality.maximumCriticalIssueCount !== 0) {
    throw new TypeError("data migration quality policy is too weak");
  }
  if (!Array.isArray(program.externalGates) || program.externalGates.length === 0) throw new TypeError("data migration program requires external gates");
  return true;
}

function createMigrationRun(metadata, options = {}) {
  const program = options.program || defaultProgram;
  validateDataMigrationProgram(program, options.promotions || promotionProgram);
  assertMetadataOnly(metadata, "migrationRun");
  const runId = requireText(metadata?.runId, "runId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(runId)) throw controlError("DATA_MIGRATION_RUN_ID_INVALID", "runId is invalid");
  const waveId = requireText(metadata?.waveId, "waveId");
  const wave = program.waves.find((item) => item.id === waveId);
  if (!wave) throw controlError("DATA_MIGRATION_WAVE_UNKNOWN", `unknown migration wave: ${waveId}`);
  return Object.freeze({
    schemaVersion: "data-migration-run-v1",
    runId,
    waveId,
    collections: Object.freeze([...wave.collections]),
    state: STATES.PLANNED,
    productionReady: false,
    productionPrimary: false,
    cutoverAuthorized: false,
    controls: Object.freeze({}),
    history: Object.freeze([])
  });
}

function baseEvidence(evidence) {
  return Object.freeze({
    evidenceRef: requireText(evidence?.evidenceRef, "evidenceRef"),
    artifactDigest: requireDigest(evidence?.artifactDigest, "artifactDigest"),
    completedAt: requireTimestamp(evidence?.completedAt, "completedAt")
  });
}

function validateRehearsal(evidence) {
  const environment = requireText(evidence.environment, "environment").toLowerCase();
  if (!["test", "staging", "preproduction"].includes(environment)) {
    throw controlError("DATA_MIGRATION_REHEARSAL_ENVIRONMENT_BLOCKED", "rehearsal environment must be non-production");
  }
  return Object.freeze({
    ...baseEvidence(evidence),
    environment,
    sourceVersion: requireText(evidence.sourceVersion, "sourceVersion"),
    sourceCount: requireCount(evidence.sourceCount, "sourceCount")
  });
}

function validateReconciliation(evidence, program) {
  const sourceCount = requireCount(evidence.sourceCount, "sourceCount");
  const targetCount = requireCount(evidence.targetCount, "targetCount");
  const mismatchCount = requireCount(evidence.mismatchCount, "mismatchCount");
  const duplicateCount = requireCount(evidence.duplicateCount, "duplicateCount");
  const sourceDigest = requireDigest(evidence.sourceDigest, "sourceDigest");
  const targetDigest = requireDigest(evidence.targetDigest, "targetDigest");
  if (sourceCount !== targetCount || mismatchCount > program.reconciliation.allowedMismatchCount || duplicateCount > program.reconciliation.allowedDuplicateCount || sourceDigest !== targetDigest) {
    throw controlError("DATA_MIGRATION_RECONCILIATION_FAILED", "source and target reconciliation must match exactly");
  }
  return Object.freeze({
    ...baseEvidence(evidence),
    sourceCount,
    targetCount,
    mismatchCount,
    duplicateCount,
    sourceVersion: requireText(evidence.sourceVersion, "sourceVersion"),
    sourceDigest,
    targetDigest,
    outboxCheckpoint: requireText(evidence.outboxCheckpoint, "outboxCheckpoint")
  });
}

function validateRollback(evidence, program) {
  const snapshotDigest = requireDigest(evidence.snapshotDigest, "snapshotDigest");
  const restoreDigest = requireDigest(evidence.restoreDigest, "restoreDigest");
  const rpoSeconds = requireCount(evidence.rpoSeconds, "rpoSeconds");
  const rtoSeconds = requireCount(evidence.rtoSeconds, "rtoSeconds");
  const approvals = Array.isArray(evidence.approvals) ? evidence.approvals.map((approval) => Object.freeze({
    role: requireText(approval.role, "approval.role"),
    evidenceRef: requireText(approval.evidenceRef, "approval.evidenceRef"),
    digest: requireDigest(approval.digest, "approval.digest")
  })) : [];
  const roles = new Set(approvals.map((item) => item.role));
  const requiredRoles = program.rollback.requiredApprovalRoles || [];
  if (snapshotDigest !== restoreDigest || rpoSeconds > program.rollback.maximumRpoSeconds || rtoSeconds > program.rollback.maximumRtoSeconds || approvals.length < program.rollback.minimumIndependentApprovals || roles.size !== approvals.length || requiredRoles.some((role) => !roles.has(role))) {
    throw controlError("DATA_MIGRATION_ROLLBACK_GATE_FAILED", "rollback rehearsal digest, objectives and independent approvals must pass policy");
  }
  return Object.freeze({ ...baseEvidence(evidence), snapshotDigest, restoreDigest, rpoSeconds, rtoSeconds, approvals: Object.freeze(approvals) });
}

function validateQuality(evidence, program) {
  const metrics = {
    completenessPct: Number(evidence.completenessPct),
    validityPct: Number(evidence.validityPct),
    uniquenessPct: Number(evidence.uniquenessPct),
    freshnessLagSeconds: Number(evidence.freshnessLagSeconds),
    criticalIssueCount: Number(evidence.criticalIssueCount),
    unresolvedIssueCount: Number(evidence.unresolvedIssueCount)
  };
  if (Object.values(metrics).some((value) => !Number.isFinite(value) || value < 0) || metrics.completenessPct > 100 || metrics.validityPct > 100 || metrics.uniquenessPct > 100) {
    throw controlError("DATA_MIGRATION_QUALITY_METRIC_INVALID", "quality metrics must be valid percentages and non-negative numbers");
  }
  const threshold = program.qualityThresholds;
  if (metrics.completenessPct < threshold.minimumCompletenessPct || metrics.validityPct < threshold.minimumValidityPct || metrics.uniquenessPct < threshold.minimumUniquenessPct || metrics.freshnessLagSeconds > threshold.maximumFreshnessLagSeconds || metrics.criticalIssueCount > threshold.maximumCriticalIssueCount || metrics.unresolvedIssueCount > threshold.maximumUnresolvedIssueCount) {
    throw controlError("DATA_MIGRATION_QUALITY_GATE_FAILED", "data quality metrics do not meet the migration policy");
  }
  return Object.freeze({ ...baseEvidence(evidence), ...metrics });
}

function transitionProjection(transition, evidence, program) {
  if (transition === TRANSITIONS.REHEARSAL_COMPLETED) return validateRehearsal(evidence);
  if (transition === TRANSITIONS.RECONCILIATION_PASSED) return validateReconciliation(evidence, program);
  if (transition === TRANSITIONS.ROLLBACK_VERIFIED) return validateRollback(evidence, program);
  if (transition === TRANSITIONS.QUALITY_GATE_PASSED) return validateQuality(evidence, program);
  throw controlError("DATA_MIGRATION_TRANSITION_UNKNOWN", `unknown data migration transition: ${transition}`);
}

function advanceMigrationRun(run, transition, evidence, options = {}) {
  const program = options.program || defaultProgram;
  validateDataMigrationProgram(program, options.promotions || promotionProgram);
  assertMetadataOnly(evidence, "migrationEvidence");
  const edge = TRANSITION_GRAPH[transition];
  if (!edge) throw controlError("DATA_MIGRATION_TRANSITION_UNKNOWN", `unknown data migration transition: ${transition}`);
  if (run?.schemaVersion !== "data-migration-run-v1" || run.state !== edge.from) {
    throw controlError("DATA_MIGRATION_TRANSITION_INVALID", `${transition} requires state ${edge.from}`);
  }
  const projection = transitionProjection(transition, evidence || {}, program);
  const evidenceDigest = createTechnicalEvidenceFingerprint(`data-migration-${transition.toLowerCase()}-v1`, projection);
  const historyEntry = Object.freeze({ transition, from: edge.from, to: edge.to, at: projection.completedAt, evidenceRef: projection.evidenceRef, evidenceDigest });
  const controlKey = {
    [TRANSITIONS.REHEARSAL_COMPLETED]: "rehearsal",
    [TRANSITIONS.RECONCILIATION_PASSED]: "reconciliation",
    [TRANSITIONS.ROLLBACK_VERIFIED]: "rollback",
    [TRANSITIONS.QUALITY_GATE_PASSED]: "quality"
  }[transition];
  return Object.freeze({
    ...run,
    state: edge.to,
    productionReady: false,
    productionPrimary: false,
    cutoverAuthorized: false,
    controls: Object.freeze({ ...run.controls, [controlKey]: projection }),
    history: Object.freeze([...(run.history || []), historyEntry])
  });
}

function buildDataMigrationControlCenter(runs = [], options = {}) {
  const program = options.program || defaultProgram;
  validateDataMigrationProgram(program, options.promotions || promotionProgram);
  if (!Array.isArray(runs)) throw new TypeError("migration runs must be an array");
  runs.forEach((run) => assertMetadataOnly(run, "migrationRun"));
  const stateOrder = [STATES.PLANNED, STATES.REHEARSED, STATES.RECONCILED, STATES.ROLLBACK_VERIFIED, STATES.LOCAL_CANDIDATE];
  const transitionOrder = [TRANSITIONS.REHEARSAL_COMPLETED, TRANSITIONS.RECONCILIATION_PASSED, TRANSITIONS.ROLLBACK_VERIFIED, TRANSITIONS.QUALITY_GATE_PASSED];
  const controlOrder = ["rehearsal", "reconciliation", "rollback", "quality"];
  const runValidity = runs.map((run) => {
    const wave = program.waves.find((item) => item.id === run?.waveId);
    const stateIndex = stateOrder.indexOf(run?.state);
    const collectionsMatch = Boolean(wave) && JSON.stringify(run.collections || []) === JSON.stringify(wave.collections);
    const history = Array.isArray(run?.history) ? run.history : [];
    const controls = run?.controls && typeof run.controls === "object" && !Array.isArray(run.controls) ? run.controls : {};
    const historyMatches = stateIndex >= 0 && history.length === stateIndex && history.every((entry, index) => {
      const edge = TRANSITION_GRAPH[transitionOrder[index]];
      return entry.transition === transitionOrder[index] && entry.from === edge.from && entry.to === edge.to && SHA256.test(entry.evidenceDigest || "") && Boolean(entry.evidenceRef) && !Number.isNaN(Date.parse(entry.at));
    });
    const controlsMatch = stateIndex >= 0 && controlOrder.every((key, index) => index < stateIndex ? Boolean(controls[key]) : !Object.prototype.hasOwnProperty.call(controls, key));
    return run?.schemaVersion === "data-migration-run-v1" && collectionsMatch && historyMatches && controlsMatch && run.productionReady === false && run.productionPrimary === false && run.cutoverAuthorized === false;
  });
  const validRuns = runValidity.every(Boolean);
  const localCandidates = runs.filter((run, index) => runValidity[index] && run.state === STATES.LOCAL_CANDIDATE).length;
  const checks = Object.freeze([
    { id: "dataMigration:program", passed: true, detail: `${program.waves.length} controlled waves` },
    { id: "dataMigration:noRequestDualWrite", passed: program.requestPathDualWrite === false, detail: program.mode },
    { id: "dataMigration:runIntegrity", passed: validRuns, detail: `${runs.length} metadata-only runs` },
    { id: "dataMigration:productionFailClosed", passed: program.productionCutoverAuthorized === false && runs.every((run) => run.productionReady === false && run.productionPrimary === false && run.cutoverAuthorized === false), detail: "repository controls cannot authorize production cutover" }
  ]);
  return Object.freeze({
    schemaVersion: "data-migration-control-center-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    controlPlaneReady: checks.every((item) => item.passed),
    localGateReady: checks.every((item) => item.passed) && runs.length > 0 && localCandidates === runs.length,
    productionReady: false,
    productionPrimary: false,
    cutoverAuthorized: false,
    summary: Object.freeze({ waves: program.waves.length, collections: program.waves.reduce((sum, wave) => sum + wave.collections.length, 0), runs: runs.length, localCandidates }),
    runs: Object.freeze([...runs]),
    checks,
    externalGates: Object.freeze([...program.externalGates]),
    boundary: "Local metadata controls can qualify a cutover candidate, but only real site evidence and external approvals can authorize production."
  });
}

module.exports = {
  STATES,
  TRANSITIONS,
  advanceMigrationRun,
  buildDataMigrationControlCenter,
  createMigrationRun,
  validateDataMigrationProgram
};

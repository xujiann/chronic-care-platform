"use strict";

const CONTRACT_ID = "public-health-direct-report-v1";
const DICTIONARY_SCHEMA = "public-health-direct-report-dictionary-lifecycle-v1";
const JOINT_TEST_SCHEMA = "public-health-direct-report-synthetic-joint-test-run-v1";
const OBSERVABILITY_SCHEMA = "public-health-direct-report-observability-report-v1";
const DIGEST = /^[a-f0-9]{64}$/;

class DirectReportReadinessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DirectReportReadinessError";
    this.code = code;
    this.statusCode = 400;
  }
}

function isoTime(value, label) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new DirectReportReadinessError(
      "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_TIME_INVALID",
      `${label} must be a valid date-time`
    );
  }
  return new Date(parsed).toISOString();
}

function requireProjection(value, predicate, label) {
  if (!value || typeof value !== "object" || !predicate(value)) {
    throw new DirectReportReadinessError(
      "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_PROJECTION_INVALID",
      `${label} is not a recognized safe projection`
    );
  }
  return value;
}

function check(id, passed, blocker, owner) {
  return Object.freeze({
    id,
    passed: passed === true,
    blocker: passed === true ? null : blocker,
    owner
  });
}

function buildDirectReportProductionCandidateReadiness(input = {}, options = {}) {
  const evaluatedAt = isoTime(
    options.now || input.evaluatedAt || new Date().toISOString(),
    "readiness evaluatedAt"
  );
  const nowMs = Date.parse(evaluatedAt);
  const dictionary = requireProjection(
    input.dictionaryLifecycle,
    (value) => value.schemaVersion === DICTIONARY_SCHEMA
      && value.active
      && DIGEST.test(String(value.active.dictionaryDigest || ""))
      && DIGEST.test(String(value.active.mappingFingerprint || "")),
    "dictionary lifecycle"
  );
  const control = requireProjection(
    input.activationControl,
    (value) => value.contractId === undefined || value.contractId === CONTRACT_ID,
    "activation control"
  );
  const jointTest = requireProjection(
    input.syntheticJointTest,
    (value) => value.schemaVersion === JOINT_TEST_SCHEMA
      && value.contractId === CONTRACT_ID,
    "synthetic joint test"
  );
  const reconciliation = requireProjection(
    input.reconciliation,
    (value) => Number.isSafeInteger(value.total)
      && Number.isSafeInteger(value.open)
      && Number.isSafeInteger(value.criticalOpen)
      && value.total >= 0
      && value.open >= 0
      && value.criticalOpen >= 0,
    "reconciliation summary"
  );
  const observability = requireProjection(
    input.observability,
    (value) => value.schemaVersion === OBSERVABILITY_SCHEMA
      && value.contractId === CONTRACT_ID
      && Array.isArray(value.alerts),
    "observability report"
  );

  const evidenceExpiresAtMs = Date.parse(String(control.evidenceExpiresAt || ""));
  const scenariosRequired = Number(control.scenariosRequired);
  const scenariosPassed = Number(control.scenariosPassed);
  const checks = [
    check(
      "dictionary-lifecycle",
      dictionary.dictionaryLifecycleReady === true && dictionary.activeValidity === "active",
      "DIRECT_REPORT_DICTIONARY_LIFECYCLE_NOT_READY",
      "data-governance"
    ),
    check(
      "official-activation-control",
      control.activationReady === true
        && control.codeReady === true
        && control.productionReady === false,
      "DIRECT_REPORT_OFFICIAL_CONTROL_NOT_READY",
      "direct-report-control-custodians"
    ),
    check(
      "dictionary-binding",
      control.dictionaryDigest === dictionary.active.dictionaryDigest
        && control.mappingFingerprint === dictionary.active.mappingFingerprint,
      "DIRECT_REPORT_DICTIONARY_BINDING_DRIFT",
      "direct-report-control-custodians"
    ),
    check(
      "official-evidence-validity",
      Number.isFinite(evidenceExpiresAtMs) && evidenceExpiresAtMs > nowMs,
      "DIRECT_REPORT_OFFICIAL_EVIDENCE_EXPIRED_OR_MISSING",
      "joint-direct-report-operations"
    ),
    check(
      "official-scenario-coverage",
      Number.isSafeInteger(scenariosRequired)
        && scenariosRequired > 0
        && scenariosPassed === scenariosRequired,
      "DIRECT_REPORT_OFFICIAL_SCENARIOS_INCOMPLETE",
      "joint-direct-report-operations"
    ),
    check(
      "synthetic-joint-test",
      jointTest.syntheticDataOnly === true
        && jointTest.externalCalls === 0
        && jointTest.credentialsUsed === false
        && jointTest.officialSignaturesGenerated === false
        && jointTest.scenarioCount > 0
        && jointTest.scenariosPassed === jointTest.scenarioCount
        && jointTest.productionReady === false,
      "DIRECT_REPORT_SYNTHETIC_JOINT_TEST_INCOMPLETE",
      "external-integration"
    ),
    check(
      "reconciliation",
      reconciliation.open === 0
        && reconciliation.criticalOpen === 0
        && reconciliation.productionReady === false,
      "DIRECT_REPORT_RECONCILIATION_OPEN",
      "care-coordination"
    ),
    check(
      "observability",
      observability.status === "healthy"
        && observability.monitoringReady === true
        && observability.alerts.length === 0
        && observability.productionReady === false,
      "DIRECT_REPORT_OBSERVABILITY_NOT_HEALTHY",
      "platform-operations"
    )
  ];
  const technicalBlockers = checks
    .filter((item) => !item.passed)
    .map((item) => item.blocker);
  const technicalCandidateReady = technicalBlockers.length === 0;

  return Object.freeze({
    schemaVersion: "public-health-direct-report-production-candidate-readiness-v1",
    contractId: CONTRACT_ID,
    evaluatedAt,
    technicalCandidateReady,
    checks: Object.freeze(checks),
    summary: Object.freeze({
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: technicalBlockers.length,
      reconciliationOpen: reconciliation.open,
      activeAlerts: observability.alerts.length
    }),
    bindings: Object.freeze({
      dictionaryMatchesControl: checks.find((item) => item.id === "dictionary-binding").passed,
      evidenceCurrent: checks.find((item) => item.id === "official-evidence-validity").passed
    }),
    technicalBlockers: Object.freeze(technicalBlockers),
    productionBlockers: Object.freeze([
      ...technicalBlockers,
      "GLOBAL_SITE_PRODUCTION_GO_NO_GO_REQUIRED"
    ]),
    safety: Object.freeze({
      rawPayloadsIncluded: false,
      residentIdentityIncluded: false,
      credentialsIncluded: false,
      signaturesIncluded: false
    }),
    productionReady: false,
    boundary: "Technical candidate readiness never authorizes production cutover."
  });
}

module.exports = {
  CONTRACT_ID,
  DICTIONARY_SCHEMA,
  DirectReportReadinessError,
  JOINT_TEST_SCHEMA,
  OBSERVABILITY_SCHEMA,
  buildDirectReportProductionCandidateReadiness
};

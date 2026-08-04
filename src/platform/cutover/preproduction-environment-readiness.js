"use strict";

const {
  readBoundedJsonFile
} = require("./pilot-cutover-package");
const {
  SHA256,
  assertMetadataOnly,
  createTechnicalEvidenceFingerprint
} = require("../governance/technical-evidence");

const INPUT_SCHEMA = "preproduction-environment-evidence-v1";
const MAX_INPUT_BYTES = 512 * 1024;
const REQUIRED_COMPONENTS = Object.freeze([
  "postgres",
  "object-storage",
  "central-session",
  "durable-messaging",
  "audit-retention"
]);
const REQUIRED_RECOVERY_SCENARIOS = Object.freeze([
  "application-restart",
  "worker-interruption",
  "duplicate-delivery",
  "database-restore"
]);
const CONTROLLED_REFERENCE = /^(?:vault|evidence|artifact|cmdb|ticket):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;

function readinessError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function instant(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function evidenceRowValid(row, now) {
  return row?.status === "verified"
    && CONTROLLED_REFERENCE.test(clean(row.evidenceRef, 240))
    && SHA256.test(clean(row.evidenceDigest, 80))
    && clean(row.operatorAccount, 160)
    && clean(row.verifierAccount, 160)
    && clean(row.operatorAccount, 160) !== clean(row.verifierAccount, 160)
    && instant(row.verifiedAt) <= now
    && instant(row.expiresAt) > now;
}

function recoveryRowValid(row, now) {
  const startedAt = instant(row?.startedAt);
  const completedAt = instant(row?.completedAt);
  const rpoTargetMinutes = Number(row?.rpoTargetMinutes);
  const rpoActualMinutes = Number(row?.rpoActualMinutes);
  const rtoTargetMinutes = Number(row?.rtoTargetMinutes);
  const rtoActualMinutes = Number(row?.rtoActualMinutes);
  return row?.passed === true
    && CONTROLLED_REFERENCE.test(clean(row.evidenceRef, 240))
    && SHA256.test(clean(row.evidenceDigest, 80))
    && clean(row.operatorAccount, 160)
    && clean(row.verifierAccount, 160)
    && clean(row.operatorAccount, 160) !== clean(row.verifierAccount, 160)
    && startedAt <= completedAt
    && completedAt <= now
    && [rpoTargetMinutes, rpoActualMinutes, rtoTargetMinutes, rtoActualMinutes].every((value) =>
      Number.isFinite(value) && value >= 0 && value <= 1440)
    && rpoActualMinutes <= rpoTargetMinutes
    && rtoActualMinutes <= rtoTargetMinutes;
}

function evaluatePreproductionEnvironment(input = {}, options = {}) {
  assertMetadataOnly(input, "preproductionEnvironmentEvidence");
  const now = instant(options.now || new Date().toISOString());
  if (!Number.isFinite(now)
    || input.schemaVersion !== INPUT_SCHEMA
    || input.environment !== "pre-production"
    || !clean(input.environmentId, 160)
    || !clean(input.releaseId, 160)
    || !SHA256.test(clean(input.packageFingerprint, 80))
    || !Array.isArray(input.components)
    || !Array.isArray(input.recoveryScenarios)) {
    throw readinessError(
      "PREPRODUCTION_ENVIRONMENT_INPUT_INVALID",
      "pre-production evidence must bind one environment, release and immutable package"
    );
  }
  const latestComponents = new Map();
  input.components.forEach((row) => latestComponents.set(clean(row?.id, 120), row));
  const componentChecks = Object.freeze(Object.fromEntries(REQUIRED_COMPONENTS.map((id) => [
    id,
    evidenceRowValid(latestComponents.get(id), now)
  ])));
  const latestScenarios = new Map();
  input.recoveryScenarios.forEach((row) => latestScenarios.set(clean(row?.id, 120), row));
  const recoveryChecks = Object.freeze(Object.fromEntries(REQUIRED_RECOVERY_SCENARIOS.map((id) => [
    id,
    recoveryRowValid(latestScenarios.get(id), now)
  ])));
  const accountPairs = [
    ...REQUIRED_COMPONENTS.map((id) => latestComponents.get(id)),
    ...REQUIRED_RECOVERY_SCENARIOS.map((id) => latestScenarios.get(id))
  ].filter(Boolean);
  const checks = Object.freeze({
    packageBound: input.releaseId === clean(options.releaseId || input.releaseId, 160)
      && input.packageFingerprint === clean(
        options.packageFingerprint || input.packageFingerprint,
        80
      ),
    components: Object.values(componentChecks).every(Boolean),
    recovery: Object.values(recoveryChecks).every(Boolean),
    independentVerification: accountPairs.length
      === REQUIRED_COMPONENTS.length + REQUIRED_RECOVERY_SCENARIOS.length
      && accountPairs.every((row) =>
        clean(row.operatorAccount, 160) !== clean(row.verifierAccount, 160))
  });
  const ready = Object.values(checks).every(Boolean);
  const projection = {
    schema: "preproduction-environment-readiness-v1",
    evaluatedAt: new Date(now).toISOString(),
    environmentId: clean(input.environmentId, 160),
    releaseId: clean(input.releaseId, 160),
    packageFingerprint: clean(input.packageFingerprint, 80),
    componentChecks,
    recoveryChecks,
    checks,
    ready,
    decision: ready ? "LOCAL-READY" : "NO-GO",
    productionReady: false,
    boundary: "This report verifies bounded pre-production metadata only. It cannot prove or execute production deployment."
  };
  return Object.freeze({
    ...projection,
    technicalEvidenceFingerprint: createTechnicalEvidenceFingerprint(
      "preproduction-environment-readiness-v1",
      projection
    )
  });
}

function evaluatePreproductionEnvironmentFile(options = {}) {
  const input = readBoundedJsonFile(options.file, {
    label: "pre-production environment evidence",
    maximumBytes: MAX_INPUT_BYTES
  });
  return evaluatePreproductionEnvironment(input, options);
}

module.exports = {
  INPUT_SCHEMA,
  MAX_INPUT_BYTES,
  REQUIRED_COMPONENTS,
  REQUIRED_RECOVERY_SCENARIOS,
  evaluatePreproductionEnvironment,
  evaluatePreproductionEnvironmentFile
};

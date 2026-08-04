"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  createTechnicalEvidenceFingerprint
} = require("./technical-evidence");

const CONTROL_FILE = path.resolve(__dirname, "..", "..", "..", "config", "platform-operational-controls.json");
const CONTROLLED_REFERENCE = /^(?:vault|evidence|artifact|cmdb|ticket):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_FIELD = /(?:password|secret|token|credentialValue|privateKey|patient|resident|diagnosis|payload|clinicalDetail)/i;
const PERMITTED_BOUNDARY_FIELDS = new Set(["patientDataIncluded", "secretsIncluded"]);

function controlError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function assertMetadataOnly(value, location = "snapshot") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataOnly(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_FIELD.test(key) && !PERMITTED_BOUNDARY_FIELDS.has(key)) {
      throw controlError(
        "OPERATIONAL_CONTROL_SENSITIVE_FIELD",
        `${location}.${key} is forbidden in operational control evidence`
      );
    }
    assertMetadataOnly(item, `${location}.${key}`);
  }
}

function loadOperationalControls(file = CONTROL_FILE) {
  const controls = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  if (controls.schemaVersion !== "platform-operational-controls-v1"
    || !Array.isArray(controls.security?.requiredRoles)
    || !Array.isArray(controls.monitoring?.requiredSignals)
    || !Array.isArray(controls.dataGovernance?.requiredChecks)) {
    throw controlError("OPERATIONAL_CONTROL_CONFIG_INVALID", "platform operational control configuration is invalid");
  }
  return Object.freeze(structuredClone(controls));
}

function acceptedExternalEvidence(records = [], requiredIds = []) {
  const accepted = new Set(records.filter((item) =>
    item?.status === "accepted"
    && CONTROLLED_REFERENCE.test(clean(item?.evidenceRef, 240))
    && SHA256.test(clean(item?.evidenceDigest, 80)))
    .map((item) => clean(item.id, 120)));
  return Object.freeze({
    ok: requiredIds.every((id) => accepted.has(id)),
    accepted: Object.freeze([...accepted].sort()),
    required: Object.freeze([...requiredIds])
  });
}

function evaluateSecurity(config, snapshot = {}, external = []) {
  const roles = new Map((snapshot.roleBindings || []).map((item) => [clean(item.role, 100), item]));
  const checks = Object.freeze({
    leastPrivilege: config.requiredRoles.every((role) =>
      roles.get(role)?.reviewed === true && Number(roles.get(role)?.excessPrivileges) === 0),
    auditDurability: snapshot.auditRepository?.healthy === true
      && snapshot.auditRepository?.appendOnly === true,
    keyRotation: Number(snapshot.keyAgeDays) >= 0
      && Number(snapshot.keyAgeDays) <= Number(config.maximumKeyAgeDays),
    criticalFindings: Number(snapshot.openCriticalFindings) <= Number(config.maximumOpenCriticalFindings)
  });
  const externalEvidence = acceptedExternalEvidence(external, config.externalGates);
  return Object.freeze({
    localReady: Object.values(checks).every(Boolean),
    externalReady: externalEvidence.ok,
    checks,
    externalEvidence
  });
}

function evaluateMonitoring(config, snapshot = {}, external = []) {
  const signals = new Map((snapshot.signals || []).map((item) => [clean(item.id, 120), item]));
  const scenarios = new Map((snapshot.drills || []).map((item) => [clean(item.id, 120), item]));
  const checks = Object.freeze({
    signalCoverage: config.requiredSignals.every((id) =>
      signals.get(id)?.healthy === true
      && Number(signals.get(id)?.ageSeconds) >= 0
      && Number(signals.get(id)?.ageSeconds) <= Number(config.maximumSignalAgeSeconds)),
    drillCoverage: config.requiredDrillScenarios.every((id) =>
      scenarios.get(id)?.passed === true
      && CONTROLLED_REFERENCE.test(clean(scenarios.get(id)?.receiptRef, 240))),
    escalationOwnership: Boolean(clean(snapshot.onCallOwner, 160))
      && CONTROLLED_REFERENCE.test(clean(snapshot.escalationPolicyRef, 240))
  });
  const externalEvidence = acceptedExternalEvidence(external, config.externalGates);
  return Object.freeze({
    localReady: Object.values(checks).every(Boolean),
    externalReady: externalEvidence.ok,
    checks,
    externalEvidence
  });
}

function evaluateDataGovernance(config, snapshot = {}, external = [], now = new Date().toISOString()) {
  const checksById = new Map((snapshot.checks || []).map((item) => [clean(item.id, 120), item]));
  const generatedAt = Date.parse(snapshot.generatedAt || "");
  const ageHours = (Date.parse(now) - generatedAt) / 3_600_000;
  const checks = Object.freeze({
    qualityCoverage: config.requiredChecks.every((id) =>
      checksById.get(id)?.passed === true
      && SHA256.test(clean(checksById.get(id)?.reportDigest, 80))),
    reportFreshness: Number.isFinite(ageHours)
      && ageHours >= 0
      && ageHours <= Number(config.maximumReportAgeHours),
    retentionPolicy: Number(snapshot.auditRetentionDays) === Number(config.auditRetentionDays),
    minimizedExport: snapshot.exports?.metadataOnly === true
      && snapshot.exports?.patientDataIncluded === false
      && snapshot.exports?.secretsIncluded === false
  });
  const externalEvidence = acceptedExternalEvidence(external, config.externalGates);
  return Object.freeze({
    localReady: Object.values(checks).every(Boolean),
    externalReady: externalEvidence.ok,
    checks,
    externalEvidence
  });
}

function evaluateOperationalControlPlane(options = {}) {
  const config = options.config || loadOperationalControls(options.file);
  const snapshot = options.snapshot || {};
  assertMetadataOnly(snapshot);
  const external = Array.isArray(options.externalEvidence) ? options.externalEvidence : [];
  assertMetadataOnly(external, "externalEvidence");
  const security = evaluateSecurity(config.security, snapshot.security, external);
  const monitoring = evaluateMonitoring(config.monitoring, snapshot.monitoring, external);
  const dataGovernance = evaluateDataGovernance(
    config.dataGovernance,
    snapshot.dataGovernance,
    external,
    options.now || new Date().toISOString()
  );
  const domains = Object.freeze({ security, monitoring, dataGovernance });
  const projection = Object.freeze({
    schema: "platform-operational-control-report-v1",
    domains,
    localReady: Object.values(domains).every((item) => item.localReady),
    externalReady: Object.values(domains).every((item) => item.externalReady),
    operationalReady: Object.values(domains).every((item) => item.localReady && item.externalReady),
    externalEvidenceInferred: false,
    sensitiveDataExposed: false
  });
  return Object.freeze({
    ...projection,
    technicalEvidenceFingerprint: createTechnicalEvidenceFingerprint(
      projection.schema,
      projection
    ),
    productionReady: false,
    boundary: "Operational readiness is metadata-only. External assessments, alert-route verification, retention approval, and data-owner signoff must be supplied as controlled evidence."
  });
}

module.exports = {
  CONTROL_FILE,
  acceptedExternalEvidence,
  assertMetadataOnly,
  evaluateOperationalControlPlane,
  loadOperationalControls
};

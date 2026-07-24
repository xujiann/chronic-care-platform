"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EVIDENCE_SCHEMA_VERSION = "care-service-dependency-evidence-v1";
const REQUIRED_DEPENDENCIES = Object.freeze([
  "storage",
  "identity",
  "sms",
  "his",
  "appointment",
  "object-storage",
  "payment",
  "insurance",
  "certificate",
  "audit",
  "outbox-worker",
  "nursing-delivery",
  "escort-delivery"
]);
const CHECK_TYPES = Object.freeze(["authenticated-read-only", "signed-health", "controlled-smoke"]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PLACEHOLDER_PATTERN = /replace-with|change-me|changeme|placeholder|example|demo[-_]/i;

function text(value, maximum = 500) {
  return String(value == null ? "" : value).trim().slice(0, maximum);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function parseInstant(value) {
  const candidate = text(value, 80);
  const milliseconds = Date.parse(candidate);
  return Number.isFinite(milliseconds) ? { value: candidate, milliseconds } : null;
}

function safeUrlTarget(value) {
  const candidate = text(value, 2000);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return candidate;
  }
}

function dependencyTargets(env = {}) {
  const storageEngine = text(env.STORAGE_ENGINE, 40).toLowerCase();
  return {
    storage: [
      storageEngine,
      storageEngine === "sqlite"
        ? text(env.SQLITE_FILE || env.DATA_DIR || "health-city.sqlite", 1000)
        : safeUrlTarget(env.DATABASE_URL)
    ],
    identity: [safeUrlTarget(env.OIDC_ISSUER_URL), text(env.OIDC_CLIENT_ID, 240)],
    sms: [safeUrlTarget(env.SMS_GATEWAY_URL), text(env.SMS_TEMPLATE_ID, 240)],
    his: [safeUrlTarget(env.HIS_ADAPTER_URL)],
    appointment: [safeUrlTarget(env.APPOINTMENT_ADAPTER_URL)],
    "object-storage": [safeUrlTarget(env.OBJECT_STORAGE_GATEWAY_URL), text(env.OBJECT_STORAGE_BUCKET, 240)],
    payment: [safeUrlTarget(env.PAYMENT_GATEWAY_URL)],
    insurance: [safeUrlTarget(env.INSURANCE_GATEWAY_URL)],
    certificate: [safeUrlTarget(env.CERTIFICATE_GATEWAY_URL)],
    audit: [safeUrlTarget(env.SIEM_ENDPOINT), text(env.AUDIT_EXPORT_PATH, 1000)],
    "outbox-worker": [
      text(env.CARE_OUTBOX_WORKER_ID, 240),
      text(env.CARE_SERVICE_RUNTIME_MODULE, 1000)
    ],
    "nursing-delivery": [safeUrlTarget(env.CARE_NURSING_DELIVERY_URL)],
    "escort-delivery": [safeUrlTarget(env.CARE_ESCORT_DELIVERY_URL)]
  };
}

function targetDigestForDependency(env, dependencyValue) {
  const dependency = text(dependencyValue, 80).toLowerCase();
  const targets = dependencyTargets(env)[dependency] || [];
  return sha256(Buffer.from(JSON.stringify({ dependency, targets }), "utf8"));
}

function referenceReady(value) {
  const candidate = text(value, 500);
  return candidate.length >= 8 && !PLACEHOLDER_PATTERN.test(candidate);
}

function addError(errors, code, dependency, detail) {
  errors.push({
    code,
    ...(dependency ? { dependency } : {}),
    detail
  });
}

function validateDependencyEvidence(manifestValue, options = {}) {
  const manifest = manifestValue && typeof manifestValue === "object" && !Array.isArray(manifestValue)
    ? manifestValue
    : {};
  const env = options.env || {};
  const at = parseInstant(options.at || new Date().toISOString());
  const expectedPolicyVersion = text(options.policyVersion, 120);
  const expectedDigest = text(options.expectedDigest, 100).toLowerCase();
  const actualDigest = text(options.actualDigest, 100).toLowerCase();
  const requestedMaximumAgeMinutes = Number(options.maximumAgeMinutes || 15);
  const maximumAgeMinutes = Number.isFinite(requestedMaximumAgeMinutes)
    ? Math.min(1440, Math.max(1, requestedMaximumAgeMinutes))
    : 15;
  const maximumAgeMilliseconds = maximumAgeMinutes * 60 * 1000;
  const futureToleranceMilliseconds = 2 * 60 * 1000;
  const errors = [];

  if (!at) {
    addError(errors, "CARE_DEPENDENCY_EVIDENCE_CLOCK_INVALID", "", "readiness evaluation time is invalid");
  }
  if (text(manifest.schemaVersion, 120) !== EVIDENCE_SCHEMA_VERSION) {
    addError(errors, "CARE_DEPENDENCY_EVIDENCE_SCHEMA_INVALID", "", `schemaVersion must be ${EVIDENCE_SCHEMA_VERSION}`);
  }
  if (!expectedPolicyVersion || text(manifest.policyVersion, 120) !== expectedPolicyVersion) {
    addError(errors, "CARE_DEPENDENCY_EVIDENCE_POLICY_MISMATCH", "", "policyVersion does not match the running care-service policy");
  }
  if (text(manifest.environment, 40).toLowerCase() !== "production") {
    addError(errors, "CARE_DEPENDENCY_EVIDENCE_ENVIRONMENT_INVALID", "", "environment must explicitly be production");
  }
  if (!referenceReady(manifest.releaseId)) {
    addError(errors, "CARE_DEPENDENCY_EVIDENCE_RELEASE_ID_INVALID", "", "releaseId is missing or contains a placeholder value");
  }
  if (!DIGEST_PATTERN.test(expectedDigest) || expectedDigest !== actualDigest) {
    addError(errors, "CARE_DEPENDENCY_EVIDENCE_DIGEST_MISMATCH", "", "manifest file digest is missing or does not match the deployment-pinned digest");
  }

  const probes = Array.isArray(manifest.probes) ? manifest.probes : [];
  const probesByDependency = new Map();
  for (const probe of probes) {
    const dependency = text(probe?.dependency, 80).toLowerCase();
    if (!REQUIRED_DEPENDENCIES.includes(dependency)) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_TARGET_UNKNOWN", dependency, "probe dependency is not recognized");
      continue;
    }
    if (probesByDependency.has(dependency)) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_TARGET_DUPLICATE", dependency, "probe dependency appears more than once");
      continue;
    }
    probesByDependency.set(dependency, probe);
  }

  const receiptDigests = new Set();
  const targets = dependencyTargets(env);
  for (const dependency of REQUIRED_DEPENDENCIES) {
    const probe = probesByDependency.get(dependency);
    if (!probe) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_TARGET_MISSING", dependency, "required dependency probe is missing");
      continue;
    }
    if (!(targets[dependency] || []).some(Boolean)) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_TARGET_UNCONFIGURED", dependency, "dependency target is not configured");
    }
    if (text(probe.status, 40).toLowerCase() !== "healthy") {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_STATUS_UNHEALTHY", dependency, "probe status must explicitly be healthy");
    }
    if (!CHECK_TYPES.includes(text(probe.checkType, 80).toLowerCase())) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_CHECK_TYPE_INVALID", dependency, "checkType is not an allowed production probe type");
    }
    const expectedTargetDigest = targetDigestForDependency(env, dependency);
    if (text(probe.targetDigest, 100).toLowerCase() !== expectedTargetDigest) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_TARGET_MISMATCH", dependency, "probe is not bound to the currently configured dependency target");
    }
    if (!referenceReady(probe.receiptRef)) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_RECEIPT_REFERENCE_INVALID", dependency, "receiptRef is missing or contains a placeholder value");
    }
    const receiptDigest = text(probe.receiptDigest, 100).toLowerCase();
    if (!DIGEST_PATTERN.test(receiptDigest)) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_RECEIPT_DIGEST_INVALID", dependency, "receiptDigest must be a SHA-256 digest");
    } else if (receiptDigests.has(receiptDigest)) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_RECEIPT_DIGEST_REUSED", dependency, "each dependency must bind an independent probe receipt");
    } else {
      receiptDigests.add(receiptDigest);
    }
    const checkedAt = parseInstant(probe.checkedAt);
    const expiresAt = parseInstant(probe.expiresAt);
    if (!checkedAt) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_CHECKED_AT_INVALID", dependency, "checkedAt is missing or invalid");
    } else if (at && checkedAt.milliseconds > at.milliseconds + futureToleranceMilliseconds) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_CHECKED_IN_FUTURE", dependency, "checkedAt is later than the readiness evaluation clock");
    } else if (at && at.milliseconds - checkedAt.milliseconds > maximumAgeMilliseconds) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_STALE", dependency, `probe is older than ${maximumAgeMinutes} minutes`);
    }
    if (!expiresAt) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_EXPIRY_INVALID", dependency, "expiresAt is missing or invalid");
    } else if (at && expiresAt.milliseconds <= at.milliseconds) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_EXPIRED", dependency, "probe receipt has expired");
    } else if (checkedAt && expiresAt.milliseconds <= checkedAt.milliseconds) {
      addError(errors, "CARE_DEPENDENCY_EVIDENCE_EXPIRY_ORDER_INVALID", dependency, "expiresAt must be later than checkedAt");
    }
  }

  const globalErrors = errors.filter((error) => (
    !error.dependency || !REQUIRED_DEPENDENCIES.includes(error.dependency)
  ));
  const healthyDependencies = REQUIRED_DEPENDENCIES.filter((dependency) => (
    globalErrors.length === 0
    && !errors.some((error) => error.dependency === dependency)
  ));
  return {
    ok: errors.length === 0,
    schemaVersion: text(manifest.schemaVersion, 120) || null,
    policyVersion: text(manifest.policyVersion, 120) || null,
    releaseId: referenceReady(manifest.releaseId) ? text(manifest.releaseId, 240) : null,
    expectedDigest: DIGEST_PATTERN.test(expectedDigest) ? expectedDigest : null,
    actualDigest: DIGEST_PATTERN.test(actualDigest) ? actualDigest : null,
    requiredDependencies: [...REQUIRED_DEPENDENCIES],
    healthyDependencies,
    errors
  };
}

function loadDependencyEvidence(env = process.env, options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const fileValue = text(env.CARE_DEPENDENCY_EVIDENCE_FILE, 1000);
  const expectedDigest = text(env.CARE_DEPENDENCY_EVIDENCE_SHA256, 100);
  const validationOptions = {
    ...options,
    env,
    expectedDigest
  };
  if (!fileValue) {
    return validateDependencyEvidence({}, { ...validationOptions, actualDigest: "" });
  }
  const filePath = path.isAbsolute(fileValue) ? path.normalize(fileValue) : path.resolve(root, fileValue);
  let raw;
  try {
    raw = fs.readFileSync(filePath);
  } catch {
    const result = validateDependencyEvidence({}, { ...validationOptions, actualDigest: "" });
    result.errors.unshift({
      code: "CARE_DEPENDENCY_EVIDENCE_FILE_UNREADABLE",
      detail: "dependency evidence file cannot be read"
    });
    result.ok = false;
    result.healthyDependencies = [];
    return result;
  }
  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch {
    const result = validateDependencyEvidence({}, { ...validationOptions, actualDigest: sha256(raw) });
    result.errors.unshift({
      code: "CARE_DEPENDENCY_EVIDENCE_JSON_INVALID",
      detail: "dependency evidence file is not valid JSON"
    });
    result.ok = false;
    result.healthyDependencies = [];
    return result;
  }
  return validateDependencyEvidence(manifest, {
    ...validationOptions,
    actualDigest: sha256(raw)
  });
}

module.exports = {
  CHECK_TYPES,
  DIGEST_PATTERN,
  EVIDENCE_SCHEMA_VERSION,
  REQUIRED_DEPENDENCIES,
  dependencyTargets,
  loadDependencyEvidence,
  sha256,
  targetDigestForDependency,
  validateDependencyEvidence
};

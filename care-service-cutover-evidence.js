"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EVIDENCE_SCHEMA_VERSION = "care-service-cutover-evidence-v1";
const REQUIRED_SCOPES = Object.freeze(["business", "interface", "security", "dr", "oncall"]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PLACEHOLDER_PATTERN = /replace-with|change-me|changeme|placeholder|example|demo[-_]/i;

function text(value, maximum = 240) {
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

function evidenceReferenceReady(value) {
  const candidate = text(value, 500);
  return candidate.length >= 8 && !PLACEHOLDER_PATTERN.test(candidate);
}

function addError(errors, code, scope, detail) {
  errors.push({
    code,
    ...(scope ? { scope } : {}),
    detail
  });
}

function validateCutoverEvidence(manifestValue, options = {}) {
  const manifest = manifestValue && typeof manifestValue === "object" && !Array.isArray(manifestValue)
    ? manifestValue
    : {};
  const at = parseInstant(options.at || new Date().toISOString());
  const expectedPolicyVersion = text(options.policyVersion, 120);
  const expectedDigest = text(options.expectedDigest, 100).toLowerCase();
  const actualDigest = text(options.actualDigest, 100).toLowerCase();
  const requestedMaximumAgeDays = Number(options.maximumAgeDays || 30);
  const maximumAgeDays = Number.isFinite(requestedMaximumAgeDays)
    ? Math.min(365, Math.max(1, requestedMaximumAgeDays))
    : 30;
  const maximumAgeMilliseconds = maximumAgeDays * 24 * 60 * 60 * 1000;
  const futureToleranceMilliseconds = 5 * 60 * 1000;
  const errors = [];

  if (!at) {
    addError(errors, "CUTOVER_EVIDENCE_CLOCK_INVALID", "", "readiness evaluation time is invalid");
  }
  if (text(manifest.schemaVersion, 120) !== EVIDENCE_SCHEMA_VERSION) {
    addError(errors, "CUTOVER_EVIDENCE_SCHEMA_INVALID", "", `schemaVersion must be ${EVIDENCE_SCHEMA_VERSION}`);
  }
  if (!expectedPolicyVersion || text(manifest.policyVersion, 120) !== expectedPolicyVersion) {
    addError(errors, "CUTOVER_EVIDENCE_POLICY_MISMATCH", "", "policyVersion does not match the running care-service policy");
  }
  if (text(manifest.environment, 40).toLowerCase() !== "production") {
    addError(errors, "CUTOVER_EVIDENCE_ENVIRONMENT_INVALID", "", "environment must explicitly be production");
  }
  if (!evidenceReferenceReady(manifest.releaseId)) {
    addError(errors, "CUTOVER_EVIDENCE_RELEASE_ID_INVALID", "", "releaseId is missing or contains a placeholder value");
  }
  if (!DIGEST_PATTERN.test(expectedDigest) || expectedDigest !== actualDigest) {
    addError(errors, "CUTOVER_EVIDENCE_DIGEST_MISMATCH", "", "manifest file digest is missing or does not match the deployment-pinned digest");
  }

  const approvals = Array.isArray(manifest.approvals) ? manifest.approvals : [];
  const approvalsByScope = new Map();
  for (const approval of approvals) {
    const scope = text(approval?.scope, 40).toLowerCase();
    if (!REQUIRED_SCOPES.includes(scope)) {
      addError(errors, "CUTOVER_EVIDENCE_SCOPE_UNKNOWN", scope, "approval scope is not recognized");
      continue;
    }
    if (approvalsByScope.has(scope)) {
      addError(errors, "CUTOVER_EVIDENCE_SCOPE_DUPLICATE", scope, "approval scope appears more than once");
      continue;
    }
    approvalsByScope.set(scope, approval);
  }

  const signerIds = new Set();
  const evidenceDigests = new Set();
  for (const scope of REQUIRED_SCOPES) {
    const approval = approvalsByScope.get(scope);
    if (!approval) {
      addError(errors, "CUTOVER_EVIDENCE_SCOPE_MISSING", scope, "required approval is missing");
      continue;
    }
    if (text(approval.decision, 40).toLowerCase() !== "approved") {
      addError(errors, "CUTOVER_EVIDENCE_DECISION_INVALID", scope, "decision must explicitly be approved");
    }
    const signerId = text(approval.signerId, 160);
    if (!signerId || PLACEHOLDER_PATTERN.test(signerId)) {
      addError(errors, "CUTOVER_EVIDENCE_SIGNER_INVALID", scope, "signerId is missing or contains a placeholder value");
    } else if (signerIds.has(signerId)) {
      addError(errors, "CUTOVER_EVIDENCE_SIGNER_REUSED", scope, "the same signer cannot approve more than one independent scope");
    } else {
      signerIds.add(signerId);
    }
    if (!evidenceReferenceReady(approval.evidenceRef)) {
      addError(errors, "CUTOVER_EVIDENCE_REFERENCE_INVALID", scope, "evidenceRef is missing or contains a placeholder value");
    }
    const evidenceDigest = text(approval.evidenceDigest, 100).toLowerCase();
    if (!DIGEST_PATTERN.test(evidenceDigest)) {
      addError(errors, "CUTOVER_EVIDENCE_ARCHIVE_DIGEST_INVALID", scope, "evidenceDigest must be a SHA-256 digest");
    } else if (evidenceDigests.has(evidenceDigest)) {
      addError(errors, "CUTOVER_EVIDENCE_ARCHIVE_DIGEST_REUSED", scope, "each approval must bind an independently archived evidence packet");
    } else {
      evidenceDigests.add(evidenceDigest);
    }
    const signedAt = parseInstant(approval.signedAt);
    const expiresAt = parseInstant(approval.expiresAt);
    if (!signedAt) {
      addError(errors, "CUTOVER_EVIDENCE_SIGNED_AT_INVALID", scope, "signedAt is missing or invalid");
    } else if (at && signedAt.milliseconds > at.milliseconds + futureToleranceMilliseconds) {
      addError(errors, "CUTOVER_EVIDENCE_SIGNED_IN_FUTURE", scope, "signedAt is later than the readiness evaluation clock");
    } else if (at && at.milliseconds - signedAt.milliseconds > maximumAgeMilliseconds) {
      addError(errors, "CUTOVER_EVIDENCE_STALE", scope, `approval is older than ${maximumAgeDays} days`);
    }
    if (!expiresAt) {
      addError(errors, "CUTOVER_EVIDENCE_EXPIRY_INVALID", scope, "expiresAt is missing or invalid");
    } else if (at && expiresAt.milliseconds <= at.milliseconds) {
      addError(errors, "CUTOVER_EVIDENCE_EXPIRED", scope, "approval has expired");
    } else if (signedAt && expiresAt.milliseconds <= signedAt.milliseconds) {
      addError(errors, "CUTOVER_EVIDENCE_EXPIRY_ORDER_INVALID", scope, "expiresAt must be later than signedAt");
    }
  }

  return {
    ok: errors.length === 0,
    schemaVersion: text(manifest.schemaVersion, 120) || null,
    policyVersion: text(manifest.policyVersion, 120) || null,
    releaseId: evidenceReferenceReady(manifest.releaseId) ? text(manifest.releaseId, 240) : null,
    expectedDigest: DIGEST_PATTERN.test(expectedDigest) ? expectedDigest : null,
    actualDigest: DIGEST_PATTERN.test(actualDigest) ? actualDigest : null,
    requiredScopes: [...REQUIRED_SCOPES],
    approvedScopes: REQUIRED_SCOPES.filter((scope) => !errors.some((error) => error.scope === scope)),
    errors
  };
}

function loadCutoverEvidence(env = process.env, options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const fileValue = text(env.CARE_CUTOVER_EVIDENCE_FILE, 1000);
  const expectedDigest = text(env.CARE_CUTOVER_EVIDENCE_SHA256, 100);
  if (!fileValue) {
    return validateCutoverEvidence({}, {
      ...options,
      expectedDigest,
      actualDigest: ""
    });
  }
  const filePath = path.isAbsolute(fileValue) ? path.normalize(fileValue) : path.resolve(root, fileValue);
  let raw;
  try {
    raw = fs.readFileSync(filePath);
  } catch {
    const result = validateCutoverEvidence({}, {
      ...options,
      expectedDigest,
      actualDigest: ""
    });
    result.errors.unshift({
      code: "CUTOVER_EVIDENCE_FILE_UNREADABLE",
      detail: "cutover evidence file cannot be read"
    });
    result.ok = false;
    return result;
  }
  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch {
    const result = validateCutoverEvidence({}, {
      ...options,
      expectedDigest,
      actualDigest: sha256(raw)
    });
    result.errors.unshift({
      code: "CUTOVER_EVIDENCE_JSON_INVALID",
      detail: "cutover evidence file is not valid JSON"
    });
    result.ok = false;
    return result;
  }
  return validateCutoverEvidence(manifest, {
    ...options,
    expectedDigest,
    actualDigest: sha256(raw)
  });
}

module.exports = {
  DIGEST_PATTERN,
  EVIDENCE_SCHEMA_VERSION,
  REQUIRED_SCOPES,
  loadCutoverEvidence,
  sha256,
  validateCutoverEvidence
};

"use strict";

const { createHash } = require("node:crypto");

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_FIELD = /(?:password|secret|token|credential|privateKey|patient|resident|diagnosis|payload|clinicalDetail)/i;
const PERMITTED_BOUNDARY_FIELDS = new Set([
  "clinicalDataExposed",
  "credentialsExposed",
  "patientDataExposed",
  "patientDataIncluded",
  "payloadsExposed",
  "residentConsent",
  "residentDataExposed",
  "secretsExposed",
  "secretsIncluded"
]);

function evidenceError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : stableStringify(value)
  ).digest("hex")}`;
}

function assertMetadataOnly(value, location = "evidence") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataOnly(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_FIELD.test(key) && !PERMITTED_BOUNDARY_FIELDS.has(key)) {
      throw evidenceError(
        "TECHNICAL_EVIDENCE_SENSITIVE_FIELD",
        `${location}.${key} is forbidden in technical evidence`
      );
    }
    assertMetadataOnly(item, `${location}.${key}`);
  }
}

function createTechnicalEvidenceFingerprint(schema, projection) {
  const normalizedSchema = String(schema || "").trim();
  if (!normalizedSchema) {
    throw evidenceError("TECHNICAL_EVIDENCE_SCHEMA_REQUIRED", "technical evidence schema is required");
  }
  assertMetadataOnly(projection);
  return sha256({ schema: normalizedSchema, projection });
}

module.exports = {
  SHA256,
  assertMetadataOnly,
  createTechnicalEvidenceFingerprint,
  sha256,
  stableStringify
};

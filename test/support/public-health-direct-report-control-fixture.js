"use strict";

const { generateKeyPairSync, sign } = require("node:crypto");
const {
  CONTRACT,
  evidenceSubject,
  evaluateDirectReportActivationControl,
  normalizeDictionary,
  sha256
} = require("../../public-health-direct-report-control-package");

const NOW_MS = Date.parse("2026-08-05T08:30:00.000Z");

function buildDictionary() {
  const codeValues = {
    institution: ["210200001"],
    "report-type": ["infectious-disease-case"],
    disease: ["A15"],
    "laboratory-test": ["TB-PCR"],
    "result-flag": ["positive"]
  };
  return {
    schemaVersion: "public-health-direct-report-dictionary-v1",
    dictionaryId: "synthetic-direct-report-dictionary",
    version: "2026.08.05-joint-test",
    contractId: CONTRACT.contractId,
    status: "approved",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    sourceRef: "cmdb://public-health/direct-report/dictionary/2026.08.05",
    fieldMappings: [...CONTRACT.requiredFields, ...CONTRACT.optionalFields].map((field) => ({
      platformField: field,
      officialField: `official_${field}`,
      required: CONTRACT.requiredFields.includes(field),
      codeSystem: {
        institutionCode: "institution",
        reportType: "report-type",
        diseaseCode: "disease",
        testCode: "laboratory-test",
        resultFlag: "result-flag"
      }[field] || ""
    })),
    codeSystems: CONTRACT.requiredCodeSystems.map((id) => ({
      id,
      version: "synthetic-2026.08.05",
      digest: sha256(`synthetic-code-system:${id}`),
      sourceRef: `cmdb://public-health/direct-report/code-system/${id}`,
      codes: codeValues[id]
    }))
  };
}

function buildControlFixture(options = {}) {
  const dictionary = options.dictionary || buildDictionary();
  const normalized = normalizeDictionary(dictionary, { nowMs: NOW_MS });
  const roles = CONTRACT.requiredSignerRoles;
  const keyPairs = roles.map((role, index) => {
    const pair = generateKeyPairSync("ed25519");
    return {
      role,
      keyId: `synthetic-${role}-${index + 1}`,
      privateKey: pair.privateKey,
      publicKeyPem: pair.publicKey.export({ format: "pem", type: "spki" }).toString()
    };
  });
  const trustRegistry = {
    schemaVersion: "public-health-direct-report-trust-registry-v1",
    registryId: "synthetic-direct-report-trust-registry",
    keys: keyPairs.map((item) => ({
      keyId: item.keyId,
      role: item.role,
      algorithm: "Ed25519",
      status: "active",
      validFrom: "2026-08-01T00:00:00.000Z",
      validUntil: "2026-09-01T00:00:00.000Z",
      publicKeyPem: item.publicKeyPem
    }))
  };
  const evidence = {
    schemaVersion: "public-health-direct-report-joint-test-evidence-v1",
    packageId: "synthetic-direct-report-joint-test-20260805",
    contractId: CONTRACT.contractId,
    dictionaryDigest: normalized.dictionaryDigest,
    mappingFingerprint: normalized.mappingFingerprint,
    executedAt: "2026-08-05T08:00:00.000Z",
    expiresAt: "2026-08-12T08:00:00.000Z",
    scenarios: CONTRACT.requiredScenarios.map((id, index) => ({
      id,
      result: "passed",
      runId: `synthetic-run-${index + 1}`,
      requestDigest: sha256(`request:${id}`),
      responseDigest: sha256(`response:${id}`),
      traceRef: `evidence://public-health/direct-report/${id}/trace`,
      receiptRef: `evidence://public-health/direct-report/${id}/receipt`
    }))
  };
  const subjectDigest = evidenceSubject(evidence);
  evidence.attestations = keyPairs.map((item) => ({
    role: item.role,
    keyId: item.keyId,
    algorithm: "Ed25519",
    subjectDigest,
    signature: sign(null, Buffer.from(subjectDigest, "utf8"), item.privateKey).toString("base64url")
  }));
  return {
    dictionary,
    evidence,
    trustRegistry,
    nowMs: NOW_MS,
    activationControl: evaluateDirectReportActivationControl(
      { dictionary, evidence, trustRegistry },
      { nowMs: NOW_MS }
    )
  };
}

module.exports = {
  NOW_MS,
  buildControlFixture,
  buildDictionary
};

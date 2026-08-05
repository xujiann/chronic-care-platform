"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, createPublicKey, verify } = require("node:crypto");

const CONTRACT = require("./config/public-health-direct-report-control-package.json");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{1,119}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{80,160}$/;
const CONTROLLED_REFERENCE = /^(?:artifact|cmdb|evidence|ticket|vault):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const FORBIDDEN_KEYS = /(?:password|token|secret|privatekey|residentid|idcard|phone|name|address|payload|rawmessage)/i;

class DirectReportControlError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "DirectReportControlError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(
    typeof value === "string" ? value : stableStringify(value)
  ).digest("hex");
}

function clean(value, maximum = 240) {
  return String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function time(value, label) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_TIME_INVALID",
      `${label} must be a valid date-time`
    );
  }
  return new Date(parsed).toISOString();
}

function assertMetadataOnly(value, label = "controlPackage", currentPath = label) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataOnly(item, label, `${currentPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_KEYS.test(key) && key !== "publicKeyPem") {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_SENSITIVE_FIELD",
        `${currentPath}.${key} is not allowed in control metadata`
      );
    }
    assertMetadataOnly(item, label, `${currentPath}.${key}`);
  });
}

function readBoundedControlFile(file, label) {
  const input = String(file || "");
  if (!path.isAbsolute(input)) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_FILE_NOT_ABSOLUTE",
      `${label} file must use an absolute path`,
      503
    );
  }
  const resolved = path.resolve(input);
  let link;
  try {
    link = fs.lstatSync(resolved);
  } catch {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_FILE_UNAVAILABLE",
      `${label} file is unavailable`,
      503
    );
  }
  if (link.isSymbolicLink()) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_FILE_SYMLINK_REJECTED",
      `${label} file must not be a symbolic link`,
      503
    );
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_FILE_BYTES) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_FILE_INVALID",
      `${label} file must be a bounded regular file`,
      503
    );
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_JSON_INVALID",
      `${label} file must contain valid JSON`,
      503
    );
  }
  assertMetadataOnly(value, label);
  return value;
}

function normalizeDictionary(input = {}, options = {}) {
  assertMetadataOnly(input, "dictionary");
  const fieldMappings = Array.isArray(input.fieldMappings) ? input.fieldMappings : [];
  const codeSystems = Array.isArray(input.codeSystems) ? input.codeSystems : [];
  if (
    input.schemaVersion !== "public-health-direct-report-dictionary-v1"
    || input.contractId !== CONTRACT.contractId
    || !IDENTIFIER.test(clean(input.dictionaryId, 160))
    || !IDENTIFIER.test(clean(input.version, 80))
    || input.status !== "approved"
  ) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_INVALID",
      "direct-report dictionary identity, contract or approval status is invalid"
    );
  }
  const effectiveAt = time(input.effectiveAt, "dictionary effectiveAt");
  const expiresAt = time(input.expiresAt, "dictionary expiresAt");
  const nowMs = Number(options.nowMs ?? Date.now());
  if (Date.parse(effectiveAt) > nowMs || Date.parse(expiresAt) <= nowMs) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_NOT_ACTIVE",
      "direct-report dictionary is not active at the evaluation time",
      409
    );
  }
  if (!CONTROLLED_REFERENCE.test(clean(input.sourceRef, 400))) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_SOURCE_INVALID",
      "direct-report dictionary requires a controlled source reference"
    );
  }
  const mappingByPlatformField = new Map();
  const officialFields = new Set();
  fieldMappings.forEach((item) => {
    const platformField = clean(item.platformField, 120);
    const officialField = clean(item.officialField, 120);
    const codeSystem = clean(item.codeSystem, 120);
    if (
      !FIELD.test(platformField)
      || !FIELD.test(officialField)
      || (codeSystem && !CONTRACT.requiredCodeSystems.includes(codeSystem))
      || mappingByPlatformField.has(platformField)
      || officialFields.has(officialField)
    ) {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_FIELD_MAPPING_INVALID",
        `direct-report field mapping is invalid for ${platformField || "missing-field"}`
      );
    }
    mappingByPlatformField.set(platformField, {
      platformField,
      officialField,
      required: item.required === true,
      codeSystem
    });
    officialFields.add(officialField);
  });
  const expectedFields = [...CONTRACT.requiredFields, ...CONTRACT.optionalFields];
  if (
    mappingByPlatformField.size !== expectedFields.length
    || expectedFields.some((field) => !mappingByPlatformField.has(field))
    || CONTRACT.requiredFields.some((field) => mappingByPlatformField.get(field)?.required !== true)
  ) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_FIELD_MAPPING_INCOMPLETE",
      "direct-report dictionary does not map every required and optional contract field"
    );
  }
  const normalizedCodeSystems = codeSystems.map((item) => {
    const id = clean(item.id, 120);
    const codes = [...new Set((Array.isArray(item.codes) ? item.codes : []).map((code) => clean(code, 120)))];
    if (
      !CONTRACT.requiredCodeSystems.includes(id)
      || !IDENTIFIER.test(clean(item.version, 80))
      || !SHA256.test(clean(item.digest, 64))
      || !CONTROLLED_REFERENCE.test(clean(item.sourceRef, 400))
      || !codes.length
      || codes.some((code) => !CODE.test(code))
    ) {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_CODE_SYSTEM_INVALID",
        `direct-report code system is invalid for ${id || "missing-system"}`
      );
    }
    return {
      id,
      version: clean(item.version, 80),
      digest: clean(item.digest, 64),
      sourceRef: clean(item.sourceRef, 400),
      codes: codes.sort()
    };
  });
  if (
    normalizedCodeSystems.length !== CONTRACT.requiredCodeSystems.length
    || new Set(normalizedCodeSystems.map((item) => item.id)).size !== CONTRACT.requiredCodeSystems.length
    || CONTRACT.requiredCodeSystems.some((id) => !normalizedCodeSystems.some((item) => item.id === id))
  ) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_CODE_SYSTEM_INCOMPLETE",
      "direct-report dictionary does not contain every required code system"
    );
  }
  const dictionary = {
    schemaVersion: input.schemaVersion,
    dictionaryId: clean(input.dictionaryId, 160),
    version: clean(input.version, 80),
    contractId: input.contractId,
    status: "approved",
    effectiveAt,
    expiresAt,
    sourceRef: clean(input.sourceRef, 400),
    fieldMappings: [...mappingByPlatformField.values()]
      .sort((left, right) => left.platformField.localeCompare(right.platformField)),
    codeSystems: normalizedCodeSystems.sort((left, right) => left.id.localeCompare(right.id))
  };
  return {
    dictionary,
    dictionaryDigest: sha256(dictionary),
    mappingFingerprint: sha256({
      contractId: dictionary.contractId,
      fieldMappings: dictionary.fieldMappings,
      codeSystems: dictionary.codeSystems.map(({ id, version, digest }) => ({ id, version, digest }))
    })
  };
}

function codeSystemFor(dictionary, id) {
  return dictionary.codeSystems.find((item) => item.id === id);
}

function validatePayloadAgainstDictionary(payload = {}, dictionaryInput = {}, options = {}) {
  const normalized = dictionaryInput.dictionary
    ? dictionaryInput
    : normalizeDictionary(dictionaryInput, options);
  const { dictionary } = normalized;
  CONTRACT.requiredFields.forEach((field) => {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_REQUIRED_FIELD",
        `direct-report payload is missing dictionary field ${field}`,
        422
      );
    }
  });
  const mappingByField = new Map(dictionary.fieldMappings.map((item) => [item.platformField, item]));
  Object.keys(payload).forEach((field) => {
    if (!mappingByField.has(field)) {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_FIELD_UNMAPPED",
        `direct-report payload field ${field} is not mapped by the active dictionary`,
        422
      );
    }
  });
  const codeBindings = {
    institutionCode: "institution",
    reportType: "report-type",
    diseaseCode: "disease",
    testCode: "laboratory-test",
    resultFlag: "result-flag"
  };
  Object.entries(codeBindings).forEach(([field, systemId]) => {
    const code = clean(payload[field], 120);
    if (!codeSystemFor(dictionary, systemId)?.codes.includes(code)) {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_CODE_REJECTED",
        `direct-report ${field} is not present in active code system ${systemId}`,
        422
      );
    }
  });
  return {
    ok: true,
    dictionaryId: dictionary.dictionaryId,
    dictionaryVersion: dictionary.version,
    dictionaryDigest: normalized.dictionaryDigest,
    mappingFingerprint: normalized.mappingFingerprint,
    productionReady: false
  };
}

function normalizeTrustRegistry(input = {}, options = {}) {
  assertMetadataOnly(input, "trustRegistry");
  if (
    input.schemaVersion !== "public-health-direct-report-trust-registry-v1"
    || !IDENTIFIER.test(clean(input.registryId, 160))
  ) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_TRUST_REGISTRY_INVALID",
      "direct-report trust registry identity is invalid"
    );
  }
  const nowMs = Number(options.nowMs ?? Date.now());
  const keys = (Array.isArray(input.keys) ? input.keys : []).map((item) => {
    const key = {
      keyId: clean(item.keyId, 160),
      role: clean(item.role, 120),
      algorithm: clean(item.algorithm, 40),
      status: clean(item.status, 40),
      validFrom: time(item.validFrom, "trust key validFrom"),
      validUntil: time(item.validUntil, "trust key validUntil"),
      publicKeyPem: String(item.publicKeyPem || "").trim()
    };
    if (
      !IDENTIFIER.test(key.keyId)
      || !CONTRACT.requiredSignerRoles.includes(key.role)
      || key.algorithm !== "Ed25519"
      || key.status !== "active"
      || Date.parse(key.validFrom) > nowMs
      || Date.parse(key.validUntil) <= nowMs
    ) {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_TRUST_KEY_INVALID",
        `direct-report trust key ${key.keyId || "missing-key"} is invalid or inactive`
      );
    }
    let publicKey;
    try {
      publicKey = createPublicKey(key.publicKeyPem);
      if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("not-ed25519");
    } catch {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_TRUST_KEY_INVALID",
        `direct-report trust key ${key.keyId} is not a valid public key`
      );
    }
    return {
      ...key,
      publicKeyFingerprint: createHash("sha256")
        .update(publicKey.export({ format: "der", type: "spki" }))
        .digest("hex")
    };
  });
  if (new Set(keys.map((item) => item.publicKeyFingerprint)).size !== keys.length) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_TRUST_KEY_REUSED",
      "direct-report signer roles must not reuse the same Ed25519 public key"
    );
  }
  if (
    keys.length < CONTRACT.requiredSignerRoles.length
    || new Set(keys.map((item) => item.keyId)).size !== keys.length
  ) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_TRUST_REGISTRY_INCOMPLETE",
      "direct-report trust registry does not contain independent active keys"
    );
  }
  return { registryId: clean(input.registryId, 160), keys };
}

function evidenceSubject(evidence = {}) {
  const { attestations, ...subject } = evidence;
  return sha256(subject);
}

function normalizeJointTestEvidence(input = {}, dictionaryResult, trustInput = {}, options = {}) {
  assertMetadataOnly(input, "jointTestEvidence");
  const trust = normalizeTrustRegistry(trustInput, options);
  const executedAt = time(input.executedAt, "joint-test executedAt");
  const expiresAt = time(input.expiresAt, "joint-test expiresAt");
  const nowMs = Number(options.nowMs ?? Date.now());
  const maximumAgeMs = Number(CONTRACT.maximumEvidenceAgeHours) * 60 * 60 * 1000;
  if (
    input.schemaVersion !== "public-health-direct-report-joint-test-evidence-v1"
    || !IDENTIFIER.test(clean(input.packageId, 160))
    || input.contractId !== CONTRACT.contractId
    || input.dictionaryDigest !== dictionaryResult.dictionaryDigest
    || input.mappingFingerprint !== dictionaryResult.mappingFingerprint
    || Date.parse(executedAt) > nowMs
    || Date.parse(expiresAt) <= nowMs
    || nowMs - Date.parse(executedAt) > maximumAgeMs
  ) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_EVIDENCE_INVALID",
      "direct-report joint-test evidence identity, dictionary binding or validity window is invalid"
    );
  }
  const scenarios = (Array.isArray(input.scenarios) ? input.scenarios : []).map((item) => {
    const scenario = {
      id: clean(item.id, 120),
      result: clean(item.result, 40),
      runId: clean(item.runId, 160),
      requestDigest: clean(item.requestDigest, 64),
      responseDigest: clean(item.responseDigest, 64),
      traceRef: clean(item.traceRef, 400),
      receiptRef: clean(item.receiptRef, 400)
    };
    if (
      !CONTRACT.requiredScenarios.includes(scenario.id)
      || scenario.result !== "passed"
      || !IDENTIFIER.test(scenario.runId)
      || !SHA256.test(scenario.requestDigest)
      || !SHA256.test(scenario.responseDigest)
      || !CONTROLLED_REFERENCE.test(scenario.traceRef)
      || !CONTROLLED_REFERENCE.test(scenario.receiptRef)
    ) {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_SCENARIO_INVALID",
        `direct-report joint-test scenario ${scenario.id || "missing-scenario"} is invalid`
      );
    }
    return scenario;
  });
  if (
    scenarios.length !== CONTRACT.requiredScenarios.length
    || new Set(scenarios.map((item) => item.id)).size !== CONTRACT.requiredScenarios.length
    || new Set(scenarios.map((item) => item.runId)).size !== CONTRACT.requiredScenarios.length
  ) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_SCENARIOS_INCOMPLETE",
      "direct-report joint-test evidence does not contain every required scenario"
    );
  }
  const subjectDigest = evidenceSubject(input);
  const attestations = (Array.isArray(input.attestations) ? input.attestations : []).map((item) => {
    const role = clean(item.role, 120);
    const keyId = clean(item.keyId, 160);
    const key = trust.keys.find((candidate) => candidate.keyId === keyId && candidate.role === role);
    if (
      !key
      || item.algorithm !== "Ed25519"
      || item.subjectDigest !== subjectDigest
      || !SIGNATURE.test(clean(item.signature, 180))
    ) {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_ATTESTATION_INVALID",
        `direct-report joint-test attestation for ${role || "missing-role"} is invalid`
      );
    }
    const valid = verify(
      null,
      Buffer.from(subjectDigest, "utf8"),
      createPublicKey(key.publicKeyPem),
      Buffer.from(item.signature, "base64url")
    );
    if (!valid) {
      throw new DirectReportControlError(
        "PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_SIGNATURE_INVALID",
        `direct-report joint-test signature for ${role} is invalid`
      );
    }
    return { role, keyId, subjectDigest, signatureVerified: true };
  });
  if (
    attestations.length !== CONTRACT.requiredSignerRoles.length
    || new Set(attestations.map((item) => item.role)).size !== attestations.length
    || new Set(attestations.map((item) => item.keyId)).size !== attestations.length
    || CONTRACT.requiredSignerRoles.some(
      (role) => !attestations.some((item) => item.role === role)
    )
  ) {
    throw new DirectReportControlError(
      "PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_SIGNOFF_INCOMPLETE",
      "direct-report joint-test evidence requires independent business and hospital signoff"
    );
  }
  return {
    packageId: clean(input.packageId, 160),
    executedAt,
    expiresAt,
    scenarios: scenarios.sort((left, right) => left.id.localeCompare(right.id)),
    attestations,
    subjectDigest
  };
}

function evaluateDirectReportActivationControl(input = {}, options = {}) {
  const dictionary = normalizeDictionary(input.dictionary, options);
  const evidence = normalizeJointTestEvidence(
    input.evidence,
    dictionary,
    input.trustRegistry,
    options
  );
  return {
    activationReady: true,
    codeReady: true,
    dictionary: dictionary.dictionary,
    dictionaryId: dictionary.dictionary.dictionaryId,
    dictionaryVersion: dictionary.dictionary.version,
    dictionaryDigest: dictionary.dictionaryDigest,
    mappingFingerprint: dictionary.mappingFingerprint,
    evidencePackageId: evidence.packageId,
    evidenceExecutedAt: evidence.executedAt,
    evidenceExpiresAt: evidence.expiresAt,
    scenariosPassed: evidence.scenarios.length,
    scenariosRequired: CONTRACT.requiredScenarios.length,
    signerRoles: evidence.attestations.map((item) => item.role).sort(),
    credentialsExposed: false,
    payloadsExposed: false,
    productionReady: false,
    boundary: "Worker activation controls are satisfied; production cutover still requires the global site Go/No-Go decision."
  };
}

function safeControlStatus(input = {}, options = {}) {
  try {
    const result = evaluateDirectReportActivationControl(input, options);
    const { dictionary, ...safe } = result;
    return safe;
  } catch (error) {
    return {
      activationReady: false,
      codeReady: true,
      dictionaryId: "",
      dictionaryVersion: "",
      dictionaryDigest: "",
      mappingFingerprint: "",
      evidencePackageId: "",
      scenariosPassed: 0,
      scenariosRequired: CONTRACT.requiredScenarios.length,
      signerRoles: [],
      blockerCode: clean(error?.code || "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_UNAVAILABLE", 120),
      credentialsExposed: false,
      payloadsExposed: false,
      productionReady: false
    };
  }
}

function blockedControlStatus(error) {
  return {
    activationReady: false,
    codeReady: true,
    dictionaryId: "",
    dictionaryVersion: "",
    dictionaryDigest: "",
    mappingFingerprint: "",
    evidencePackageId: "",
    scenariosPassed: 0,
    scenariosRequired: CONTRACT.requiredScenarios.length,
    signerRoles: [],
    blockerCode: clean(error?.code || "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_UNAVAILABLE", 120),
    credentialsExposed: false,
    payloadsExposed: false,
    productionReady: false
  };
}

function configuredControlPaths(env = process.env) {
  return {
    dictionaryFile: clean(env.PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_FILE, 600),
    evidenceFile: clean(env.PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_EVIDENCE_FILE, 600),
    trustRegistryFile: clean(env.PUBLIC_HEALTH_DIRECT_REPORT_TRUST_REGISTRY_FILE, 600)
  };
}

function loadDirectReportActivationControl(env = process.env, options = {}) {
  const files = configuredControlPaths(env);
  return evaluateDirectReportActivationControl({
    dictionary: readBoundedControlFile(files.dictionaryFile, "dictionary"),
    evidence: readBoundedControlFile(files.evidenceFile, "joint-test evidence"),
    trustRegistry: readBoundedControlFile(files.trustRegistryFile, "trust registry")
  }, options);
}

function publicDirectReportControlStatus(env = process.env, options = {}) {
  const files = configuredControlPaths(env);
  if (Object.values(files).some((value) => !value)) {
    return blockedControlStatus({
      code: "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_FILES_REQUIRED"
    });
  }
  try {
    const result = loadDirectReportActivationControl(env, options);
    const { dictionary, ...safe } = result;
    return safe;
  } catch (error) {
    return blockedControlStatus(error);
  }
}

module.exports = {
  CONTRACT,
  DirectReportControlError,
  blockedControlStatus,
  configuredControlPaths,
  evaluateDirectReportActivationControl,
  evidenceSubject,
  loadDirectReportActivationControl,
  normalizeDictionary,
  normalizeJointTestEvidence,
  normalizeTrustRegistry,
  publicDirectReportControlStatus,
  readBoundedControlFile,
  safeControlStatus,
  sha256,
  stableStringify,
  validatePayloadAgainstDictionary
};

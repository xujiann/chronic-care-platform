const { createHash } = require("node:crypto");

const MODULE_ID = "clinical-blood";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const BAG_ID = /^(?<donation>[A-Z0-9]{13})-(?<component>[A-Z0-9]{3,8})-(?<sequence>\d{2})$/;
const FORBIDDEN_DEPENDENCIES = ["emergency", "imaging", "exam", "physical-exam"];

const manifest = Object.freeze({
  moduleId: MODULE_ID,
  deploymentMode: "standalone",
  requiredDependencies: ["identity", "mpi", "his", "lis", "pda", "iot", "audit"],
  forbiddenDependencies: FORBIDDEN_DEPENDENCIES
});

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function validateBagId(value) {
  const match = BAG_ID.exec(String(value || ""));
  return match ? { valid: true, ...match.groups } : { valid: false, reason: "bag id must be DONATION-COMPONENT-SEQUENCE" };
}

function validateMasterData(payload = {}) {
  const errors = [];
  if (!payload.organizationCode) errors.push("organizationCode is required");
  if (!payload.system || !["BIS", "BTIS"].includes(payload.system)) errors.push("system must be BIS or BTIS");
  if (!payload.code || !payload.name) errors.push("code and name are required");
  if (!payload.version || !payload.effectiveAt) errors.push("version and effectiveAt are required");
  return { valid: errors.length === 0, errors };
}

function validateMasterDataMappings(records = []) {
  const errors = [];
  const keys = new Map();
  records.forEach((item, index) => {
    const validation = validateMasterData(item);
    validation.errors.forEach((error) => errors.push(`record[${index}]: ${error}`));
    const key = `${item.organizationCode || ""}:${item.system || ""}:${item.code || ""}`;
    if (keys.has(key) && keys.get(key) !== item.name) errors.push(`conflicting name for ${key}`);
    keys.set(key, item.name);
  });
  const sharedCodes = new Set(records.filter((item) => item.system === "BIS").map((item) => item.code));
  if (![...sharedCodes].some((code) => records.some((item) => item.system === "BTIS" && item.code === code))) {
    errors.push("BIS and BTIS require at least one shared mapped code");
  }
  for (const code of sharedCodes) {
    const names = new Set(records.filter((item) => item.code === code).map((item) => item.name));
    if (names.size > 1) errors.push(`BIS/BTIS mapped code ${code} has conflicting names`);
  }
  return { valid: errors.length === 0, errors };
}

function validateReceipt(receipt = {}) {
  const errors = [];
  if (!receipt.evidenceRef) errors.push("evidenceRef is required");
  if (!SHA256.test(String(receipt.evidenceDigest || ""))) errors.push("valid SHA-256 evidenceDigest is required");
  if (!receipt.organizationCode || !receipt.signedBy || !receipt.signedAt) errors.push("organizationCode, signedBy and signedAt are required");
  if (!receipt.verifiedBy || !receipt.verifiedAt || receipt.verifiedBy === receipt.signedBy) {
    errors.push("independent receipt verification is required");
  }
  if (!receipt.correlationId || !receipt.idempotencyKey) errors.push("correlationId and idempotencyKey are required");
  return { valid: errors.length === 0, errors };
}

function validateColdChainEvidence(evidence = {}, asOf = new Date()) {
  const errors = [];
  if (!evidence.deviceId || !evidence.serialNumber) errors.push("deviceId and serialNumber are required");
  if (!evidence.calibrationCertificateRef || !SHA256.test(String(evidence.calibrationDigest || ""))) {
    errors.push("calibration certificate and digest are required");
  }
  const calibratedAt = Date.parse(evidence.calibratedAt);
  const expiresAt = Date.parse(evidence.calibrationExpiresAt);
  if (!Number.isFinite(calibratedAt) || !Number.isFinite(expiresAt) || expiresAt <= calibratedAt) {
    errors.push("valid calibration period is required");
  }
  if (Number.isFinite(expiresAt) && expiresAt < new Date(asOf).getTime()) errors.push("calibration certificate has expired");
  if (evidence.alarmTestResult !== "passed" || !evidence.alarmEvidenceRef) errors.push("passed alarm test evidence is required");
  if (!evidence.verifiedBy || evidence.verifiedBy === evidence.performedBy) errors.push("independent verification is required");
  return { valid: errors.length === 0, errors };
}

function submitReceipt(state, payload = {}, actor = {}) {
  const data = state || seedProductionEvidence();
  if (!Array.isArray(data.siteReceipts)) data.siteReceipts = [];
  const existing = data.siteReceipts.find((item) => item.idempotencyKey === payload.idempotencyKey);
  if (existing) {
    if (existing.evidenceDigest !== payload.evidenceDigest) throw new Error("idempotency key replay has different evidence digest");
    return existing;
  }
  const draft = {
    ...payload,
    signedBy: actor.id || actor.username || actor.name,
    signedAt: new Date().toISOString(),
    status: "submitted"
  };
  const validation = validateReceipt({ ...draft, verifiedBy: "pending-verifier", verifiedAt: draft.signedAt });
  const nonVerificationErrors = validation.errors.filter((error) => error !== "independent receipt verification is required");
  if (nonVerificationErrors.length) throw new Error(nonVerificationErrors.join("; "));
  data.siteReceipts.push(draft);
  return draft;
}

function verifyReceipt(state, idempotencyKey, actor = {}, evidenceDigest) {
  const data = state || seedProductionEvidence();
  const receipt = data.siteReceipts?.find((item) => item.idempotencyKey === idempotencyKey);
  if (!receipt) throw new Error("site receipt not found");
  const verifier = actor.id || actor.username || actor.name;
  if (!verifier || verifier === receipt.signedBy) throw new Error("independent verifier is required");
  if (receipt.evidenceDigest !== evidenceDigest) throw new Error("evidence digest mismatch");
  if (receipt.status === "verified") return receipt;
  Object.assign(receipt, { status: "verified", verifiedBy: verifier, verifiedAt: new Date().toISOString() });
  return receipt;
}

function validateAcceptanceScenario(scenario = {}) {
  const errors = [];
  const common = ["scenarioId", "patientId", "bagId", "evidenceRef"];
  common.forEach((field) => { if (!scenario[field]) errors.push(`${field} is required`); });
  if (!validateBagId(scenario.bagId).valid) errors.push("valid bagId is required");

  if (scenario.type === "dual-person-crossmatch") {
    if (!scenario.operatorA || !scenario.operatorB || scenario.operatorA === scenario.operatorB) {
      errors.push("two different operators are required");
    }
    if (scenario.result !== "compatible") errors.push("compatible result is required");
  } else if (scenario.type === "bedside-transfusion") {
    if (!scenario.patientWristbandMatched || !scenario.bagBarcodeMatched || !scenario.orderMatched || !scenario.operatorMatched) {
      errors.push("all four bedside identifiers must match");
    }
  } else if (scenario.type === "recall") {
    if (!scenario.recallAcknowledgedAt || !scenario.unitIsolatedAt || !scenario.closedAt) {
      errors.push("recall acknowledgement, isolation and closure are required");
    }
  } else {
    errors.push("unsupported acceptance scenario type");
  }
  return { valid: errors.length === 0, errors };
}

function seedProductionEvidence() {
  return {
    moduleId: MODULE_ID,
    siteReceipts: [],
    masterDataContracts: [],
    coldChainEvidence: [],
    acceptanceScenarios: [],
    smokeRuns: [],
    rollbackRuns: []
  };
}

function evaluateProductionReadiness(state = {}) {
  const data = { ...seedProductionEvidence(), ...state };
  const receiptsValid = data.siteReceipts.length > 0 && data.siteReceipts.every((item) => validateReceipt(item).valid);
  const mastersValid = validateMasterDataMappings(data.masterDataContracts).valid;
  const coldChainValid = data.coldChainEvidence.length > 0 && data.coldChainEvidence.every((item) => validateColdChainEvidence(item).valid);
  const requiredScenarios = ["dual-person-crossmatch", "bedside-transfusion", "recall"];
  const scenariosValid = requiredScenarios.every((type) =>
    data.acceptanceScenarios.some((item) => item.type === type && validateAcceptanceScenario(item).valid));
  const smokePassed = data.smokeRuns.some((item) => item.result === "passed" && item.moduleId === MODULE_ID && item.evidenceRef);
  const rollbackPassed = data.rollbackRuns.some((item) => item.result === "passed" && item.restoreVerified === true && item.evidenceRef);
  const gates = { receiptsValid, mastersValid, coldChainValid, scenariosValid, smokePassed, rollbackPassed };
  const ready = Object.values(gates).every(Boolean);
  return {
    moduleId: MODULE_ID,
    standalone: true,
    functionalState: "software-release-ready",
    formalGoLiveState: ready ? "ready-for-production" : "blocked-until-site-evidence-signed",
    productionReady: ready,
    gates,
    evidenceDigest: digest({ moduleId: MODULE_ID, gates }),
    blockers: Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name)
  };
}

function validateDependencyIsolation(sourceText) {
  const found = FORBIDDEN_DEPENDENCIES.filter((name) => new RegExp(`(?:require|import).*${name}`, "i").test(String(sourceText)));
  return { valid: found.length === 0, forbiddenDependencies: found };
}

module.exports = {
  MODULE_ID,
  manifest,
  digest,
  validateBagId,
  validateMasterData,
  validateMasterDataMappings,
  validateReceipt,
  validateColdChainEvidence,
  submitReceipt,
  verifyReceipt,
  validateAcceptanceScenario,
  seedProductionEvidence,
  evaluateProductionReadiness,
  validateDependencyIsolation
};

const { createHash } = require("node:crypto");

const MODULE_ID = "clinical-blood";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const BAG_ID = /^(?<donation>[A-Z0-9]{13})-(?<component>[A-Z0-9]{3,8})-(?<sequence>\d{2})$/;
const FORBIDDEN_DEPENDENCIES = ["emergency", "imaging", "exam", "physical-exam"];
const coldChainProfiles = Object.freeze({
  "RBC": { storage: { min: 2, max: 6 }, transport: { min: 2, max: 10 }, label: "全血/红细胞" },
  "PLT": { storage: { min: 20, max: 24, agitationRequired: true }, transport: { min: 20, max: 24 }, label: "血小板" },
  "GRAN": { storage: { min: 20, max: 24 }, transport: { min: 20, max: 24 }, label: "粒细胞" },
  "PLASMA": { storage: { frozenRequired: true }, transport: { frozenRequired: true }, label: "冰冻血浆" },
  "CRYO": { storage: { frozenRequired: true }, transport: { frozenRequired: true }, label: "冷沉淀" }
});

const manifest = Object.freeze({
  moduleId: MODULE_ID,
  deploymentMode: "shared-platform-node-runtime",
  independentDeploymentAuthorized: false,
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
  const profile = coldChainProfiles[evidence.componentCode]?.[evidence.phase];
  if (!profile) {
    errors.push("supported componentCode and storage/transport phase are required");
  } else if (profile.frozenRequired) {
    if (evidence.frozenStateMaintained !== true) errors.push("frozen state must be maintained");
  } else {
    const minimum = Number(evidence.minimumTemperature);
    const maximum = Number(evidence.maximumTemperature);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) errors.push("minimum and maximum temperature are required");
    else if (minimum < profile.min || maximum > profile.max) errors.push(`temperature must remain within ${profile.min}-${profile.max}C`);
    if (profile.agitationRequired && evidence.agitationMaintained !== true) errors.push("platelet agitation evidence is required");
  }
  if (!Number.isInteger(Number(evidence.sampleCount)) || Number(evidence.sampleCount) < 1) errors.push("positive sampleCount is required");
  return { valid: errors.length === 0, errors };
}

function assessPretransfusionCompatibility(payload = {}) {
  const blockers = [];
  const warnings = [];
  if (!payload.patientId || !payload.specimenId) blockers.push("patient and specimen identity are required");
  if (!payload.forwardABO || !payload.reverseABO || payload.forwardABO !== payload.reverseABO) blockers.push("ABO forward/reverse typing mismatch");
  if (!payload.rhD) blockers.push("RhD result is required");
  if (payload.currentBloodType && payload.historicalBloodType && payload.currentBloodType !== payload.historicalBloodType) {
    blockers.push("current and historical blood type mismatch");
  }
  if (payload.antibodyScreen === "positive" && !payload.antibodyIdentification) blockers.push("positive antibody screen requires identification");
  if (payload.historicalAntibodies?.length && !payload.selectedUnitAntigenNegative) blockers.push("antigen-negative unit is required for historical antibodies");
  if (payload.drugInterference) warnings.push("drug interference requires specialist review");
  if (payload.emergencyUncrossmatched === true) warnings.push("emergency uncrossmatched issue requires retrospective testing and approval");
  return { allowed: blockers.length === 0, blockers, warnings, manualReview: warnings.length > 0 };
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

  if (scenario.type === "crossmatch-operation-review") {
    if (!scenario.performedBy) errors.push("one crossmatch operator is required");
    if (!scenario.reviewedBy || scenario.reviewedBy === scenario.performedBy) errors.push("independent result reviewer is required");
    if (!scenario.releasedBy || [scenario.performedBy, scenario.reviewedBy].includes(scenario.releasedBy)) {
      errors.push("independent report releaser is required");
    }
    if (!scenario.performedAt || !scenario.reviewedAt || !scenario.releasedAt) errors.push("operation, review and release timestamps are required");
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
  const requiredScenarios = ["crossmatch-operation-review", "bedside-transfusion", "recall"];
  const scenariosValid = requiredScenarios.every((type) =>
    data.acceptanceScenarios.some((item) => item.type === type && validateAcceptanceScenario(item).valid));
  const smokePassed = data.smokeRuns.some((item) => item.result === "passed" && item.moduleId === MODULE_ID && item.evidenceRef);
  const rollbackPassed = data.rollbackRuns.some((item) => item.result === "passed" && item.restoreVerified === true && item.evidenceRef);
  const gates = { receiptsValid, mastersValid, coldChainValid, scenariosValid, smokePassed, rollbackPassed };
  const localEvidenceReady = Object.values(gates).every(Boolean);
  return {
    moduleId: MODULE_ID,
    standalone: false,
    deploymentMode: manifest.deploymentMode,
    independentDeploymentAuthorized: false,
    functionalState: localEvidenceReady ? "local-rehearsal-ready" : "local-evidence-incomplete",
    formalGoLiveState: "NO-GO",
    productionReady: false,
    localEvidenceReady,
    gates,
    evidenceDigest: digest({ moduleId: MODULE_ID, gates }),
    blockers: [
      ...Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name),
      "shared-platform-production-gate",
      "independent-deployment-not-authorized"
    ]
  };
}

function validateDependencyIsolation(sourceText) {
  const source = String(sourceText);
  const hard = FORBIDDEN_DEPENDENCIES.filter((name) =>
    new RegExp(`(?:require|import|href\\s*=|fetch\\s*\\(|requiredDependencies)[^\\n]{0,160}${name}`, "i").test(source));
  const optional = FORBIDDEN_DEPENDENCIES.filter((name) =>
    new RegExp(`(?:consumers|optionalConsumers|event)[^\\n]{0,160}${name}`, "i").test(source) && !hard.includes(name));
  return { valid: hard.length === 0, forbiddenDependencies: hard, optionalIntegrations: optional };
}

module.exports = {
  MODULE_ID,
  manifest,
  digest,
  validateBagId,
  validateMasterData,
  validateMasterDataMappings,
  validateReceipt,
  coldChainProfiles,
  validateColdChainEvidence,
  assessPretransfusionCompatibility,
  submitReceipt,
  verifyReceipt,
  validateAcceptanceScenario,
  seedProductionEvidence,
  evaluateProductionReadiness,
  validateDependencyIsolation
};

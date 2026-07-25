const test = require("node:test");
const assert = require("node:assert/strict");
const clinical = require("../blood-clinical-production");

const sha = clinical.digest({ evidence: 1 });
const bagId = "A123456789012-RBCS-01";

test("clinical-blood manifest has no emergency, imaging or exam dependency", () => {
  assert.equal(clinical.manifest.moduleId, "clinical-blood");
  assert.deepEqual(clinical.manifest.requiredDependencies, ["identity", "mpi", "his", "lis", "pda", "iot", "audit"]);
  assert.equal(clinical.validateDependencyIsolation('require("./emergency-service")').valid, false);
  assert.equal(clinical.validateDependencyIsolation('require("./blood-service")').valid, true);
  const optional = clinical.validateDependencyIsolation('const contract={consumers:["emergency","operations"]}');
  assert.equal(optional.valid, true);
  assert.deepEqual(optional.optionalIntegrations, ["emergency"]);
});

test("BIS/BTIS master data and unique blood bag contract are enforced", () => {
  assert.equal(clinical.validateBagId(bagId).valid, true);
  assert.equal(clinical.validateBagId("bad").valid, false);
  assert.equal(clinical.validateMasterData({ organizationCode: "ORG", system: "BTIS", code: "RBCS", name: "RBC", version: "1", effectiveAt: "2026-07-24" }).valid, true);
  const mapped = ["BIS", "BTIS"].map((system) => ({ organizationCode: "ORG", system, code: "RBCS", name: "RBC", version: "1", effectiveAt: "2026-07-24" }));
  assert.equal(clinical.validateMasterDataMappings(mapped).valid, true);
  assert.equal(clinical.validateMasterDataMappings([mapped[0], { ...mapped[1], name: "conflict" }]).valid, false);
});

test("site receipt and cold-chain evidence require signed tamper evidence and independent verification", () => {
  assert.equal(clinical.validateReceipt({ evidenceRef: "site://1", evidenceDigest: sha, organizationCode: "ORG", signedBy: "owner", signedAt: "2026-07-24", verifiedBy: "reviewer", verifiedAt: "2026-07-24", correlationId: "c", idempotencyKey: "i" }).valid, true);
  const cold = { deviceId: "D1", serialNumber: "S1", calibrationCertificateRef: "site://cal", calibrationDigest: sha, calibratedAt: "2026-01-01", calibrationExpiresAt: "2027-01-01", alarmTestResult: "passed", alarmEvidenceRef: "site://alarm", performedBy: "A", verifiedBy: "B", componentCode: "RBC", phase: "transport", minimumTemperature: 2.1, maximumTemperature: 9.8, sampleCount: 10 };
  assert.equal(clinical.validateColdChainEvidence(cold, new Date("2026-07-24")).valid, true);
  assert.equal(clinical.validateColdChainEvidence({ ...cold, verifiedBy: "A" }, new Date("2026-07-24")).valid, false);
  assert.equal(clinical.validateColdChainEvidence(cold, new Date("2027-01-02")).valid, false);
  assert.equal(clinical.validateColdChainEvidence({ ...cold, maximumTemperature: 10.1 }, new Date("2026-07-24")).valid, false);
  const platelet = { ...cold, componentCode: "PLT", phase: "storage", minimumTemperature: 20, maximumTemperature: 24, agitationMaintained: true };
  assert.equal(clinical.validateColdChainEvidence(platelet, new Date("2026-07-24")).valid, true);
  assert.equal(clinical.validateColdChainEvidence({ ...platelet, agitationMaintained: false }, new Date("2026-07-24")).valid, false);
});

test("pretransfusion gate blocks typing conflicts and unresolved antibodies", () => {
  const valid = { patientId: "P1", specimenId: "S1", forwardABO: "A", reverseABO: "A", rhD: "positive", currentBloodType: "A+", historicalBloodType: "A+", antibodyScreen: "negative" };
  assert.equal(clinical.assessPretransfusionCompatibility(valid).allowed, true);
  assert.equal(clinical.assessPretransfusionCompatibility({ ...valid, reverseABO: "B" }).allowed, false);
  assert.equal(clinical.assessPretransfusionCompatibility({ ...valid, historicalBloodType: "O+" }).allowed, false);
  assert.equal(clinical.assessPretransfusionCompatibility({ ...valid, antibodyScreen: "positive" }).allowed, false);
  assert.equal(clinical.assessPretransfusionCompatibility({ ...valid, historicalAntibodies: ["anti-E"], selectedUnitAntigenNegative: false }).allowed, false);
  assert.equal(clinical.assessPretransfusionCompatibility({ ...valid, emergencyUncrossmatched: true }).manualReview, true);
});

test("receipt workflow is idempotent, digest-bound and independently verified", () => {
  const state = clinical.seedProductionEvidence();
  const payload = { evidenceRef: "site://1", evidenceDigest: sha, organizationCode: "ORG", correlationId: "c", idempotencyKey: "i" };
  const submitted = clinical.submitReceipt(state, payload, { id: "owner" });
  assert.equal(clinical.submitReceipt(state, payload, { id: "owner" }), submitted);
  assert.throws(() => clinical.submitReceipt(state, { ...payload, evidenceDigest: clinical.digest({ evidence: 2 }) }, { id: "owner" }), /different evidence digest/);
  assert.throws(() => clinical.verifyReceipt(state, "i", { id: "owner" }, sha), /independent verifier/);
  assert.equal(clinical.verifyReceipt(state, "i", { id: "reviewer" }, sha).status, "verified");
  assert.equal(clinical.validateReceipt(state.siteReceipts[0]).valid, true);
});

test("single-operator crossmatch with independent review/release, bedside four-code and recall are enforced", () => {
  const base = { patientId: "P1", bagId, evidenceRef: "site://scenario" };
  const crossmatch = { ...base, scenarioId: "S1", type: "crossmatch-operation-review", performedBy: "A", reviewedBy: "B", releasedBy: "C", performedAt: "1", reviewedAt: "2", releasedAt: "3", result: "compatible" };
  assert.equal(clinical.validateAcceptanceScenario(crossmatch).valid, true);
  assert.equal(clinical.validateAcceptanceScenario({ ...crossmatch, reviewedBy: "A" }).valid, false);
  assert.equal(clinical.validateAcceptanceScenario({ ...crossmatch, type: "dual-person-crossmatch" }).valid, false);
  assert.equal(clinical.validateAcceptanceScenario({ ...base, scenarioId: "S2", type: "bedside-transfusion", patientWristbandMatched: true, bagBarcodeMatched: true, orderMatched: true, operatorMatched: true }).valid, true);
  assert.equal(clinical.validateAcceptanceScenario({ ...base, scenarioId: "S3", type: "recall", recallAcknowledgedAt: "1", unitIsolatedAt: "2", closedAt: "3" }).valid, true);
});

test("formal go-live remains No-Go without all site evidence", () => {
  const result = clinical.evaluateProductionReadiness({});
  assert.equal(result.productionReady, false);
  assert.equal(result.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(result.blockers.length, 6);
});

test("all six production gates can reach ready-for-production", () => {
  const receipt = { evidenceRef: "site://1", evidenceDigest: sha, organizationCode: "ORG", signedBy: "owner", signedAt: "2026-07-24", verifiedBy: "reviewer", verifiedAt: "2026-07-24", correlationId: "c", idempotencyKey: "i" };
  const master = (system) => ({ organizationCode: "ORG", system, code: "RBCS", name: "RBC", version: "1", effectiveAt: "2026-07-24" });
  const base = { patientId: "P1", bagId, evidenceRef: "site://scenario" };
  const state = {
    siteReceipts: [receipt],
    masterDataContracts: [master("BIS"), master("BTIS")],
    coldChainEvidence: [{ deviceId: "D1", serialNumber: "S1", calibrationCertificateRef: "site://cal", calibrationDigest: sha, calibratedAt: "2026-01-01", calibrationExpiresAt: "2099-01-01", alarmTestResult: "passed", alarmEvidenceRef: "site://alarm", performedBy: "A", verifiedBy: "B", componentCode: "RBC", phase: "storage", minimumTemperature: 2.2, maximumTemperature: 5.8, sampleCount: 1440 }],
    acceptanceScenarios: [
      { ...base, scenarioId: "S1", type: "crossmatch-operation-review", performedBy: "A", reviewedBy: "B", releasedBy: "C", performedAt: "1", reviewedAt: "2", releasedAt: "3", result: "compatible" },
      { ...base, scenarioId: "S2", type: "bedside-transfusion", patientWristbandMatched: true, bagBarcodeMatched: true, orderMatched: true, operatorMatched: true },
      { ...base, scenarioId: "S3", type: "recall", recallAcknowledgedAt: "1", unitIsolatedAt: "2", closedAt: "3" }
    ],
    smokeRuns: [{ moduleId: "clinical-blood", result: "passed", evidenceRef: "site://smoke" }],
    rollbackRuns: [{ result: "passed", restoreVerified: true, evidenceRef: "site://rollback" }]
  };
  assert.equal(clinical.evaluateProductionReadiness(state).productionReady, true);
});

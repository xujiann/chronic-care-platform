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
  const cold = { deviceId: "D1", serialNumber: "S1", calibrationCertificateRef: "site://cal", calibrationDigest: sha, calibratedAt: "2026-01-01", calibrationExpiresAt: "2027-01-01", alarmTestResult: "passed", alarmEvidenceRef: "site://alarm", performedBy: "A", verifiedBy: "B" };
  assert.equal(clinical.validateColdChainEvidence(cold, new Date("2026-07-24")).valid, true);
  assert.equal(clinical.validateColdChainEvidence({ ...cold, verifiedBy: "A" }, new Date("2026-07-24")).valid, false);
  assert.equal(clinical.validateColdChainEvidence(cold, new Date("2027-01-02")).valid, false);
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

test("dual-person, bedside four-code and recall scenarios are enforced", () => {
  const base = { patientId: "P1", bagId, evidenceRef: "site://scenario" };
  assert.equal(clinical.validateAcceptanceScenario({ ...base, scenarioId: "S1", type: "dual-person-crossmatch", operatorA: "A", operatorB: "B", result: "compatible" }).valid, true);
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
    coldChainEvidence: [{ deviceId: "D1", serialNumber: "S1", calibrationCertificateRef: "site://cal", calibrationDigest: sha, calibratedAt: "2026-01-01", calibrationExpiresAt: "2099-01-01", alarmTestResult: "passed", alarmEvidenceRef: "site://alarm", performedBy: "A", verifiedBy: "B" }],
    acceptanceScenarios: [
      { ...base, scenarioId: "S1", type: "dual-person-crossmatch", operatorA: "A", operatorB: "B", result: "compatible" },
      { ...base, scenarioId: "S2", type: "bedside-transfusion", patientWristbandMatched: true, bagBarcodeMatched: true, orderMatched: true, operatorMatched: true },
      { ...base, scenarioId: "S3", type: "recall", recallAcknowledgedAt: "1", unitIsolatedAt: "2", closedAt: "3" }
    ],
    smokeRuns: [{ moduleId: "clinical-blood", result: "passed", evidenceRef: "site://smoke" }],
    rollbackRuns: [{ result: "passed", restoreVerified: true, evidenceRef: "site://rollback" }]
  };
  assert.equal(clinical.evaluateProductionReadiness(state).productionReady, true);
});

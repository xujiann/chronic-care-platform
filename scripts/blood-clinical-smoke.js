#!/usr/bin/env node
const assert = require("node:assert/strict");
const {
  MODULE_ID,
  digest,
  validateBagId,
  validateMasterData,
  validateReceipt,
  validateColdChainEvidence,
  validateAcceptanceScenario,
  evaluateProductionReadiness
} = require("../blood-clinical-production");

const bagId = "A123456789012-RBCS-01";
const sha = digest({ run: "standalone-smoke" });
assert.equal(validateBagId(bagId).valid, true);
assert.equal(validateMasterData({ organizationCode: "913301", system: "BIS", code: "RBCS", name: "红细胞", version: "1", effectiveAt: new Date().toISOString() }).valid, true);
assert.equal(validateReceipt({ evidenceRef: "site://receipt/1", evidenceDigest: sha, organizationCode: "913301", signedBy: "site-owner", signedAt: new Date().toISOString(), verifiedBy: "independent-reviewer", verifiedAt: new Date().toISOString(), correlationId: "corr-1", idempotencyKey: "idem-1" }).valid, true);
assert.equal(validateColdChainEvidence({ deviceId: "FRIDGE-01", serialNumber: "SN01", calibrationCertificateRef: "site://cal/1", calibrationDigest: sha, calibratedAt: "2026-01-01", calibrationExpiresAt: "2027-01-01", alarmTestResult: "passed", alarmEvidenceRef: "site://alarm/1", performedBy: "engineer-a", verifiedBy: "engineer-b" }, new Date("2026-07-24")).valid, true);
assert.equal(validateAcceptanceScenario({ scenarioId: "S1", type: "dual-person-crossmatch", patientId: "P1", bagId, evidenceRef: "site://scenario/1", operatorA: "A", operatorB: "B", result: "compatible" }).valid, true);
assert.equal(evaluateProductionReadiness({}).formalGoLiveState, "blocked-until-site-evidence-signed");
process.stdout.write(`${JSON.stringify({ moduleId: MODULE_ID, result: "passed", formalGoLiveState: "blocked-until-site-evidence-signed" })}\n`);

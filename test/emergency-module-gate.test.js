const test = require("node:test");
const assert = require("node:assert/strict");
const Gateway = require("../emergency-device-gateway");
const Production = require("../emergency-production");
const Gate = require("../emergency-module-gate");

const commission = { role:"commission", id:"submitter", name:"site submitter" };
const verifier = { role:"commission", id:"verifier", name:"independent verifier" };
const digest = `sha256:${"a".repeat(64)}`;

test("certificate contracts require verified mTLS, configured signature verification and a fresh envelope", () => {
  assert.equal(Gateway.INTEGRATION_CERTIFICATE_CONTRACTS.length, 3);
  const payload = { receiptId:"r-1", eventId:"e-1", correlationId:"c-1", occurredAt:"2026-07-24T01:00:00.000Z", decision:"accepted", signature:"jws", signatureAlgorithm:"JWS-ES256" };
  assert.throws(()=>Gateway.validateIntegrationEnvelope("120-dispatch-receipt", payload, { now:"2026-07-24T01:01:00.000Z", signatureVerifier:()=>true }), /mTLS/);
  const accepted = Gateway.validateIntegrationEnvelope("120-dispatch-receipt", payload, { now:"2026-07-24T01:01:00.000Z", mtlsPeer:{ verified:true, certificateFingerprint:"b".repeat(64) }, signatureVerifier:()=>true });
  assert.equal(accepted.rawCertificatePersisted, false);
  assert.equal(accepted.signatureAlgorithm, "JWS-ES256");
  assert.throws(()=>Gateway.validateIntegrationEnvelope("120-dispatch-receipt", { ...payload, signatureAlgorithm:"HMAC-SHA256" }, { now:"2026-07-24T01:01:00.000Z", mtlsPeer:{ verified:true, certificateFingerprint:"b".repeat(64) }, signatureVerifier:()=>true }), /does not match/);
});

test("site receipt cannot turn unsigned site evidence into a go decision", () => {
  const data = Production.seed();
  const receipt = { confirmation:Gate.RECEIPT_CONFIRMATION, requirementId:"EMG-SITE-01", receiptId:"receipt-cti-01", receiptRef:"receipt://120/cti", acceptedAt:"2026-07-24T01:00:00.000Z", receiver:"120 duty commander", externalSystem:"120-cti", outcome:"accepted", evidenceDigest:digest };
  const before = Gate.validateSiteEvidenceReceipt(data, receipt);
  assert.equal(before.valid, false);
  assert.ok(before.reasons.includes("independent-site-evidence-not-verified"));
  Production.probeEndpoint(data, commission, "emg-int-cti", { baseUrl:"https://120.example", credentialRef:"vault://120/cti" });
  Production.signRequirement(data, commission, "EMG-SITE-01", { action:"submit-evidence", confirmation:Production.REQUIREMENT_CONFIRMATION, evidenceRef:"evidence://120/cti", evidenceDigest:digest, externalSigner:"120 duty commander", externalOrganization:"120 emergency center", note:"joint acceptance" });
  Production.signRequirement(data, verifier, "EMG-SITE-01", { action:"verify-evidence", confirmation:"VERIFY EMERGENCY SITE EVIDENCE", evidenceDigest:digest, verificationRef:"verification://120/cti" });
  const after = Gate.validateSiteEvidenceReceipt(data, receipt);
  assert.equal(after.valid, true);
  assert.equal(after.formalGoLiveState, "receipt-accepted");
});

test("standalone handover smoke proves the WS/T 621 prehospital-to-hospital acceptance path", () => {
  const scenario = Gate.runHandoverAcceptanceScenario();
  assert.equal(scenario.status, "passed");
  assert.equal(scenario.finalStatus, "handover-completed");
  assert.equal(scenario.standard, "WS/T 621-2018");
  assert.equal(scenario.missing.length, 0);
});

test("rollback gate blocks the module when an unresolved P0 launch incident exists", () => {
  const data = Production.seed();
  const before = Gate.evaluateRollbackGate(data);
  assert.equal(before.decision, "rollback-standby");
  Production.createLaunchIncident(data, commission, { title:"dispatch receipt unavailable", severity:"P0", note:"acceptance failed" });
  const blocked = Gate.evaluateRollbackGate(data);
  assert.equal(blocked.decision, "rollback-required");
  assert.ok(blocked.triggers.some((item)=>item.startsWith("launch-incident:")));
  const readiness = Gate.buildIndependentModuleReadiness(data);
  assert.deepEqual(readiness.crossModuleDependencies, []);
  assert.equal(readiness.formalGoLiveState, "blocked-until-site-evidence-signed");
});

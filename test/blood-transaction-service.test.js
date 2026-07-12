const test = require("node:test");
const assert = require("node:assert/strict");
const BloodService = require("../blood-service");
const Tx = require("../blood-transaction-service");

const reviewer1 = { id: "reviewer-1", username: "r1", name: "放行员甲", role: "commission", orgCode: "BLOOD-DL", status: "启用" };
const reviewer2 = { id: "reviewer-2", username: "r2", name: "放行员乙", role: "commission", orgCode: "BLOOD-DL", status: "启用" };
const qualityReviewer = { id: "quality-1", username: "quality", name: "质控审核员", role: "commission", orgCode: "BLOOD-DL", bloodPermissions: ["cold_chain_quality_review"], status: "启用" };
const hospital = { id: "nurse-1", username: "hospital", name: "输血科护士", role: "institution", orgCode: "MR1", status: "启用" };
const technician1 = { id: "tech-1", username: "tech1", name: "配血复核员甲", role: "institution", orgCode: "MR1", bloodPermissions: ["compatibility_review"], status: "启用" };
const technician2 = { id: "tech-2", username: "tech2", name: "配血复核员乙", role: "institution", orgCode: "MR1", bloodPermissions: ["compatibility_review"], status: "启用" };

function state() {
  const data = BloodService.normalizeBloodState({});
  Tx.normalizeTransactionState(data);
  return data;
}

function releaseAndShip(data, key = "chain") {
  Tx.reviewRelease(data, reviewer1, { bloodUnitId: "bu-00182" }, `${key}-release-1`);
  Tx.reviewRelease(data, reviewer2, { bloodUnitId: "bu-00182" }, `${key}-release-2`);
  return Tx.createShipment(data, reviewer1, { bloodUnitIds: ["bu-00182"], destinationInstitution: "MR1" }, `${key}-ship`);
}

function receivePayload(shipmentId, temperatureOk = true) {
  return { shipmentId, temperatureOk, temperatureCelsius: temperatureOk ? 4.2 : 9.4, temperatureDeviceId: "cold-chain-pda-01", measuredAt: "2026-07-12T09:15:00.000Z", temperatureSource: "handover_scan" };
}

test("test report signing requires idempotency and preserves replay result", () => {
  const data = state();
  assert.equal(Tx.signTestReport(data, reviewer1, { bloodUnitId: "bu-00195", conclusion: "qualified", results: {} }, "").status, 400);
  const first = Tx.signTestReport(data, reviewer1, { bloodUnitId: "bu-00195", conclusion: "qualified", results: { nat: "negative" } }, "sign-1");
  const replay = Tx.signTestReport(data, reviewer1, { bloodUnitId: "bu-00195", conclusion: "qualified", results: { nat: "negative" } }, "sign-1");
  assert.equal(first.status, 201);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(data.bloodTestReports.filter((item) => item.bloodUnitId === "bu-00195").length, 1);
});

test("release requires two different signed reviewers", () => {
  const data = state();
  const one = Tx.reviewRelease(data, reviewer1, { bloodUnitId: "bu-00182", decision: "approved" }, "release-1");
  assert.equal(one.body.released, false);
  const duplicate = Tx.reviewRelease(data, reviewer1, { bloodUnitId: "bu-00182", decision: "approved" }, "release-dup");
  assert.equal(duplicate.status, 409);
  const two = Tx.reviewRelease(data, reviewer2, { bloodUnitId: "bu-00182", decision: "approved" }, "release-2");
  assert.equal(two.body.released, true);
  assert.equal(two.body.bloodUnit.inventoryLock.status, "available");
});

test("one blood unit completes the authenticated two-reviewer chain", () => {
  const data = state();
  const shipped = releaseAndShip(data);
  assert.equal(shipped.status, 201);
  const received = Tx.receiveShipment(data, hospital, receivePayload(shipped.body.shipment.id), "chain-receive");
  assert.equal(received.status, 200);
  const firstReview = Tx.recordCompatibility(data, technician1, { requestId: "BT-0711-0032", bloodUnitId: "bu-00182", aboRhMatched: true, crossmatchCompatible: true }, "chain-match");
  assert.equal(firstReview.status, 202);
  assert.equal(firstReview.body.test.reviewers.length, 1);
  const secondReview = Tx.recordCompatibility(data, technician2, { requestId: "BT-0711-0032", bloodUnitId: "bu-00182", aboRhMatched: true, crossmatchCompatible: true }, "chain-match");
  assert.equal(secondReview.status, 201);
  assert.equal(secondReview.body.test.reviewers.length, 2);
  assert.equal(secondReview.body.bloodUnit.status, "issued");
  const started = Tx.startTransfusion(data, hospital, { requestId: "BT-0711-0032", bloodUnitId: "bu-00182", patientMatched: true, orderMatched: true, bloodUnitMatched: true, scannerId: "PDA-01" }, "chain-start");
  assert.equal(started.status, 201);
  const completed = Tx.completeTransfusion(data, hospital, { episodeId: started.body.episode.id, outcome: "completed", evaluation: "Hb improved" }, "chain-complete");
  assert.equal(completed.status, 200);
  assert.equal(data.bloodUnits[0].status, "evaluated");
  assert.equal(data.transfusionRequests[0].status, "evaluated");
});

test("compatibility rejects forged reviewer identities and unqualified accounts", () => {
  const data = state();
  const shipped = releaseAndShip(data, "identity");
  Tx.receiveShipment(data, hospital, receivePayload(shipped.body.shipment.id), "identity-receive");
  const forged = Tx.recordCompatibility(data, hospital, { requestId: "BT-0711-0032", bloodUnitId: "bu-00182", aboRhMatched: true, crossmatchCompatible: true, reviewerIds: ["made-up-1", "made-up-2"] }, "identity-forged");
  assert.equal(forged.status, 403);
  const bodyClaim = Tx.recordCompatibility(data, technician1, { requestId: "BT-0711-0032", bloodUnitId: "bu-00182", aboRhMatched: true, crossmatchCompatible: true, reviewerIds: ["tech-1", "tech-2"] }, "identity-body-claim");
  assert.equal(bodyClaim.status, 400);
  assert.equal(data.compatibilityTests.length, 0);
});

test("cold-chain failure persists quarantine and blocks any later receipt", () => {
  const data = state();
  const shipped = releaseAndShip(data, "cold-chain");
  const failedReceipt = Tx.receiveShipment(data, hospital, receivePayload(shipped.body.shipment.id, false), "cold-chain-receive");
  assert.equal(failedReceipt.status, 409);
  assert.equal(failedReceipt.body.shipment.status, "quarantined");
  assert.equal(failedReceipt.body.bloodUnits[0].status, "quarantined");
  assert.equal(failedReceipt.body.bloodUnits[0].inventoryLock.status, "quarantined");
  assert.equal(data.bloodSafetyIncidents[0].status, "awaiting_quality_review");
  assert.equal(data.bloodAuditEvents.some((item) => item.action === "cold_chain_breach"), true);
  const laterReceipt = Tx.receiveShipment(data, hospital, receivePayload(shipped.body.shipment.id), "cold-chain-receive-later");
  assert.equal(laterReceipt.status, 409);
  const wrongReviewer = Tx.reviewColdChainIncident(data, reviewer1, { incidentId: data.bloodSafetyIncidents[0].id, decision: "discard" }, "cold-chain-no-permission");
  assert.equal(wrongReviewer.status, 403);
  const invalidDecision = Tx.reviewColdChainIncident(data, qualityReviewer, { incidentId: data.bloodSafetyIncidents[0].id, decision: "release" }, "cold-chain-invalid-decision");
  assert.equal(invalidDecision.status, 400);
  const resolved = Tx.reviewColdChainIncident(data, qualityReviewer, { incidentId: data.bloodSafetyIncidents[0].id, decision: "return_to_center", qualityNote: "return for validated disposal" }, "cold-chain-resolve");
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.shipment.status, "return_authorized");
  assert.equal(resolved.body.bloodUnits[0].inventoryLock.status, "return_locked");
  assert.equal(Tx.receiveShipment(data, hospital, receivePayload(shipped.body.shipment.id), "cold-chain-after-review").status, 409);
});

test("two authenticated reviewers quarantine incompatible compatibility results", () => {
  const data = state();
  const shipped = releaseAndShip(data, "incompatible");
  Tx.receiveShipment(data, hospital, receivePayload(shipped.body.shipment.id), "incompatible-receive");
  assert.equal(Tx.recordCompatibility(data, technician1, { requestId: "BT-0711-0032", bloodUnitId: "bu-00182", aboRhMatched: false, crossmatchCompatible: false }, "incompatible-1").status, 202);
  const result = Tx.recordCompatibility(data, technician2, { requestId: "BT-0711-0032", bloodUnitId: "bu-00182", aboRhMatched: false, crossmatchCompatible: false }, "incompatible-2");
  assert.equal(result.status, 409);
  assert.equal(result.body.test.status, "incompatible");
  assert.equal(result.body.bloodUnit.status, "quarantined");
  assert.equal(result.body.request.status, "compatibility_hold");
});

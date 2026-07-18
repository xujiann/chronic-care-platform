const assert = require("node:assert/strict");
const test = require("node:test");
const EmergencyService = require("../emergency-service");
const LifeChain = require("../emergency-lifechain");

test("pre-authorized device SOS coordinates the golden four minutes without replacing 120", () => {
  const data = EmergencyService.seed();
  const citizen = { role:"citizen", name:"resident", residentId:"r-100" };
  assert.throws(() => LifeChain.createAuthorization(data, citizen, { deviceId:"wearable-100" }), /explicit patient authorization/);
  LifeChain.createAuthorization(data, citizen, { deviceId:"wearable-100", confirmed:true });
  LifeChain.addFamilyContact(data, citizen, { contactName:"family", relation:"spouse", phoneMasked:"138****0000", confirmed:true });
  assert.throws(() => LifeChain.createAutomaticSos(data, citizen, { deviceId:"wearable-100", detectedSignal:"fall-detected", riskScore:59, address:"test location" }, EmergencyService), /below the automatic SOS threshold/);
  const event = LifeChain.createAutomaticSos(data, citizen, {
    deviceId:"wearable-100", detectedSignal:"cardiac-risk", riskScore:85,
    address:"test location", latitude:38.92, longitude:121.65, networkStatus:"weak", sourceSignalId:"wearable-100-signal-01"
  }, EmergencyService);
  assert.equal(event.source, "device-sos");
  assert.equal(event.sos.autoAuthorized, true);
  assert.equal(event.sos.detectedSignal, "cardiac-risk");
  assert.equal(event.lifeChain.firstAidTaskIds.length > 0, true);
  assert.equal(Boolean(event.lifeChain.greenChannelPreparationId), true);
  assert.equal(Boolean(event.lifeChain.fallbackDeliveryId), true);
  const automaticEvidence = EmergencyService.buildEvidencePackage(data, { role:"commission", name:"evidence" }, event.id);
  const automaticControl = automaticEvidence.sections.find((item) => item.id === "automatic-sos-control");
  assert.equal(automaticControl.present, true);
  const overview = LifeChain.buildOverview(data, citizen, event.id);
  assert.equal(overview.firstAidTasks.length > 0, true);
  assert.equal(overview.familyNotifications.length, 1);
  assert.equal(overview.fallbackDeliveries.length, 1);
  const duplicate = LifeChain.createAutomaticSos(data, citizen, { deviceId:"wearable-100", detectedSignal:"cardiac-risk", riskScore:85, address:"test location", sourceSignalId:"wearable-100-signal-01" }, EmergencyService);
  assert.equal(duplicate.id, event.id);
  assert.equal(duplicate.automaticSosSubmission.deduplicated, true);
  assert.equal(data.emergencySosSignalLog.filter((item) => item.status === "accepted").length, 1);
  assert.equal(data.emergencySosSignalLog.filter((item) => item.status === "suppressed-duplicate").length, 1);
  const cancellationRequest = LifeChain.requestAutomaticSosCancellation(data, citizen, event.id, { confirmed:true, reason:"false alarm check" });
  assert.equal(cancellationRequest.reviewStatus, "cancellation-requested");
  const cancellationResolved = LifeChain.resolveAutomaticSosCancellation(data, { role:"commission", name:"120" }, event.id, { confirmed:true, decision:"keep-open", note:"Caller rechecked" });
  assert.equal(cancellationResolved.reviewStatus, "kept-open");
  const preparation = LifeChain.confirmGreenChannel(data, { role:"institution", name:"ER", orgCode:"MR1" }, event.id, { note:"ready" });
  assert.equal(preparation.status, "hospital-confirmed");
  assert.throws(() => LifeChain.confirmGreenChannel(data, { role:"institution", name:"other hospital", orgCode:"MR3" }, event.id, { note:"not allowed" }), /not the target/);
  const otherHospitalView = LifeChain.buildOverview(data, { role:"institution", name:"other hospital", orgCode:"MR3" });
  assert.equal(otherHospitalView.events.length, 0);
  const command = LifeChain.buildCommandCenter(data, { role:"commission", name:"120" });
  assert.equal(command.coverage.availableAed >= 1, true);
  const quality = LifeChain.buildQualityDashboard(data, { role:"commission", name:"quality" });
  assert.equal(quality.summary.automaticSos, 1);
  assert.equal(quality.summary.weakNetworkFallbacks, 1);
  assert.equal(quality.summary.suppressedDuplicateSignals, 1);
  assert.equal(quality.summary.cancellationReviews, 1);
  const revoked = LifeChain.revokeAuthorization(data, citizen, data.emergencySosAuthorizations[0].id, { confirmed:true });
  assert.equal(revoked.active, false);
});

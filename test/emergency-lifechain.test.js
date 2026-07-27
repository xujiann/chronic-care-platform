const assert = require("node:assert/strict");
const test = require("node:test");
const { createHmac } = require("node:crypto");
const EmergencyService = require("../emergency-service");
const Gateway = require("../emergency-device-gateway");
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
  assert.equal(LifeChain.buildCommandCenter(data, { role:"commission", name:"120" }).cancellationReviews.length, 1);
  const cancellationResolved = LifeChain.resolveAutomaticSosCancellation(data, { role:"commission", name:"120" }, event.id, { confirmed:true, decision:"keep-open", note:"Caller rechecked" });
  assert.equal(cancellationResolved.reviewStatus, "kept-open");
  const preparation = LifeChain.confirmGreenChannel(data, { role:"institution", name:"ER", orgCode:"MR1" }, event.id, { note:"ready" });
  assert.equal(preparation.status, "hospital-confirmed");
  assert.throws(() => LifeChain.confirmGreenChannel(data, { role:"institution", name:"other hospital", orgCode:"MR3" }, event.id, { note:"not allowed" }), /not the target/);
  const otherHospitalView = LifeChain.buildOverview(data, { role:"institution", name:"other hospital", orgCode:"MR3" });
  assert.equal(otherHospitalView.events.length, 0);
  const command = LifeChain.buildCommandCenter(data, { role:"commission", name:"120" });
  assert.equal(command.coverage.availableAed >= 1, true);
  assert.equal(command.cancellationReviews.length, 0, "resolved reviews leave the 120 work queue");
  const quality = LifeChain.buildQualityDashboard(data, { role:"commission", name:"quality" });
  assert.equal(quality.summary.automaticSos, 1);
  assert.equal(quality.summary.weakNetworkFallbacks, 1);
  assert.equal(quality.summary.suppressedDuplicateSignals, 1);
  assert.equal(quality.summary.cancellationReviews, 1);
  const revoked = LifeChain.revokeAuthorization(data, citizen, data.emergencySosAuthorizations[0].id, { confirmed:true });
  assert.equal(revoked.active, false);
});

test("trusted gateway signal can be linked into automatic SOS without bypassing consent", () => {
  const data = EmergencyService.seed();
  Gateway.ensure(data);
  const citizen = { role:"citizen", name:"resident", residentId:"r-100" };
  const submitter = { role:"commission", name:"device submitter" };
  const verifier = { role:"commission", name:"device verifier" };
  const secret = "site-secret-reference-value-2026";
  const evidenceDigest = "a".repeat(64);
  const device = Gateway.registerDevice(data, submitter, {
    deviceId:"ambulance-monitor-001",
    vendor:"设备厂商",
    model:"ECG-X",
    serialNo:"SN-001",
    ownerOrganization:"120急救中心",
    credentialRef:"vault://emergency/device/SN-001",
    certificateFingerprint:"b".repeat(64),
    allowedSignals:["cardiac-risk"]
  }, { now:"2026-07-22T06:00:00.000Z" });
  Gateway.submitAttestation(data, submitter, device.id, {
    evidenceRef:"evidence://device/SN-001",
    evidenceDigest,
    externalSigner:"厂商现场工程师",
    externalOrganization:"设备厂商"
  }, { now:"2026-07-22T06:01:00.000Z" });
  Gateway.verifyAttestation(data, verifier, device.id, {
    confirmation:Gateway.ATTESTATION_CONFIRMATION,
    evidenceDigest,
    verificationRef:"verification://commission/SN-001"
  }, { now:"2026-07-22T06:02:00.000Z" });
  LifeChain.createAuthorization(data, citizen, { deviceId:"ambulance-monitor-001", confirmed:true });
  const payload = {
    deviceId:"ambulance-monitor-001",
    signal:"cardiac-risk",
    riskScore:88,
    sourceSignalId:"signal-001",
    occurredAt:"2026-07-22T06:03:00.000Z",
    counter:1,
    residentId:"r-100"
  };
  payload.signature = createHmac("sha256", secret).update(Gateway.canonicalSignal(payload)).digest("hex");
  const signal = Gateway.receiveSignedSignal(data, payload, {
    now:"2026-07-22T06:03:30.000Z",
    secretResolver:()=>secret
  });
  assert.throws(() => LifeChain.createAutomaticSosFromTrustedSignal(data, { role:"citizen", name:"other", residentId:"r-200" }, signal.id, EmergencyService), /cannot use this trusted device signal/);
  const event = LifeChain.createAutomaticSosFromTrustedSignal(data, citizen, signal.id, EmergencyService, {
    address:"test location",
    latitude:38.92,
    longitude:121.65
  });
  assert.equal(event.sos.trustedDeviceSignalId, signal.id);
  assert.equal(event.sos.trustedDeviceId, device.id);
  assert.equal(signal.lifeChainEventId, event.id);
  assert.equal(signal.lifeChainStatus, "linked");
  const replay = LifeChain.createAutomaticSosFromTrustedSignal(data, citizen, signal.sourceSignalId, EmergencyService);
  assert.equal(replay.id, event.id);
  assert.equal(replay.automaticSosSubmission.deduplicated, true);
});

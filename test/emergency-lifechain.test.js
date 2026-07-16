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
    address:"test location", latitude:38.92, longitude:121.65, networkStatus:"weak"
  }, EmergencyService);
  assert.equal(event.source, "device-sos");
  assert.equal(event.sos.autoAuthorized, true);
  assert.equal(event.sos.detectedSignal, "cardiac-risk");
  assert.equal(event.lifeChain.firstAidTaskIds.length > 0, true);
  assert.equal(Boolean(event.lifeChain.greenChannelPreparationId), true);
  assert.equal(Boolean(event.lifeChain.fallbackDeliveryId), true);
  const overview = LifeChain.buildOverview(data, citizen, event.id);
  assert.equal(overview.firstAidTasks.length > 0, true);
  assert.equal(overview.familyNotifications.length, 1);
  assert.equal(overview.fallbackDeliveries.length, 1);
  const preparation = LifeChain.confirmGreenChannel(data, { role:"institution", name:"ER" }, event.id, { note:"ready" });
  assert.equal(preparation.status, "hospital-confirmed");
  const command = LifeChain.buildCommandCenter(data, { role:"commission", name:"120" });
  assert.equal(command.coverage.availableAed >= 1, true);
  const quality = LifeChain.buildQualityDashboard(data, { role:"commission", name:"quality" });
  assert.equal(quality.summary.automaticSos, 1);
  assert.equal(quality.summary.weakNetworkFallbacks, 1);
});

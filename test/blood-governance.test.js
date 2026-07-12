const assert = require("node:assert/strict");
const test = require("node:test");

const BloodMasterData = require("../blood-master-data");
const BloodService = require("../blood-service");

const center = { role: "commission", name: "blood-center", username: "blood-center", orgCode: "BLOOD-DL" };
const hospital = { role: "institution", name: "hospital-one", username: "hospital-one", orgCode: "MR1" };

function state() {
  return BloodService.normalizeBloodState({});
}

test("master data is versioned and validates clinical codes", () => {
  assert.match(BloodMasterData.catalog.version, /^2026\./);
  assert.equal(BloodMasterData.validateBloodType("O Rh+"), true);
  assert.equal(BloodMasterData.validateBloodType("invalid"), false);
  assert.equal(BloodMasterData.validateComponent(BloodMasterData.catalog.components[0].code), true);
});

test("recall cannot close before every institution acknowledges", () => {
  const data = state();
  data.bloodUnits[0].hospitalCode = "MR1";
  const recall = BloodService.createRecall(data, center, { bloodUnitIds: ["bu-00182"], reason: "test recall" }).body.recall;
  const disposition = BloodMasterData.catalog.recallDispositions[0];
  assert.equal(BloodService.closeRecall(data, center, recall.id, {}, "close-before-ack").status, 409);
  assert.equal(BloodService.acknowledgeRecall(data, hospital, recall.id, { disposition, note: "inventory checked" }, "ack-before-close").status, 200);
  assert.equal(BloodService.closeRecall(data, center, recall.id, { conclusion: "all acknowledged" }, "close-after-ack").body.recall.status, "closed");
});

test("reaction investigation uses governed conclusion", () => {
  const data = state();
  assert.equal(BloodService.investigateReaction(data, hospital, "tr-001", { conclusion: "invalid" }).status, 400);
  const result = BloodService.investigateReaction(data, hospital, "tr-001", {
    conclusion: BloodMasterData.catalog.reactionConclusions[0],
    rootCause: "individual reaction",
    correctiveActions: ["increase monitoring"],
    close: true
  });
  assert.equal(result.body.reaction.status, "closed");
});

test("emergency allocation follows full state chain", () => {
  const data = state();
  data.emergencyBloodAllocations = [];
  const item = BloodService.createEmergencyAllocation(data, hospital, {
    bloodType: "O Rh+",
    component: BloodMasterData.catalog.components[0].code,
    amount: "10U",
    reason: "mass casualty response"
  }).body.allocation;
  BloodService.actEmergencyAllocation(data, center, item.id, { action: "approve" });
  BloodService.actEmergencyAllocation(data, center, item.id, { action: "dispatch" });
  BloodService.actEmergencyAllocation(data, hospital, item.id, { action: "receive" });
  BloodService.actEmergencyAllocation(data, center, item.id, { action: "close" });
  assert.equal(item.status, "closed");
  assert.deepEqual(item.actionHistory.map((entry) => entry.from), ["received", "dispatched", "approved", "requested"]);
});

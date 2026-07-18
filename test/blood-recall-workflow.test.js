const assert = require("node:assert/strict");
const test = require("node:test");

const BloodMasterData = require("../blood-master-data");
const BloodService = require("../blood-service");

const center = { role: "commission", name: "blood-center", username: "blood-center", orgCode: "BLOOD-DL" };
const hospital = { role: "institution", name: "hospital-one", username: "hospital-one", orgCode: "MR1" };

function state() {
  return BloodService.normalizeBloodState({});
}

function createTwoInstitutionRecall(data) {
  data.bloodUnits[0].hospitalCode = "MR1";
  data.bloodUnits.push({
    ...data.bloodUnits[0],
    id: "bu-00200",
    donationCode: "CN2102-20260711-00200",
    hospitalCode: "MR2"
  });
  return BloodService.createRecall(data, center, {
    bloodUnitIds: ["bu-00182", "bu-00200"],
    reason: "test recall"
  });
}

test("recall acknowledgement is scoped, idempotent, auditable, and closable", () => {
  const data = state();
  const created = createTwoInstitutionRecall(data);
  const disposition = BloodMasterData.catalog.recallDispositions[0];

  const first = BloodService.acknowledgeRecall(data, hospital, created.body.recall.id, {
    disposition,
    note: "MR1 inventory frozen and destination checked"
  }, "recall-ack-1");
  assert.equal(first.status, 202);
  assert.deepEqual(first.body.recall.acknowledgementSummary, { expected: 2, received: 1, pending: 1 });
  assert.equal(first.body.exchange.type, "recall_acknowledgement");

  const second = BloodService.acknowledgeRecall(data, { ...hospital, orgCode: "MR2", username: "hospital-two" }, created.body.recall.id, {
    disposition,
    note: "MR2 inventory frozen and destination checked"
  }, "recall-ack-2");
  assert.equal(second.status, 200);
  assert.equal(second.body.recall.status, "acknowledged");
  assert.deepEqual(second.body.recall.acknowledgementSummary, { expected: 2, received: 2, pending: 0 });

  const replay = BloodService.acknowledgeRecall(data, hospital, created.body.recall.id, {
    disposition,
    note: "ignored replay payload"
  }, "recall-ack-1");
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(data.bloodRecalls[0].acknowledgements.length, 2);

  const closed = BloodService.closeRecall(data, center, created.body.recall.id, {
    conclusion: "all affected institutions acknowledged"
  }, "recall-close-1");
  assert.equal(closed.status, 200);
  assert.equal(closed.body.recall.status, "closed");
  assert.equal(data.bloodAuditEvents.some((item) => item.action === "recall_closed"), true);

  const closeReplay = BloodService.closeRecall(data, center, created.body.recall.id, {}, "recall-close-1");
  assert.equal(closeReplay.body.idempotentReplay, true);
});

test("recall acknowledgement requires a key, note, and eligible institution", () => {
  const data = state();
  data.bloodUnits[0].hospitalCode = "MR1";
  const created = BloodService.createRecall(data, center, { bloodUnitIds: ["bu-00182"], reason: "test recall" });
  const disposition = BloodMasterData.catalog.recallDispositions[0];

  assert.equal(BloodService.acknowledgeRecall(data, hospital, created.body.recall.id, { disposition }).status, 400);
  assert.equal(BloodService.acknowledgeRecall(data, hospital, created.body.recall.id, { disposition }, "recall-invalid-note").status, 400);
  assert.equal(BloodService.acknowledgeRecall(data, { role: "institution", orgCode: "MR9", name: "other" }, created.body.recall.id, { disposition, note: "not allowed" }, "recall-forbidden").status, 404);
});

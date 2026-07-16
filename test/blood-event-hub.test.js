const test = require("node:test");
const assert = require("node:assert/strict");
const Hub = require("../blood-event-hub");

const center = { role: "commission", orgCode: "BLOOD-DL", name: "血液中心调度员" };
function state() {
  return {
    bloodUnits: [{ id: "u1", donationCode: "D1", bloodType: "O Rh+", status: "qualified", institutionCode: "BLOOD-DL" }],
    bloodRecalls: [{ id: "rec1", status: "notified", bloodUnitIds: ["u1"], affectedInstitutions: ["MR1"], acknowledgements: [] }],
    transfusionReactions: [{ id: "rea1", status: "reported", severity: "严重", institutionCode: "MR1", bloodUnitIds: ["u1"] }],
    bloodSafetyIncidents: [{ id: "cc1", status: "awaiting_quality_review", bloodUnitId: "u1", shipmentId: "s1" }],
    emergencyBloodAllocations: [{ id: "ea1", status: "approved", priority: "critical", bloodType: "O Rh+", amount: "10U", destinationInstitution: "MR1" }]
  };
}

test("contract catalog covers four platform consumers", () => {
  const consumers = new Set(Hub.contracts.flatMap((x) => x.consumers));
  assert.deepEqual([...consumers].sort(), ["emergency", "health-dashboard", "operations", "quality-safety"]);
  assert.equal(Hub.contracts.length, 6);
});

test("derives inventory shortage recall reaction cold-chain and emergency events", () => {
  const events = Hub.derive(state());
  assert.deepEqual(new Set(events.map((x) => x.type)), new Set(["blood.inventory.changed", "blood.shortage.detected", "blood.recall.opened", "blood.reaction.reported", "blood.cold-chain.breached", "blood.emergency.requested"]));
});

test("publish is idempotent and builds subscriber projections", () => {
  const data = state();
  const first = Hub.publish(data, center, { correlationId: "sync-1" });
  const second = Hub.publish(data, center, { correlationId: "sync-2" });
  assert.equal(first.created.length, 6);
  assert.equal(second.created.length, 0);
  assert.equal(second.replayed.length, 6);
  assert.ok(data.bloodModuleProjections.some((x) => x.consumer === "emergency" && x.eventType === "blood.shortage.detected"));
  assert.ok(data.bloodModuleProjections.some((x) => x.consumer === "quality-safety" && x.eventType === "blood.reaction.reported"));
});

test("dead letter retry creates missing consumer projection", () => {
  const data = state();
  Hub.publish(data, center, { failConsumer: "operations" });
  const dead = data.bloodEventDeliveries.find((x) => x.status === "dead_letter");
  assert.ok(dead);
  assert.ok(!data.bloodModuleProjections.some((x) => x.id === `bmp-${dead.eventId}-${dead.consumer}`));
  const retried = Hub.retry(data, center, dead.id);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.delivery.status, "delivered");
  assert.equal(retried.body.delivery.attempts, 2);
  assert.equal(retried.body.projection.consumer, "operations");
});

test("dashboard reports delivery and projection evidence", () => {
  const data = state();
  Hub.publish(data, center);
  const dashboard = Hub.dashboard(data, center);
  assert.equal(dashboard.summary.events, 6);
  assert.equal(dashboard.summary.deadLetters, 0);
  assert.equal(dashboard.consumers.length, 4);
});

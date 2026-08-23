"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const NursingEscortDomain = require("../nursing-escort-domain");
const { jsonCommand, startCareApiCharacterization } = require("./helpers/care-api-characterization-runtime");

test("nurse owner route preserves workstation scope idempotency evidence audit notifications and lifecycle order", async (t) => {
  const runtime = await startCareApiCharacterization("test006-nurse-lifecycle");
  t.after(runtime.stop);
  const [nurseToken, commissionToken] = await Promise.all([
    runtime.login("nurse"),
    runtime.login("health")
  ]);
  const dashboard = await runtime.request("/api/internet-nursing/dashboard", nurseToken);
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.orders.every((item) => item.nurseId !== "inn-002"), true);
  assert.equal(dashboard.body.nurseQueue.some((item) => item.id === "ino-001"), true);

  const otherNurseOrder = await runtime.request(
    "/api/internet-nursing/orders/ino-002/actions",
    nurseToken,
    jsonCommand(nurseToken, "test006-nurse-cross-scope", {
      action: "nurse-accept",
      status: "accepted",
      nurseId: "inn-001"
    })
  );
  assert.equal(otherNurseOrder.response.status, 403);
  const spoofedNurse = await runtime.request(
    "/api/internet-nursing/orders/ino-001/actions",
    nurseToken,
    jsonCommand(nurseToken, "test006-nurse-spoof", {
      action: "nurse-accept",
      status: "accepted",
      nurseId: "inn-002"
    })
  );
  assert.equal(spoofedNurse.response.status, 409);
  assert.match(spoofedNurse.body.message, /transition|evidence|nurse/i);
  const prematureComplete = await runtime.request(
    "/api/internet-nursing/orders/ino-001/actions",
    nurseToken,
    jsonCommand(nurseToken, "test006-nurse-premature-complete", {
      action: "service-complete",
      status: "completed",
      nurseId: "inn-001",
      serviceRecordStatus: "completed"
    })
  );
  assert.equal(prematureComplete.response.status, 409);
  assert.equal(prematureComplete.body.code, "INVALID_ORDER_TRANSITION");
  assert.match(prematureComplete.body.message, /dispatched -> completed is not allowed/);

  const acceptPayload = {
    action: "nurse-accept",
    status: "accepted",
    nurseId: "inn-001"
  };
  const accepted = await runtime.request(
    "/api/internet-nursing/orders/ino-001/actions",
    nurseToken,
    jsonCommand(nurseToken, "test006-nurse-accept", acceptPayload)
  );
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, "accepted");
  assert.equal(accepted.body.locationTrace, "pending");
  assert.equal(accepted.body.timelineEvents[0].toStatus, "accepted");
  assert.equal(accepted.body.notificationPlans[0].messages.some((item) => item.channel === "sms" && item.status === "planned"), true);
  assert.equal(accepted.body.auditTrail.some((item) => item.action === "transition:dispatched->accepted"), true);
  const replay = await runtime.request(
    "/api/internet-nursing/orders/ino-001/actions",
    nurseToken,
    jsonCommand(nurseToken, "test006-nurse-accept", acceptPayload)
  );
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.status, "accepted");
  const conflictingReplay = await runtime.request(
    "/api/internet-nursing/orders/ino-001/actions",
    nurseToken,
    jsonCommand(nurseToken, "test006-nurse-accept", { ...acceptPayload, note: "changed intent" })
  );
  assert.equal(conflictingReplay.response.status, 409);

  const startEvidence = NursingEscortDomain.buildServiceStartEvidence("nursing", accepted.body, {
    lat: 38.915,
    lng: 121.616,
    source: "nurse-mobile",
    verified: true,
    identityMatched: true,
    readinessVerified: true,
    equipmentItems: ["sterile wound-care kit", "service recorder"],
    equipmentVerified: true,
    emergencyReady: true,
    emergencyContactId: "nursing-duty-test006",
    oneClickAlertTested: true,
    coordinationConfirmed: true,
    hospitalContactId: "wound-center-test006",
    supportContactId: "family-r1",
    communityContactId: "community-team-test006"
  });
  const started = await runtime.request(
    "/api/internet-nursing/orders/ino-001/actions",
    nurseToken,
    jsonCommand(nurseToken, "test006-nurse-start", {
      action: "service-start",
      status: "in-service",
      ...startEvidence
    })
  );
  assert.equal(started.response.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, "in-service");
  assert.equal(started.body.locationTracePoints.some((item) => item.stage === "service-start" && item.verified === true), true);
  assert.equal(started.body.notificationPlans[0].toStatus, "in-service");
  assert.equal(started.body.notificationPlans[0].messages.some((item) => item.channel === "sms" && item.status === "planned"), true);
  const completionEvidence = NursingEscortDomain.buildServiceCompletionEvidence("nursing", started.body, {
    lat: 38.916,
    lng: 121.617,
    source: "nurse-mobile",
    verified: true,
    actions: ["核对身份与医嘱", "完成伤口护理", "居民状态复核"],
    residentConfirmed: true,
    signerName: "TEST-006 resident",
    exceptionReport: { status: "none" },
    archiveAccepted: true,
    archiveTarget: "EMR",
    medicalWaste: {
      received: true,
      wasteTypes: ["used dressing", "disposable gloves"],
      containerSealId: "seal-test006-001",
      receiverId: "hospital-waste-center-test006"
    }
  });
  const completed = await runtime.request(
    "/api/internet-nursing/orders/ino-001/actions",
    nurseToken,
    jsonCommand(nurseToken, "test006-nurse-complete", {
      action: "service-complete",
      status: "completed",
      ...completionEvidence
    })
  );
  assert.equal(completed.response.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.status, "completed");
  assert.equal(completed.body.serviceRecordStatus, "completed");
  assert.equal(completed.body.serviceRecord.careActions.includes("完成伤口护理"), true);
  assert.equal(completed.body.adverseEvent.status, "none");
  assert.equal(completed.body.residentConfirmation.status, "confirmed");
  assert.equal(completed.body.serviceArchiveReceipt.status, "accepted");
  assert.equal(completed.body.medicalWasteHandover.status, "received");
  assert.equal(completed.body.locationTracePoints.some((item) => item.stage === "service-complete"), true);
  assert.equal(completed.body.notificationPlans[0].messages.some((item) => item.channel === "sms" && item.status === "planned"), true);

  const state = await runtime.request("/api/state", commissionToken);
  assert.equal(state.response.status, 200);
  const persisted = state.body.internetNursingOrders.find((item) => item.id === "ino-001");
  assert.equal(persisted.status, "completed");
  assert.equal(state.body.internetNursingOutbox.some((item) => item.aggregateId === "ino-001" && item.status === "pending"), true);
});

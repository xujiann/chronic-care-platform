"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const NursingEscortDomain = require("../nursing-escort-domain");
const { jsonCommand, startCareApiCharacterization } = require("./helpers/care-api-characterization-runtime");

test("internet nursing owner route preserves closed-loop scope idempotency audit outbox and resident feedback", async (t) => {
  const runtime = await startCareApiCharacterization("test006-internet-nursing-loop");
  t.after(runtime.stop);
  const [citizenToken, hospitalToken, nurseToken, commissionToken] = await Promise.all([
    runtime.login("citizen"),
    runtime.login("hospital"),
    runtime.login("nurse"),
    runtime.login("health")
  ]);
  const dashboard = await runtime.request("/api/internet-nursing/dashboard", citizenToken);
  assert.equal(dashboard.response.status, 200);
  const institution = dashboard.body.institutions.find((item) => item.id === "inh-mr1");
  assert.ok(institution);
  const preferredAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    residentId: "r1",
    institutionId: institution.id,
    serviceItem: "wound care",
    serviceObject: "mobility-limited chronic disease patient",
    preferredAt,
    durationMinutes: 90,
    district: "Zhongshan",
    location: { lat: 38.914, lng: 121.614, source: "resident-map" },
    address: "中山区 TEST-006 护理预约地址",
    riskLevel: "medium",
    sourceChannel: "internet-nursing-mobile"
  };
  const created = await runtime.request(
    "/api/internet-nursing/orders",
    citizenToken,
    jsonCommand(citizenToken, "test006-nursing-create-001", payload)
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, "requested");
  assert.equal(created.body.nurseId, undefined);
  assert.equal(created.body.firstVisitAssessment, "pending");
  const replay = await runtime.request(
    "/api/internet-nursing/orders",
    citizenToken,
    jsonCommand(citizenToken, "test006-nursing-create-001", payload)
  );
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.id, created.body.id);
  const conflictingReplay = await runtime.request(
    "/api/internet-nursing/orders",
    citizenToken,
    jsonCommand(citizenToken, "test006-nursing-create-001", { ...payload, durationMinutes: 120 })
  );
  assert.equal(conflictingReplay.response.status, 409);

  const assessmentEvidence = NursingEscortDomain.buildNursingAssessmentEvidence(created.body, {
    eligible: true,
    consentSigned: true,
    identityVerified: true,
    clinicianId: "doctor-test006-001",
    sourceEncounterId: "encounter-test006-001",
    conditions: ["wound-care-followup"],
    contraindicationChecks: [{ code: "home-care-safe", status: "cleared" }],
    signerId: "r1",
    signerName: "TEST-006 resident",
    objectKey: "care-consent/test006-resident.pdf",
    contentHash: `sha256:${"a".repeat(64)}`,
    storageReceiptId: "storage-receipt-test006-001"
  });
  const assessed = await runtime.request(
    `/api/internet-nursing/orders/${created.body.id}/actions`,
    hospitalToken,
    jsonCommand(hospitalToken, "test006-nursing-assess-001", {
      action: "first-visit-assessment",
      status: "assessed",
      firstVisitAssessment: "passed",
      informedConsent: "signed",
      ...assessmentEvidence
    })
  );
  assert.equal(assessed.response.status, 200, JSON.stringify(assessed.body));
  assert.equal(assessed.body.firstVisitAssessment, "passed");
  const dispatch = NursingEscortDomain.evaluateDispatchCandidate(
    "nursing",
    assessed.body,
    dashboard.body.nurses.find((item) => item.id === "inn-001")
  );
  assert.equal(dispatch.eligible, true);
  const dispatched = await runtime.request(
    `/api/internet-nursing/orders/${created.body.id}/actions`,
    hospitalToken,
    jsonCommand(hospitalToken, "test006-nursing-dispatch-001", {
      action: "dispatch-qualified-nurse",
      status: "dispatched",
      nurseId: "inn-001",
      ...dispatch.updates
    })
  );
  assert.equal(dispatched.response.status, 200, JSON.stringify(dispatched.body));
  assert.equal(dispatched.body.status, "dispatched");
  const accepted = await runtime.request(
    `/api/internet-nursing/orders/${created.body.id}/actions`,
    nurseToken,
    jsonCommand(nurseToken, "test006-nursing-accept-001", {
      action: "nurse-accept",
      status: "accepted",
      nurseId: "inn-001",
      tracePoint: { stage: "nurse-accept", lat: 38.914, lng: 121.614, source: "nurse-mobile" }
    })
  );
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, "accepted");
  assert.equal(accepted.body.timelineEvents[0].toStatus, "accepted");
  assert.equal(accepted.body.notificationPlans[0].toStatus, "accepted");

  const closedLoopDashboard = await runtime.request("/api/internet-nursing/dashboard", citizenToken);
  const closedLoopOrder = closedLoopDashboard.body.orders.find((item) => item.id === created.body.id);
  assert.equal(closedLoopOrder.status, "accepted");
  assert.equal(closedLoopOrder.nurseId, "inn-001");
  assert.equal(closedLoopOrder.locationTrace, "pending");
  assert.equal(closedLoopOrder.timelineEvents[0].toStatus, "accepted");
  assert.equal(closedLoopOrder.notificationPlans[0].messages.some((item) => item.channel === "sms" && item.status === "planned"), true);
  const confirmation = await runtime.request(
    `/api/tasks/${encodeURIComponent(`internetNursingOrders:${created.body.id}`)}/actions`,
    citizenToken,
    jsonCommand(citizenToken, "test006-nursing-resident-confirm", {
      action: "resident-confirm",
      comment: "居民确认护理预约"
    })
  );
  assert.equal(confirmation.response.status, 200);
  assert.equal(confirmation.body.residentServiceConfirmation, "confirmed");
  const earlyQuality = await runtime.request(
    `/api/tasks/${encodeURIComponent(`internetNursingOrders:${created.body.id}`)}/actions`,
    citizenToken,
    jsonCommand(citizenToken, "test006-nursing-quality-early", {
      action: "quality-feedback",
      comment: "护理服务尚未完成",
      satisfaction: "满意"
    })
  );
  assert.equal(earlyQuality.response.status, 400);
  assert.match(earlyQuality.body.message, /服务完成后/);
  const crossResident = await runtime.request(
    `/api/tasks/${encodeURIComponent("internetNursingOrders:ino-002")}/actions`,
    citizenToken,
    jsonCommand(citizenToken, "test006-nursing-cross-resident", {
      action: "quality-feedback",
      comment: "越权评价护理服务",
      satisfaction: "满意"
    })
  );
  assert.equal(crossResident.response.status, 403);
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
    `/api/internet-nursing/orders/${created.body.id}/actions`,
    nurseToken,
    jsonCommand(nurseToken, "test006-nursing-service-start", {
      action: "service-start",
      status: "in-service",
      nurseId: "inn-001",
      ...startEvidence
    })
  );
  assert.equal(started.response.status, 200, JSON.stringify(started.body));
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
      containerSealId: "seal-test006-feedback",
      receiverId: "hospital-waste-center-test006"
    }
  });
  const completed = await runtime.request(
    `/api/internet-nursing/orders/${created.body.id}/actions`,
    nurseToken,
    jsonCommand(nurseToken, "test006-nursing-service-complete", {
      action: "service-complete",
      status: "completed",
      nurseId: "inn-001",
      ...completionEvidence
    })
  );
  assert.equal(completed.response.status, 200, JSON.stringify(completed.body));
  const quality = await runtime.request(
    `/api/tasks/${encodeURIComponent(`internetNursingOrders:${created.body.id}`)}/actions`,
    citizenToken,
    jsonCommand(citizenToken, "test006-nursing-quality", {
      action: "quality-feedback",
      comment: "护理服务已评价",
      satisfaction: "不满意",
      complaintStatus: "open"
    })
  );
  assert.equal(quality.response.status, 200);
  assert.equal(quality.body.qualityCallback, "citizen-feedback");
  assert.equal(quality.body.satisfaction, "不满意");
  assert.equal(quality.body.complaintStatus, "open");
  const repeatedQuality = await runtime.request(
    `/api/tasks/${encodeURIComponent(`internetNursingOrders:${created.body.id}`)}/actions`,
    citizenToken,
    jsonCommand(citizenToken, "test006-nursing-quality-repeat", {
      action: "quality-feedback",
      comment: "重复提交护理评价",
      satisfaction: "一般"
    })
  );
  assert.equal(repeatedQuality.response.status, 400);
  assert.match(repeatedQuality.body.message, /请勿重复提交/);

  const unsupported = await runtime.request(
    "/api/internet-nursing/orders",
    citizenToken,
    jsonCommand(citizenToken, "test006-nursing-unsupported", {
      ...payload,
      serviceItem: "vital signs measurement",
      preferredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    })
  );
  assert.equal(unsupported.response.status, 409, JSON.stringify(unsupported.body));
  assert.equal(unsupported.body.code, "NURSING_INTAKE_CATALOG_INVALID");
  assert.match(unsupported.body.message, /outside-institution-catalog/);

  const state = await runtime.request("/api/state", commissionToken);
  assert.equal(state.response.status, 200);
  assert.equal(state.body.internetNursingOrders.filter((item) => item.id === created.body.id).length, 1);
  assert.equal(state.body.internetNursingOutbox.some((item) => item.aggregateId === created.body.id && item.status === "pending"), true);
  assert.equal(state.body.taskMessages.some((item) => item.sourceId === created.body.id), true);
  assert.equal(state.body.securityEvents.some((item) => item.target === `internetNursingOrders:${created.body.id}` && item.result === "allowed"), true);
});

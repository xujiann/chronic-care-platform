"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const EscortService = require("../escort-service");
const NursingEscortDomain = require("../nursing-escort-domain");
const { jsonCommand, startCareApiCharacterization } = require("./helpers/care-api-characterization-runtime");

async function advanceEscortToAccepted(runtime, order, dashboard, token, prefix) {
  const checkedAt = new Date().toISOString();
  const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const eligible = await runtime.request(
    `/api/escort-services/orders/${order.id}/actions`,
    token,
    jsonCommand(token, `${prefix}-eligibility`, {
      status: "eligibility-checked",
      identityVerified: true,
      eligibilityResult: {
        status: "eligible",
        orderId: order.id,
        residentId: order.residentId,
        checkedAt,
        validUntil,
        policyVersion: EscortService.ELIGIBILITY_POLICY_VERSION
      }
    })
  );
  assert.equal(eligible.response.status, 200, JSON.stringify(eligible.body));
  const matched = await runtime.request(
    `/api/escort-services/orders/${order.id}/actions`,
    token,
    jsonCommand(token, `${prefix}-provider-match`, {
      status: "provider-matched",
      contractStatus: "signed",
      insuranceStatus: "covered",
      providerAdmissionSnapshot: {
        status: "approved",
        published: true,
        orderId: order.id,
        providerId: order.providerId,
        verifiedAt: checkedAt,
        validUntil,
        policyVersion: EscortService.PROVIDER_ADMISSION_POLICY_VERSION
      }
    })
  );
  assert.equal(matched.response.status, 200, JSON.stringify(matched.body));
  const worker = dashboard.body.workers.find((item) => item.providerId === order.providerId
    && item.status === "available"
    && order.serviceItems.every((serviceItem) => item.skills.includes(serviceItem)));
  assert.ok(worker);
  const dispatch = NursingEscortDomain.evaluateDispatchCandidate("escort", matched.body, worker);
  assert.equal(dispatch.eligible, true, JSON.stringify(dispatch.blockers));
  const dispatched = await runtime.request(
    `/api/escort-services/orders/${order.id}/actions`,
    token,
    jsonCommand(token, `${prefix}-dispatch`, { status: "worker-dispatched", ...dispatch.updates })
  );
  assert.equal(dispatched.response.status, 200, JSON.stringify(dispatched.body));
  const accepted = await runtime.request(
    `/api/escort-services/orders/${order.id}/actions`,
    token,
    jsonCommand(token, `${prefix}-accept`, { status: "accepted" })
  );
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  return accepted.body;
}

test("escort owner route preserves validation idempotency handoff scope audit and notifications", async (t) => {
  const runtime = await startCareApiCharacterization("test006-escort-owner-route");
  t.after(runtime.stop);
  const [citizenToken, hospitalToken, commissionToken] = await Promise.all([
    runtime.login("citizen"),
    runtime.login("hospital"),
    runtime.login("health")
  ]);
  const dashboard = await runtime.request("/api/escort-services/dashboard", citizenToken);
  assert.equal(dashboard.response.status, 200);
  const providerId = dashboard.body.providers.find((item) => item.published !== false)?.id;
  assert.ok(providerId);
  const appointmentAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    residentId: "r1",
    providerId,
    hospital: "Dalian Central Hospital outpatient clinic demo",
    hospitalCode: "MR1",
    department: "Cardiology",
    appointmentAt,
    serviceItems: ["exam escort"],
    sourceChannel: "citizen.html"
  };

  const created = await runtime.request(
    "/api/escort-services/orders",
    citizenToken,
    jsonCommand(citizenToken, "test006-escort-create-001", payload)
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, "requested");
  assert.equal(created.body.residentId, "r1");
  assert.equal(created.body.workerId, "");
  const replay = await runtime.request(
    "/api/escort-services/orders",
    citizenToken,
    jsonCommand(citizenToken, "test006-escort-create-001", payload)
  );
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.id, created.body.id);
  const conflictingReplay = await runtime.request(
    "/api/escort-services/orders",
    citizenToken,
    jsonCommand(citizenToken, "test006-escort-create-001", { ...payload, priority: "high" })
  );
  assert.equal(conflictingReplay.response.status, 409);

  const missingHospital = await runtime.request(
    "/api/escort-services/orders",
    citizenToken,
    jsonCommand(citizenToken, "test006-escort-missing-hospital", {
      residentId: "r1",
      providerId,
      appointmentAt,
      serviceItems: ["registration", "exam escort"]
    })
  );
  assert.equal(missingHospital.response.status, 400);
  assert.match(missingHospital.body.message, /intake-hospital-missing/);
  const missingRegistration = await runtime.request(
    "/api/escort-services/orders",
    citizenToken,
    jsonCommand(citizenToken, "test006-escort-missing-registration", {
      residentId: "r1",
      providerId,
      registrationOrderId: "reg-missing-test006",
      serviceItems: ["exam escort"]
    })
  );
  assert.equal(missingRegistration.response.status, 400);
  assert.equal(missingRegistration.body.code, "ESCORT_REGISTRATION_NOT_FOUND");

  await advanceEscortToAccepted(runtime, created.body, dashboard, hospitalToken, "test006-escort-confirm");

  const confirmed = await runtime.request(
    `/api/escort-services/orders/${created.body.id}/hospital-handoff`,
    hospitalToken,
    jsonCommand(hospitalToken, "test006-escort-handoff-confirm", {
      decision: "confirm",
      hospitalCode: "MR1",
      hospitalCheckInStatus: "confirmed",
      hospitalCheckInNo: "OP-MR1-TEST006-001",
      hisVisitId: "HIS-MR1-TEST006-001",
      appointmentSource: "hospital-outpatient-guidance",
      departmentCode: "CARD",
      doctorCode: "DOC-CARD-01",
      outpatientQueueNo: "C08",
      hospitalDepartmentContact: "Cardiology outpatient guidance desk",
      appointmentAt,
      hospitalNotice: "Arrive 20 minutes early and bring ID card."
    })
  );
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, "hospital-confirmed");
  assert.equal(confirmed.body.auditTrail.some((item) => item.action === "transition:accepted->hospital-confirmed"), true);

  const residentConfirmation = await runtime.request(
    `/api/tasks/${encodeURIComponent(`escortServiceOrders:${created.body.id}`)}/actions`,
    citizenToken,
    jsonCommand(citizenToken, "test006-escort-resident-confirm", {
      action: "resident-confirm",
      comment: "居民确认陪诊安排"
    })
  );
  assert.equal(residentConfirmation.response.status, 200);
  assert.equal(residentConfirmation.body.familyContactStatus, "confirmed");
  const quality = await runtime.request(
    `/api/tasks/${encodeURIComponent(`escortServiceOrders:${created.body.id}`)}/actions`,
    citizenToken,
    jsonCommand(citizenToken, "test006-escort-quality", {
      action: "quality-feedback",
      comment: "陪诊服务满意",
      satisfaction: "满意",
      complaintStatus: "none"
    })
  );
  assert.equal(quality.response.status, 200);
  assert.equal(quality.body.qualityReview, "citizen-feedback");

  const returnPayload = { ...payload, residentId: "r4", appointmentAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() };
  const returnCandidate = await runtime.request(
    "/api/escort-services/orders",
    citizenToken,
    jsonCommand(citizenToken, "test006-escort-return-create", returnPayload)
  );
  assert.equal(returnCandidate.response.status, 201, JSON.stringify(returnCandidate.body));
  await advanceEscortToAccepted(runtime, returnCandidate.body, dashboard, hospitalToken, "test006-escort-return");
  const returned = await runtime.request(
    `/api/escort-services/orders/${returnCandidate.body.id}/hospital-handoff`,
    hospitalToken,
    jsonCommand(hospitalToken, "test006-escort-handoff-return", {
      decision: "reject",
      note: "hospital capacity changed"
    })
  );
  assert.equal(returned.response.status, 200, JSON.stringify(returned.body));
  assert.equal(returned.body.status, "hospital-returned");
  assert.equal(returned.body.hospitalInterfaceStatus, "returned");

  const crossResident = await runtime.request(
    `/api/tasks/${encodeURIComponent("escortServiceOrders:eso-r2-20260621")}/actions`,
    citizenToken,
    jsonCommand(citizenToken, "test006-escort-cross-resident", { action: "resident-confirm", comment: "越权确认" })
  );
  assert.equal(crossResident.response.status, 403);

  const state = await runtime.request("/api/state", commissionToken);
  assert.equal(state.response.status, 200);
  assert.equal(state.body.escortServiceOrders.filter((item) => item.id === created.body.id).length, 1);
  assert.equal(state.body.escortServiceOutbox.some((item) => item.aggregateId === created.body.id && item.status === "pending"), true);
  assert.equal(state.body.taskMessages.some((item) => item.sourceId === created.body.id), true);
  assert.equal(state.body.securityEvents.some((item) => item.target === `escortServiceOrders:${created.body.id}` && item.result === "allowed"), true);
});

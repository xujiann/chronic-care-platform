const test = require("node:test");
const assert = require("node:assert/strict");

const seed = require("../data/db.json");
const { normalizeChronicFollowupCase, normalizeReferralCase } = require("../registration-referral-domain");
const {
  CLOSURE_COMMAND_CONTRACTS,
  applyClosureCommand
} = require("../registration-referral-service");

function data() {
  return JSON.parse(JSON.stringify(seed));
}

const institution = { role: "institution", orgCode: "MR3", username: "doc-liu", name: "Doctor Liu" };
const commission = { role: "commission", username: "commission", name: "Commission Operator" };
const citizenR1 = { role: "citizen", username: "resident-r1", name: "Resident One", residentIds: ["r1"] };
const citizenR2 = { role: "citizen", username: "resident-r2", name: "Resident Two", residentIds: ["r2"] };
const citizenR4 = { role: "citizen", username: "resident-r4", name: "Resident Four", residentIds: ["r4"] };

test("command catalog covers registration, primary care, referral, follow-up, receipts and escalation", () => {
  const actions = new Set(CLOSURE_COMMAND_CONTRACTS.map((item) => item.action));
  [
    "advance-registration",
    "apply-registration-callback",
    "record-primary-care-assessment",
    "create-referral-from-primary-care",
    "accept-referral-continuity",
    "complete-chronic-followup",
    "acknowledge-chronic-followup",
    "acknowledge-family-doctor-fulfillment",
    "record-notification-receipt",
    "run-notification-fallback",
    "escalate-case"
  ].forEach((action) => assert.ok(actions.has(action), action));
  assert.ok(CLOSURE_COMMAND_CONTRACTS.every((item) => item.suggestedEndpoint && item.roles.length && item.requiredFields.length));
});

test("primary care assessment creates a local follow-up and is idempotent", () => {
  const source = data();
  const command = {
    commandId: "cmd-primary-local-1",
    action: "record-primary-care-assessment",
    residentId: "r1",
    at: "2026-07-22T09:00:00.000Z",
    payload: {
      institutionCode: "MR3",
      institutionName: "Qingniwaqiao Community Health Service Center",
      doctorId: "doc-liu",
      diagnosis: "hypertension",
      assessment: "Stable after primary-care review.",
      disposition: "manage-locally",
      nextFollowupAt: "2026-08-01",
      note: "Continue community management."
    }
  };
  const first = applyClosureCommand(source, command, institution);
  assert.equal(first.idempotent, false);
  assert.equal(first.result.assessment.status, "completed");
  assert.equal(first.result.followup.primaryCareAssessmentId, first.result.assessment.id);
  assert.equal(first.result.followup.residentId, "r1");
  assert.equal(first.event.caseId, first.result.assessment.id);
  assert.equal(first.event.productionEvidence, false);
  assert.equal(source.primaryCareAssessments, undefined, "source data must remain unchanged");

  const repeated = applyClosureCommand(first.data, command, institution);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.data.primaryCareAssessments.filter((item) => item.id === first.result.assessment.id).length, 1);
});

test("idempotency keys bind request content, actor scope and execution policy", () => {
  const command = {
    commandId: "cmd-fingerprint-primary-care",
    action: "record-primary-care-assessment",
    residentId: "r1",
    at: "2026-07-22T09:05:00.000Z",
    payload: {
      institutionCode: "MR3",
      doctorId: "doc-liu",
      diagnosis: "hypertension",
      assessment: "Fingerprint baseline.",
      disposition: "refer-up"
    }
  };
  const first = applyClosureCommand(data(), command, institution);
  assert.match(first.event.commandFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(applyClosureCommand(first.data, command, institution).idempotent, true);

  assert.throws(() => applyClosureCommand(first.data, {
    ...command,
    payload: { ...command.payload, assessment: "Altered payload." }
  }, institution), /idempotency key conflict/);
  assert.throws(() => applyClosureCommand(first.data, command, {
    ...institution,
    username: "different-doctor",
    name: "Different Doctor"
  }), /idempotency key conflict/);
  assert.throws(() => applyClosureCommand(first.data, {
    commandId: command.commandId,
    action: "escalate-case",
    caseType: "chronic-followup",
    caseId: "f1",
    payload: { note: "Conflicting action." }
  }, institution), /idempotency key conflict/);

  const legacy = data();
  legacy.registrationReferralClosureEvents = [{ id: "legacy-event", commandId: command.commandId, action: command.action }];
  assert.throws(() => applyClosureCommand(legacy, command, institution), /idempotency key conflict/);

  const withoutSuppliedTime = {
    commandId: "cmd-fingerprint-generated-time",
    action: "record-primary-care-assessment",
    residentId: "r1",
    payload: {
      institutionCode: "MR3",
      doctorId: "doc-liu",
      diagnosis: "hypertension",
      assessment: "Generated timestamp replay.",
      disposition: "refer-up"
    }
  };
  const generatedTimeFirst = applyClosureCommand(data(), withoutSuppliedTime, institution);
  assert.equal(applyClosureCommand(generatedTimeFirst.data, withoutSuppliedTime, institution).idempotent, true);

  const fallbackCommand = {
    commandId: "cmd-fingerprint-policy",
    action: "run-notification-fallback",
    payload: { messageId: "msg-rtc-001-feedback-institution", note: "Policy-bound retry." }
  };
  const policyA = { channels: [{ channel: "in_app", maxAttempts: 1 }, { channel: "manual-task", maxAttempts: 1 }] };
  const policyB = { channels: [{ channel: "sms", maxAttempts: 1 }, { channel: "manual-task", maxAttempts: 1 }] };
  const fallbackFirst = applyClosureCommand(data(), fallbackCommand, commission, { notificationPolicy: policyA });
  assert.throws(
    () => applyClosureCommand(fallbackFirst.data, fallbackCommand, commission, { notificationPolicy: policyB }),
    /idempotency key conflict/
  );
});

test("primary care teleconsultation creates a resident-consistent referral chain", () => {
  const assessed = applyClosureCommand(data(), {
    commandId: "cmd-primary-tele-1",
    action: "record-primary-care-assessment",
    residentId: "r1",
    at: "2026-07-22T09:10:00.000Z",
    payload: {
      institutionCode: "MR3",
      institutionName: "Qingniwaqiao Community Health Service Center",
      doctorId: "doc-liu",
      diagnosis: "hypertension",
      assessment: "Control remains poor after medication adjustment.",
      disposition: "teleconsultation",
      note: "Request specialist review."
    }
  }, institution);
  const assessmentId = assessed.result.assessment.id;
  const referred = applyClosureCommand(assessed.data, {
    commandId: "cmd-primary-referral-1",
    action: "create-referral-from-primary-care",
    caseType: "primary-care",
    caseId: assessmentId,
    at: "2026-07-22T09:15:00.000Z",
    payload: {
      targetInstitution: "Dalian Central Hospital",
      targetInstitutionCode: "MR1",
      department: "Cardiology",
      residentAuthorizationId: "auth-r1-referral-demo",
      due: "2026-07-23T12:00:00.000Z",
      priority: "high",
      clinicalQuestion: "Review resistant hypertension plan.",
      materials: ["primary-care summary", "blood pressure log"],
      note: "Authorized teleconsultation referral."
    }
  }, institution);
  const { referral, collaborationOrder, teleconsultation } = referred.result;
  assert.equal(referral.collaborationOrderId, collaborationOrder.id);
  assert.equal(teleconsultation.collaborationOrderId, collaborationOrder.id);
  assert.equal(teleconsultation.referralId, referral.id);
  assert.equal(teleconsultation.residentId, collaborationOrder.residentId);
  assert.equal(referred.consistency.dataReady, true);
  assert.equal(referred.result.message.targetOrgCode, "MR1");
});

test("primary care referral rejects missing authorization and institution scope mismatch", () => {
  const assessed = applyClosureCommand(data(), {
    commandId: "cmd-primary-refer-denied",
    action: "record-primary-care-assessment",
    residentId: "r1",
    at: "2026-07-22T09:20:00.000Z",
    payload: { institutionCode: "MR3", doctorId: "doc-liu", diagnosis: "hypertension", assessment: "Needs referral.", disposition: "refer-up" }
  }, institution);
  assert.throws(() => applyClosureCommand(assessed.data, {
    commandId: "cmd-referral-no-auth",
    action: "create-referral-from-primary-care",
    caseId: assessed.result.assessment.id,
    payload: { targetInstitution: "Hospital", targetInstitutionCode: "MR1", residentAuthorizationId: "missing", due: "2026-07-23" }
  }, institution), /authorization not found/);
  assert.throws(() => applyClosureCommand(data(), {
    commandId: "cmd-wrong-scope",
    action: "record-primary-care-assessment",
    residentId: "r1",
    payload: { institutionCode: "MR1", doctorId: "doc-liu", diagnosis: "hypertension", assessment: "Assessment.", disposition: "refer-up" }
  }, institution), /institution scope denied/);

  const restricted = JSON.parse(JSON.stringify(assessed.data));
  const authorization = restricted.personalRecords.find((item) => item.id === "auth-r1-referral-demo");
  authorization.meta.authorizedTo = ["MR3"];
  assert.throws(() => applyClosureCommand(restricted, {
    commandId: "cmd-referral-target-denied",
    action: "create-referral-from-primary-care",
    caseId: assessed.result.assessment.id,
    payload: { targetInstitution: "Hospital", targetInstitutionCode: "MR1", residentAuthorizationId: "auth-r1-referral-demo", due: "2026-07-23" }
  }, institution), /does not cover target institution/);
});

test("institution commands fail closed without orgCode while commission keeps the explicit supervision exception", () => {
  const unscopedInstitution = { role: "institution", username: "unscoped-doctor", name: "Unscoped Doctor" };
  assert.throws(() => applyClosureCommand(data(), {
    commandId: "cmd-unscoped-primary-care",
    action: "record-primary-care-assessment",
    residentId: "r1",
    payload: { institutionCode: "MR3", doctorId: "doc-unscoped", diagnosis: "hypertension", assessment: "Assessment.", disposition: "refer-up" }
  }, unscopedInstitution), /actor orgCode is required/);
  assert.throws(() => applyClosureCommand(data(), {
    commandId: "cmd-unscoped-registration",
    action: "advance-registration",
    caseType: "registration",
    caseId: "reg-r1-20260630-cardio",
    payload: { action: "confirm-his-demo", note: "Missing institution scope." }
  }, unscopedInstitution), /actor orgCode is required/);
  assert.throws(() => applyClosureCommand(data(), {
    commandId: "cmd-unscoped-callback",
    action: "apply-registration-callback",
    caseType: "registration",
    caseId: "reg-r1-20260630-cardio",
    at: "2026-07-22T09:25:00.000Z",
    payload: { callback: { eventType: "payment-succeeded", orderNo: "REG-MR1-C08", occurredAt: "2026-07-22T09:25:00.000Z" } }
  }, unscopedInstitution), /actor orgCode is required/);
  assert.throws(() => applyClosureCommand(data(), {
    commandId: "cmd-unscoped-escalation",
    action: "escalate-case",
    caseType: "chronic-followup",
    caseId: "f1",
    payload: { note: "Missing institution scope." }
  }, unscopedInstitution), /actor orgCode is required/);
  const scopedMessageData = data();
  scopedMessageData.taskMessages.find((item) => item.id === "msg-rtc-001-feedback-institution").targetOrgCode = "MR3";
  assert.throws(() => applyClosureCommand(scopedMessageData, {
    commandId: "cmd-unscoped-message-receipt",
    action: "record-notification-receipt",
    payload: { messageId: "msg-rtc-001-feedback-institution", status: "handled" }
  }, unscopedInstitution), /notification message scope denied/);
  assert.throws(() => applyClosureCommand(scopedMessageData, {
    commandId: "cmd-unscoped-message-fallback",
    action: "run-notification-fallback",
    payload: { messageId: "msg-rtc-001-feedback-institution", note: "Missing institution scope." }
  }, unscopedInstitution), /notification message scope denied/);

  const supervised = applyClosureCommand(data(), {
    commandId: "cmd-commission-cross-org-assessment",
    action: "record-primary-care-assessment",
    residentId: "r1",
    payload: { institutionCode: "MR9", doctorId: "commission-review", diagnosis: "hypertension", assessment: "Regulatory supervision assessment.", disposition: "refer-up" }
  }, commission);
  assert.equal(supervised.result.assessment.institutionCode, "MR9");
});

test("resident registration actions are bound to the order resident", () => {
  const source = data();
  const originalPaymentStatus = source.registrationOrders.find((item) => item.id === "reg-r1-20260630-cardio").paymentStatus;
  assert.throws(() => applyClosureCommand(source, {
    commandId: "cmd-r2-pay-r1-registration",
    action: "advance-registration",
    caseType: "registration",
    caseId: "reg-r1-20260630-cardio",
    payload: { action: "pay-demo", note: "Attempted payment for another resident." }
  }, citizenR2), /resident scope denied/);
  assert.equal(source.registrationOrders.find((item) => item.id === "reg-r1-20260630-cardio").paymentStatus, originalPaymentStatus);

  const supervised = applyClosureCommand(source, {
    commandId: "cmd-commission-pay-r1-registration",
    action: "advance-registration",
    caseType: "registration",
    caseId: "reg-r1-20260630-cardio",
    payload: { action: "pay-demo", note: "Commission supervision exception." }
  }, commission);
  assert.equal(supervised.result.order.paymentStatus, "paid-demo");
});

test("referral authorization must be explicitly active, unexpired and applicable", () => {
  const assessed = applyClosureCommand(data(), {
    commandId: "cmd-auth-eligibility-assessment",
    action: "record-primary-care-assessment",
    residentId: "r1",
    at: "2026-07-22T09:20:00.000Z",
    payload: { institutionCode: "MR3", doctorId: "doc-liu", diagnosis: "hypertension", assessment: "Needs referral.", disposition: "teleconsultation" }
  }, institution);
  const referralCommand = {
    action: "create-referral-from-primary-care",
    caseId: assessed.result.assessment.id,
    at: "2026-07-22T09:30:00.000Z",
    payload: { targetInstitution: "Hospital", targetInstitutionCode: "MR1", residentAuthorizationId: "auth-r1-referral-demo", due: "2026-07-23" }
  };

  const pending = JSON.parse(JSON.stringify(assessed.data));
  const pendingAuthorization = pending.personalRecords.find((item) => item.id === "auth-r1-referral-demo");
  pendingAuthorization.status = "pending";
  pendingAuthorization.meta.status = "pending";
  assert.throws(() => applyClosureCommand(pending, { ...referralCommand, commandId: "cmd-auth-pending" }, institution), /active unexpired resident teleconsultation authorization not found/);

  const expired = JSON.parse(JSON.stringify(assessed.data));
  expired.personalRecords.find((item) => item.id === "auth-r1-referral-demo").expiresAt = "2025-01-01";
  assert.throws(() => applyClosureCommand(expired, { ...referralCommand, commandId: "cmd-auth-expired" }, institution), /active unexpired resident teleconsultation authorization not found/);

  const wrongScope = JSON.parse(JSON.stringify(assessed.data));
  wrongScope.personalRecords.find((item) => item.id === "auth-r1-referral-demo").meta.scope = "down-referral-feedback";
  assert.throws(() => applyClosureCommand(wrongScope, { ...referralCommand, commandId: "cmd-auth-wrong-scope" }, institution), /active unexpired resident teleconsultation authorization not found/);

  const noTarget = JSON.parse(JSON.stringify(assessed.data));
  noTarget.personalRecords.find((item) => item.id === "auth-r1-referral-demo").meta.authorizedTo = [];
  assert.throws(() => applyClosureCommand(noTarget, { ...referralCommand, commandId: "cmd-auth-no-target" }, institution), /does not cover target institution/);
});

test("registration commands reuse the existing journey and reject late callbacks", () => {
  const paid = applyClosureCommand(data(), {
    commandId: "cmd-reg-pay-1",
    action: "advance-registration",
    caseType: "registration",
    caseId: "reg-r1-20260630-cardio",
    at: "2026-07-22T09:30:00.000Z",
    payload: { action: "pay-demo", note: "Resident completed demo payment." }
  }, citizenR1);
  assert.equal(paid.result.order.paymentStatus, "paid-demo");
  assert.equal(paid.result.order.productionReady, false);
  assert.equal(paid.result.message.collection, "registrationOrders");

  const terminal = data();
  terminal.registrationOrders[0].status = "completed";
  assert.throws(() => applyClosureCommand(terminal, {
    commandId: "cmd-reg-late-insurance",
    action: "apply-registration-callback",
    caseType: "registration",
    caseId: "reg-r1-20260630-cardio",
    at: "2026-07-22T09:31:00.000Z",
    payload: { callback: { eventType: "insurance-confirmed", orderNo: "REG-MR1-C08", occurredAt: "2026-07-22T09:31:00.000Z" } }
  }, { role: "insurance", username: "insurance" }), /not allowed after order closure/);
});

test("notification receipts enforce resident scope and preserve business acknowledgement", () => {
  const messageId = "msg-rtc-002-report-citizen";
  assert.throws(() => applyClosureCommand(data(), {
    commandId: "cmd-receipt-wrong-resident",
    action: "record-notification-receipt",
    payload: { messageId, status: "read" }
  }, citizenR1), /scope denied/);
  const acknowledged = applyClosureCommand(data(), {
    commandId: "cmd-receipt-r4",
    action: "record-notification-receipt",
    at: "2026-07-22T10:00:00.000Z",
    payload: { messageId, status: "acknowledged", channel: "in_app", note: "Report notice reviewed." }
  }, citizenR4);
  assert.equal(acknowledged.result.receiptState, "acknowledged");
  assert.equal(acknowledged.result.message.receipts[0].role, "citizen");
  assert.equal(acknowledged.result.message.receipts[0].productionEvidence, false);
});

test("notification fallback advances to a manual task under a bounded policy", () => {
  const policy = { channels: [
    { channel: "in_app", maxAttempts: 1 },
    { channel: "sms", maxAttempts: 1 },
    { channel: "phone", maxAttempts: 1 },
    { channel: "manual-task", maxAttempts: 1 }
  ] };
  let current = data();
  const messageId = "msg-rtc-001-feedback-institution";
  const channels = [];
  for (let index = 1; index <= 4; index += 1) {
    const result = applyClosureCommand(current, {
      commandId: `cmd-fallback-${index}`,
      action: "run-notification-fallback",
      at: `2026-07-22T10:0${index}:00.000Z`,
      payload: { messageId, note: `Fallback attempt ${index}.` }
    }, commission, { notificationPolicy: policy });
    channels.push(result.result.nextChannel);
    current = result.data;
  }
  assert.deepEqual(channels, ["in_app", "sms", "phone", "manual-task"]);
  assert.ok(current.taskMessages.some((item) => item.notificationKey === `registration-referral:manual-fallback:${messageId}`));
});

test("county supervision may trigger referral fallback but cannot acknowledge for the institution", () => {
  const county = { role: "county", orgCode: "COUNTY-1", username: "county-duty", name: "County Duty" };
  const messageId = "msg-rtc-001-feedback-institution";
  const fallback = applyClosureCommand(data(), {
    commandId: "cmd-county-fallback",
    action: "run-notification-fallback",
    payload: { messageId, note: "County supervision triggered delivery fallback." }
  }, county);
  assert.equal(fallback.result.nextChannel, "in_app");
  assert.throws(() => applyClosureCommand(data(), {
    commandId: "cmd-county-false-ack",
    action: "record-notification-receipt",
    payload: { messageId, status: "handled", note: "County cannot acknowledge for institution." }
  }, county), /scope denied/);
});

test("primary care acceptance closes returned referral and creates follow-up responsibility", () => {
  const result = applyClosureCommand(data(), {
    commandId: "cmd-continuity-r4",
    action: "accept-referral-continuity",
    caseType: "referral-teleconsultation",
    caseId: "rtc-002",
    at: "2026-07-22T10:30:00.000Z",
    payload: {
      note: "Primary care accepted the returned specialist report.",
      nextFollowupAt: "2026-07-29",
      familyDoctorContractId: "p2fdc-r4",
      assignee: "Doctor Liu"
    }
  }, institution);
  assert.equal(result.result.teleconsultation.status, "closed");
  assert.equal(result.result.teleconsultation.primaryCareAccepted, true);
  assert.equal(result.result.followup.familyDoctorContractId, "p2fdc-r4");
  const envelope = normalizeReferralCase(result.result.teleconsultation, { messages: result.data.taskMessages });
  assert.equal(envelope.unifiedPhase, "closed");
  assert.equal(result.consistency.dataReady, true);
});

test("chronic follow-up requires completion then resident acknowledgement", () => {
  const completed = applyClosureCommand(data(), {
    commandId: "cmd-followup-complete-r2",
    action: "complete-chronic-followup",
    caseType: "chronic-followup",
    caseId: "f2",
    at: "2026-07-22T11:00:00.000Z",
    payload: { result: "Blood glucose reviewed.", advice: "Repeat HbA1c in three months.", note: "Follow-up completed by phone." }
  }, commission);
  assert.equal(normalizeChronicFollowupCase(completed.result.followup, { messages: completed.data.taskMessages }).unifiedPhase, "result-returned");
  const acknowledged = applyClosureCommand(completed.data, {
    commandId: "cmd-followup-ack-r2",
    action: "acknowledge-chronic-followup",
    caseType: "chronic-followup",
    caseId: "f2",
    at: "2026-07-22T11:10:00.000Z",
    payload: { note: "Resident understood the follow-up advice." }
  }, citizenR2);
  assert.equal(acknowledged.result.followup.feedbackStatus, "acknowledged");
  assert.equal(normalizeChronicFollowupCase(acknowledged.result.followup, { messages: acknowledged.data.taskMessages }).unifiedPhase, "closed");
});

test("family doctor fulfillment acknowledgement is resident scoped", () => {
  assert.throws(() => applyClosureCommand(data(), {
    commandId: "cmd-family-wrong-resident",
    action: "acknowledge-family-doctor-fulfillment",
    caseType: "family-doctor",
    caseId: "p2fdf-r1-bp",
    payload: { note: "Wrong resident." }
  }, citizenR2), /resident scope denied/);
  const result = applyClosureCommand(data(), {
    commandId: "cmd-family-r1-ack",
    action: "acknowledge-family-doctor-fulfillment",
    caseType: "family-doctor",
    caseId: "p2fdf-r1-bp",
    at: "2026-07-22T11:30:00.000Z",
    payload: { note: "Service confirmed.", satisfactionScore: 98 }
  }, citizenR1);
  assert.equal(result.result.fulfillment.residentAcknowledgement.status, "acknowledged");
  assert.equal(result.result.contract.satisfactionScore, 98);
  assert.equal(result.result.message.receipts[0].status, "acknowledged");
});

test("case escalation creates one audited task and rejects terminal cases", () => {
  const command = {
    commandId: "cmd-escalate-f1",
    action: "escalate-case",
    caseType: "chronic-followup",
    caseId: "f1",
    at: "2026-07-22T12:00:00.000Z",
    payload: { note: "Overdue high-risk follow-up requires same-day handling.", severity: "high" }
  };
  const first = applyClosureCommand(data(), command, commission);
  assert.equal(first.result.escalation.status, "open");
  assert.equal(first.result.message.targetRole, "family-doctor-team");
  const repeated = applyClosureCommand(first.data, command, commission);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.data.registrationReferralEscalations.length, 1);

  const terminal = data();
  terminal.followups.find((item) => item.id === "f4").status = "closed";
  terminal.taskMessages.push({ id: "msg-f4-ack", sourceId: "f4", residentId: "r3", targetRole: "citizen", status: "acknowledged", receipts: [{ status: "acknowledged" }] });
  assert.throws(() => applyClosureCommand(terminal, { ...command, commandId: "cmd-escalate-closed", caseId: "f4" }, commission), /terminal closure case/);
});

test("every successful command records non-production audit evidence", () => {
  const result = applyClosureCommand(data(), {
    commandId: "cmd-audit-evidence",
    action: "record-primary-care-assessment",
    residentId: "r1",
    at: "2026-07-22T12:30:00.000Z",
    payload: { institutionCode: "MR3", doctorId: "doc-liu", diagnosis: "hypertension", assessment: "Review complete.", disposition: "refer-up" }
  }, institution);
  assert.equal(result.event.result, "allowed");
  assert.equal(result.event.productionEvidence, false);
  assert.equal(result.data.registrationReferralClosureEvents[0].commandId, "cmd-audit-evidence");
  assert.match(result.boundary, /mutated copy only/);
});

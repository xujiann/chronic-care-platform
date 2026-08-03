const test = require("node:test");
const assert = require("node:assert/strict");

const seed = require("../data/db.json");
const {
  normalizeReferralCase,
  validateClosureEventChain
} = require("../registration-referral-domain");
const {
  CLOSURE_COMMAND_CONTRACTS,
  applyClosureCommand
} = require("../registration-referral-service");

function data() {
  return JSON.parse(JSON.stringify(seed));
}

const mr1 = { role: "institution", orgCode: "MR1", username: "doc-mr1", name: "MR1 Doctor" };
const mr3 = { role: "institution", orgCode: "MR3", username: "doc-mr3", name: "MR3 Doctor" };
const commission = { role: "commission", username: "commission", name: "Commission" };
const citizenR1 = { role: "citizen", username: "resident-r1", name: "Resident One", residentIds: ["r1"] };

function run(source, commandId, action, actor, fields = {}) {
  return applyClosureCommand(source, {
    commandId,
    action,
    at: fields.at || "2026-07-23T08:00:00.000Z",
    caseType: fields.caseType || "",
    caseId: fields.caseId || "",
    residentId: fields.residentId || "",
    payload: fields.payload || {}
  }, actor);
}

test("advanced catalog adds down-referral supplement and family scheduler commands", () => {
  const actions = new Set(CLOSURE_COMMAND_CONTRACTS.map((item) => item.action));
  [
    "create-down-referral",
    "request-referral-supplement",
    "submit-referral-supplement",
    "review-referral-supplement",
    "run-family-doctor-scheduler"
  ].forEach((action) => assert.ok(actions.has(action), action));
  assert.equal(CLOSURE_COMMAND_CONTRACTS.length, 45);
});

test("down-referral completes two-round material supplementation and primary-care continuity", () => {
  let current = data();
  assert.throws(() => run(current, "down-wrong-source", "create-down-referral", mr3, {
    residentId: "r4",
    payload: {
      externalReferralId: "EXT-DOWN-ADVANCED-WRONG",
      sourceInstitutionCode: "MR1",
      sourceInstitution: "Dalian Central Hospital",
      targetInstitutionCode: "MR3",
      targetInstitution: "Qingniwaqiao Community Health Service Center",
      residentAuthorizationId: "auth-r4-referral-demo",
      familyDoctorContractId: "p2fdc-r4",
      diseaseType: "hypertension rehabilitation",
      reason: "Stable after discharge.",
      due: "2026-07-25T08:00:00.000Z",
      note: "Must fail source scope."
    }
  }), /institution scope denied/);

  current = run(current, "down-create", "create-down-referral", mr1, {
    residentId: "r4",
    at: "2026-07-23T08:00:00.000Z",
    payload: {
      referralId: "rf-down-advanced",
      collaborationOrderId: "cco-down-advanced",
      externalReferralId: "EXT-DOWN-ADVANCED-001",
      sourceInstitutionCode: "MR1",
      sourceInstitution: "Dalian Central Hospital",
      targetInstitutionCode: "MR3",
      targetInstitution: "Qingniwaqiao Community Health Service Center",
      residentAuthorizationId: "auth-r4-referral-demo",
      familyDoctorContractId: "p2fdc-r4",
      dischargeSummaryId: "discharge-r4-advanced",
      diseaseType: "hypertension rehabilitation",
      reason: "Stable after discharge; continue primary-care monitoring.",
      due: "2026-07-25T08:00:00.000Z",
      note: "Initiate down-referral."
    }
  });
  const referralId = current.result.referral.id;
  assert.equal(current.result.referral.direction, "downward");
  assert.equal(current.result.collaborationOrder.residentId, "r4");
  assert.equal(normalizeReferralCase(current.result.referral).responsibleOrg, "MR3");
  assert.throws(() => run(current.data, "down-duplicate-external", "create-down-referral", mr1, {
    residentId: "r4",
    payload: {
      externalReferralId: "EXT-DOWN-ADVANCED-001",
      sourceInstitutionCode: "MR1",
      sourceInstitution: "Dalian Central Hospital",
      targetInstitutionCode: "MR3",
      targetInstitution: "Qingniwaqiao Community Health Service Center",
      residentAuthorizationId: "auth-r4-referral-demo",
      familyDoctorContractId: "p2fdc-r4",
      diseaseType: "hypertension rehabilitation",
      reason: "Duplicate external referral.",
      due: "2026-07-25T08:00:00.000Z",
      note: "Must be rejected."
    }
  }), /externalReferralId already exists/);

  current = run(current.data, "down-supplement-request-1", "request-referral-supplement", mr3, {
    caseId: referralId,
    at: "2026-07-23T09:00:00.000Z",
    payload: {
      requirements: [
        { id: "discharge-summary", description: "Signed discharge summary" },
        { id: "medication-plan", description: "Current medication plan" }
      ],
      dueAt: "2026-07-24T09:00:00.000Z",
      note: "Primary care requires signed discharge materials."
    }
  });
  assert.equal(current.result.referral.status, "supplement-required");
  assert.equal(normalizeReferralCase(current.result.referral).responsibleOrg, "MR1");

  current = run(current.data, "down-supplement-submit-1", "submit-referral-supplement", mr1, {
    caseId: referralId,
    at: "2026-07-23T10:00:00.000Z",
    payload: {
      fulfilledRequirementIds: ["discharge-summary", "medication-plan"],
      materials: [
        { id: "mat-discharge", name: "Discharge summary", type: "discharge-summary", digest: "a".repeat(64), version: 1 },
        { id: "mat-medication", name: "Medication plan", type: "medication-plan", digest: "b".repeat(64), version: 1 }
      ],
      note: "Submit signed discharge package."
    }
  });
  assert.equal(current.result.referral.status, "supplement-submitted");
  assert.equal(normalizeReferralCase(current.result.referral).responsibleOrg, "MR3");

  current = run(current.data, "down-supplement-reject", "review-referral-supplement", mr3, {
    caseId: referralId,
    at: "2026-07-23T11:00:00.000Z",
    payload: {
      decision: "rejected",
      requirements: [{ id: "medication-plan", description: "Medication plan must include a physician signature" }],
      dueAt: "2026-07-24T11:00:00.000Z",
      note: "Medication plan signature is missing."
    }
  });
  assert.equal(current.result.referral.status, "supplement-required");

  current = run(current.data, "down-supplement-submit-2", "submit-referral-supplement", mr1, {
    caseId: referralId,
    at: "2026-07-23T12:00:00.000Z",
    payload: {
      fulfilledRequirementIds: ["medication-plan"],
      materials: [
        { id: "mat-medication", name: "Signed medication plan", type: "medication-plan", digest: "c".repeat(64), version: 2 }
      ],
      note: "Submit physician-signed medication plan."
    }
  });
  current = run(current.data, "down-supplement-approve", "review-referral-supplement", mr3, {
    caseId: referralId,
    at: "2026-07-23T13:00:00.000Z",
    payload: { decision: "approved", note: "Supplement is complete." }
  });
  assert.equal(current.result.referral.status, "requested");

  current = run(current.data, "down-accept", "accept-referral-request", mr3, {
    caseId: referralId,
    at: "2026-07-23T14:00:00.000Z",
    payload: {
      receivingFeedback: "Family doctor team accepted ongoing care.",
      reservedResource: "Home follow-up slot",
      note: "Accept down-referral."
    }
  });
  current = run(current.data, "down-report", "return-referral-report", mr3, {
    caseId: referralId,
    at: "2026-07-23T15:00:00.000Z",
    payload: {
      reportSummary: "Primary-care medication and monitoring plan confirmed.",
      note: "Return primary-care acceptance report."
    }
  });
  current = run(current.data, "down-continuity", "accept-referral-continuity", mr3, {
    caseId: referralId,
    at: "2026-07-23T16:00:00.000Z",
    payload: {
      familyDoctorContractId: "p2fdc-r4",
      nextFollowupAt: "2026-08-01T09:00:00.000Z",
      note: "Family doctor accepts continuing responsibility."
    }
  });
  assert.equal(current.result.referral.status, "closed");
  assert.equal(current.result.followup.familyDoctorContractId, "p2fdc-r4");
  assert.equal(normalizeReferralCase(current.result.referral, { messages: current.data.taskMessages }).unifiedPhase, "closed");
  assert.equal(current.consistency.summary.P0, 0);
});

test("family doctor scheduler creates scoped tasks and fulfillment closes the task", () => {
  let source = data();
  source.phase2FamilyDoctorContracts.find((item) => item.id === "p2fdc-r1").nextServiceAt = "2026-07-22T09:00:00.000Z";
  source.phase2FamilyDoctorContracts.find((item) => item.id === "p2fdc-r4").nextServiceAt = "2026-07-29T09:00:00.000Z";
  assert.throws(() => run(source, "scheduler-no-org", "run-family-doctor-scheduler", {
    role: "institution",
    username: "unscoped"
  }, {
    payload: { note: "Must fail closed." }
  }), /institution actor orgCode is required/);
  assert.throws(() => run(source, "scheduler-invalid-window", "run-family-doctor-scheduler", mr3, {
    payload: { serviceLeadDays: 31, renewalLeadDays: 30, note: "Invalid lead window." }
  }), /serviceLeadDays must be an integer/);

  let current = run(source, "scheduler-mr3-1", "run-family-doctor-scheduler", mr3, {
    at: "2026-07-23T08:00:00.000Z",
    payload: { serviceLeadDays: 7, renewalLeadDays: 30, note: "Generate institution service tasks." }
  });
  assert.ok(current.result.created.length >= 2);
  assert.ok(current.result.created.every((item) => item.institutionCode === "MR3"));
  const task = current.result.created.find((item) => item.contractId === "p2fdc-r1" && item.kind === "service-due");
  assert.ok(task);

  const repeated = run(current.data, "scheduler-mr3-2", "run-family-doctor-scheduler", mr3, {
    at: "2026-07-23T09:00:00.000Z",
    payload: { serviceLeadDays: 7, renewalLeadDays: 30, note: "Do not duplicate open tasks." }
  });
  assert.equal(repeated.data.phase2FamilyDoctorServiceTasks.filter((item) => item.id === task.id).length, 1);

  current = run(repeated.data, "scheduler-fulfillment", "record-family-doctor-fulfillment", mr3, {
    caseId: "p2fdc-r1",
    at: "2026-07-23T10:00:00.000Z",
    payload: {
      serviceTaskId: task.id,
      serviceDate: "2026-07-23",
      serviceType: "monthly-followup",
      serviceItem: "血压随访",
      evidenceCollection: "followups",
      evidenceId: "f1",
      fulfillmentValue: 5,
      nextServiceAt: "2026-08-23T09:00:00.000Z",
      note: "Complete scheduled blood-pressure follow-up."
    }
  });
  const completedTask = current.data.phase2FamilyDoctorServiceTasks.find((item) => item.id === task.id);
  assert.equal(completedTask.status, "completed");
  assert.equal(completedTask.fulfillmentId, current.result.fulfillment.id);
  assert.equal(current.consistency.summary.P0, 0);
  current.data.phase2FamilyDoctorContracts.find((item) => item.id === "p2fdc-r1").nextServiceAt = "2026-07-22T09:00:00.000Z";
  const terminalReplay = run(current.data, "scheduler-after-completion", "run-family-doctor-scheduler", mr3, {
    at: "2026-07-23T11:00:00.000Z",
    payload: { serviceLeadDays: 7, renewalLeadDays: 30, note: "Completed tasks stay terminal." }
  });
  assert.equal(terminalReplay.data.phase2FamilyDoctorServiceTasks.find((item) => item.id === task.id).status, "completed");

  const expirySource = data();
  expirySource.phase2FamilyDoctorContracts.find((item) => item.id === "p2fdc-r1").endDate = "2026-07-20T00:00:00.000Z";
  const expired = run(expirySource, "scheduler-expiry", "run-family-doctor-scheduler", mr3, {
    at: "2026-07-23T08:00:00.000Z",
    payload: { note: "Expire elapsed contracts." }
  });
  assert.equal(expired.data.phase2FamilyDoctorContracts.find((item) => item.id === "p2fdc-r1").status, "expired");
  assert.ok(expired.result.expired.includes("p2fdc-r1"));
});

test("closure event hash chain detects payload tampering", () => {
  let current = run(data(), "hash-grant-1", "grant-referral-authorization", citizenR1, {
    residentId: "r1",
    payload: {
      authorizationId: "auth-hash-1",
      scope: "referral",
      authorizedTo: ["MR1"],
      dataScopes: ["clinical-summary", "referral-report"],
      expiresAt: "2026-08-23T08:00:00.000Z",
      note: "First hash-chain command."
    }
  });
  current = run(current.data, "hash-grant-2", "grant-referral-authorization", citizenR1, {
    residentId: "r1",
    at: "2026-07-23T09:00:00.000Z",
    payload: {
      authorizationId: "auth-hash-2",
      scope: "referral",
      authorizedTo: ["MR3"],
      dataScopes: ["clinical-summary", "referral-report"],
      expiresAt: "2026-08-23T09:00:00.000Z",
      note: "Second hash-chain command."
    }
  });
  const events = current.data.registrationReferralClosureEvents;
  assert.match(events[0].eventHash, /^[a-f0-9]{64}$/);
  assert.equal(events[0].previousEventHash, events[1].eventHash);
  assert.equal(validateClosureEventChain(events).ok, true);

  const tampered = JSON.parse(JSON.stringify(events));
  tampered[0].actor = "tampered-actor";
  const validation = validateClosureEventChain(tampered);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((item) => item.code === "closure-event-hash-mismatch"));
});

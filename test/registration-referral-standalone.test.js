const test = require("node:test");
const assert = require("node:assert/strict");

const seed = require("../data/db.json");
const { normalizeFamilyDoctorCase, normalizeReferralCase, validateClosureReferences } = require("../registration-referral-domain");
const {
  CLOSURE_COMMAND_CONTRACTS,
  applyClosureCommand,
  buildClosureQualityMetrics,
  buildClosureWorkQueue,
  buildNotificationReliability,
  replayClosureCommands
} = require("../registration-referral-service");

function data() {
  return JSON.parse(JSON.stringify(seed));
}

const mr1 = { role: "institution", orgCode: "MR1", username: "doc-mr1", name: "MR1 Doctor" };
const mr3 = { role: "institution", orgCode: "MR3", username: "doc-mr3", name: "MR3 Doctor" };
const mr5 = { role: "institution", orgCode: "MR5", username: "doc-mr5", name: "MR5 Doctor" };
const county = { role: "county", username: "county", name: "County Supervisor" };
const commission = { role: "commission", username: "commission", name: "Commission" };
const citizenR1 = { role: "citizen", username: "resident-r1", name: "Resident One", residentIds: ["r1"] };
const citizenR2 = { role: "citizen", username: "resident-r2", name: "Resident Two", residentIds: ["r2"] };

function requestedTeleconsultation() {
  const source = data();
  source.personalRecords.find((item) => item.id === "auth-r1-referral-demo").meta.authorizedTo.push("MR5");
  source.referralSystem.referrals.unshift({
    id: "rf-standalone",
    residentId: "r1",
    personIndex: "DEMO-ID-R1#DEMO-MOBILE-R1",
    type: "upward",
    direction: "upward",
    diseaseType: "hypertension",
    from: "MR3 Primary Care",
    fromInstitutionCode: "MR3",
    to: "MR1 Hospital",
    toInstitutionCode: "MR1",
    status: "requested",
    requestedAt: "2026-07-20T08:00:00.000Z",
    due: "2026-07-21T08:00:00.000Z",
    collaborationOrderId: "cco-standalone",
    residentAuthorizationId: "auth-r1-referral-demo"
  });
  source.countyCollaborationOrders.unshift({
    id: "cco-standalone",
    residentId: "r1",
    fromInstitution: "MR3 Primary Care",
    toInstitution: "MR1 Hospital",
    status: "requested",
    due: "2026-07-21T08:00:00.000Z"
  });
  source.referralTeleconsultations.unshift({
    id: "rtc-standalone",
    referralId: "rf-standalone",
    residentId: "r1",
    personIndex: "DEMO-ID-R1#DEMO-MOBILE-R1",
    type: "teleconsultation",
    diseaseType: "hypertension",
    sourceInstitution: "MR3 Primary Care",
    sourceInstitutionCode: "MR3",
    targetInstitution: "MR1 Hospital",
    targetInstitutionCode: "MR1",
    residentAuthorizationId: "auth-r1-referral-demo",
    authorizationStatus: "authorized",
    status: "requested",
    requestedAt: "2026-07-20T08:00:00.000Z",
    due: "2026-07-21T08:00:00.000Z",
    materials: [],
    reportStatus: "pending-return",
    collaborationOrderId: "cco-standalone"
  });
  return source;
}

function run(source, commandId, action, actor, fields = {}) {
  return applyClosureCommand(source, {
    commandId,
    action,
    at: fields.at || "2026-07-23T08:00:00.000Z",
    caseType: fields.caseType || "",
    caseId: fields.caseId || "",
    residentId: fields.residentId || "",
    expectedVersion: fields.expectedVersion,
    payload: fields.payload || {}
  }, actor, fields.options || {});
}

test("standalone command catalog covers all locally implementable increments", () => {
  const actions = new Set(CLOSURE_COMMAND_CONTRACTS.map((item) => item.action));
  [
    "reject-referral-request",
    "withdraw-referral",
    "reassign-referral",
    "reschedule-teleconsultation",
    "cancel-teleconsultation",
    "record-teleconsultation-no-show",
    "attach-referral-materials",
    "grant-referral-authorization",
    "revoke-referral-authorization",
    "resume-referral-authorization",
    "run-closure-sla",
    "acknowledge-escalation",
    "record-notification-provider-result",
    "resolve-notification-dead-letter",
    "submit-family-doctor-application",
    "review-family-doctor-application",
    "activate-family-doctor-contract",
    "record-family-doctor-fulfillment",
    "request-family-doctor-renewal",
    "review-family-doctor-renewal",
    "request-family-doctor-transfer",
    "review-family-doctor-transfer",
    "terminate-family-doctor-contract"
  ].forEach((action) => assert.ok(actions.has(action), action));
  assert.equal(CLOSURE_COMMAND_CONTRACTS.length, 42);
});

test("referral exception path rejects reassigns packages reschedules no-show and cancels", () => {
  let current = requestedTeleconsultation();
  assert.throws(() => run(current, "reject-wrong-org", "reject-referral-request", mr3, {
    caseId: "rtc-standalone",
    payload: { reason: "No capacity.", note: "Wrong institution attempt." }
  }), /institution scope denied/);

  current = run(current, "reject-mr1", "reject-referral-request", mr1, {
    caseId: "rtc-standalone",
    payload: { reason: "No specialist capacity.", note: "Return for reassignment." }
  }).data;
  assert.equal(current.referralTeleconsultations.find((item) => item.id === "rtc-standalone").status, "rejected");

  current = run(current, "reassign-mr5", "reassign-referral", mr3, {
    caseId: "rtc-standalone",
    payload: {
      targetInstitution: "MR5 Hospital",
      targetInstitutionCode: "MR5",
      residentAuthorizationId: "auth-r1-referral-demo",
      reason: "MR1 has no capacity.",
      note: "Reassign to MR5."
    }
  }).data;
  const reassigned = current.referralTeleconsultations.find((item) => item.id === "rtc-standalone");
  assert.equal(reassigned.targetInstitutionCode, "MR5");
  assert.equal(reassigned.status, "requested");
  assert.equal(reassigned.reassignmentHistory.length, 1);

  const digest = "a".repeat(64);
  current = run(current, "attach-material", "attach-referral-materials", mr3, {
    caseId: "rtc-standalone",
    payload: {
      note: "Attach signed clinical summary manifest.",
      materials: [{ id: "mat-1", name: "Clinical summary", type: "emr-summary", digest, version: 1 }]
    }
  }).data;
  assert.match(current.referralTeleconsultations.find((item) => item.id === "rtc-standalone").materialManifestDigest, /^[a-f0-9]{64}$/);

  current = run(current, "accept-mr5", "accept-referral-request", mr5, {
    caseId: "rtc-standalone",
    payload: { receivingFeedback: "Accepted.", note: "Specialist available." }
  }).data;
  current = run(current, "schedule-mr5", "schedule-teleconsultation", mr5, {
    caseId: "rtc-standalone",
    payload: { meetingWindow: "2026-07-24T09:00:00.000Z", receivingDoctor: "Doctor Five", note: "Initial schedule." }
  }).data;
  current = run(current, "no-show-mr5", "record-teleconsultation-no-show", mr5, {
    caseId: "rtc-standalone",
    payload: { party: "resident", note: "Resident did not join." }
  }).data;
  assert.equal(normalizeReferralCase(current.referralTeleconsultations.find((item) => item.id === "rtc-standalone")).unifiedPhase, "exception");

  current = run(current, "reschedule-mr5", "reschedule-teleconsultation", mr5, {
    caseId: "rtc-standalone",
    payload: { meetingWindow: "2026-07-25T09:00:00.000Z", reason: "Resident requested another slot.", note: "Second schedule." }
  }).data;
  assert.equal(current.referralTeleconsultations.find((item) => item.id === "rtc-standalone").scheduleVersion, 2);

  current = run(current, "cancel-resident", "cancel-teleconsultation", citizenR1, {
    caseId: "rtc-standalone",
    payload: { reason: "Resident declines further consultation.", note: "Close request." }
  }).data;
  assert.equal(current.referralTeleconsultations.find((item) => item.id === "rtc-standalone").status, "cancelled");
  assert.equal(current.referralSystem.referrals.find((item) => item.id === "rf-standalone").status, "cancelled");
});

test("resident withdrawal is scoped and terminal before scheduling", () => {
  const source = requestedTeleconsultation();
  assert.throws(() => run(source, "withdraw-wrong-resident", "withdraw-referral", citizenR2, {
    caseId: "rtc-standalone",
    payload: { reason: "Not this resident's referral.", note: "Must fail." }
  }), /resident scope denied/);
  const withdrawn = run(source, "withdraw-r1", "withdraw-referral", citizenR1, {
    caseId: "rtc-standalone",
    payload: { reason: "Resident selected local treatment.", note: "Withdraw before specialist scheduling." }
  });
  assert.equal(withdrawn.result.teleconsultation.status, "withdrawn");
  assert.equal(normalizeReferralCase(withdrawn.result.teleconsultation).unifiedPhase, "cancelled");
  assert.throws(() => run(withdrawn.data, "accept-withdrawn", "accept-referral-request", mr1, {
    caseId: "rtc-standalone",
    payload: { receivingFeedback: "Too late.", note: "Terminal request." }
  }), /not awaiting acceptance/);
});

test("resident authorization revocation holds every open linked referral", () => {
  let current = run(requestedTeleconsultation(), "revoke-auth", "revoke-referral-authorization", citizenR1, {
    payload: {
      authorizationId: "auth-r1-referral-demo",
      reason: "Resident withdrew data sharing consent.",
      note: "Stop open transfers until new consent."
    }
  });
  assert.equal(current.result.authorization.status, "revoked");
  assert.ok(current.result.affectedCaseIds.includes("rtc-standalone"));
  const tele = current.data.referralTeleconsultations.find((item) => item.id === "rtc-standalone");
  assert.equal(tele.status, "authorization-on-hold");
  assert.equal(normalizeReferralCase(tele).exceptionState, "resident-authorization-revoked");
  assert.throws(() => run(current.data, "reassign-with-revoked", "reassign-referral", mr3, {
    caseId: "rtc-standalone",
    payload: {
      targetInstitution: "MR5 Hospital",
      targetInstitutionCode: "MR5",
      residentAuthorizationId: "auth-r1-referral-demo",
      note: "Must fail."
    }
  }), /active unexpired resident authorization/);
  assert.throws(() => run(current.data, "grant-guardian-missing-proof", "grant-referral-authorization", citizenR1, {
    residentId: "r1",
    payload: {
      scope: "referral-teleconsultation",
      authorizedTo: ["MR1"],
      dataScopes: ["clinical-summary", "referral-report"],
      expiresAt: "2026-08-23T08:00:00.000Z",
      consentActor: "guardian",
      note: "Guardian proof is mandatory."
    }
  }), /guardianProofId is required/);
  current = run(current.data, "grant-guardian-auth", "grant-referral-authorization", citizenR1, {
    residentId: "r1",
    payload: {
      authorizationId: "auth-r1-guardian-restored",
      scope: "referral-teleconsultation",
      authorizedTo: ["MR1"],
      dataScopes: ["clinical-summary", "medications", "referral-report", "followup-plan"],
      expiresAt: "2026-08-23T08:00:00.000Z",
      consentActor: "guardian",
      guardianProofId: "guardian-proof-r1",
      guardianRelationship: "adult-child",
      note: "Guardian restored minimum required sharing."
    }
  });
  assert.equal(current.result.authorization.meta.consentActor, "guardian");
  assert.deepEqual(current.result.authorization.dataScopes, ["clinical-summary", "medications", "referral-report", "followup-plan"]);
  current = run(current.data, "resume-held-referral", "resume-referral-authorization", mr3, {
    caseId: "rtc-standalone",
    payload: {
      authorizationId: "auth-r1-guardian-restored",
      note: "Resume with the replacement authorization."
    }
  });
  assert.equal(current.result.teleconsultation.status, "requested");
  assert.equal(current.result.teleconsultation.residentAuthorizationId, "auth-r1-guardian-restored");
  assert.equal(current.consistency.summary.P0, 0);
});

test("clinical package migration preserves legacy material names", () => {
  const source = data();
  const attached = run(source, "attach-legacy-material", "attach-referral-materials", mr3, {
    caseId: "rtc-001",
    payload: {
      note: "Convert the next material to the versioned manifest.",
      materials: [{
        id: "mat-versioned",
        name: "Signed specialist request",
        type: "referral-request",
        digest: "b".repeat(64),
        version: 1
      }]
    }
  });
  assert.deepEqual(attached.result.teleconsultation.legacyMaterialNames, ["EMR summary", "blood pressure log", "current prescription"]);
  assert.equal(attached.result.materials.length, 1);
  assert.equal(attached.consistency.summary.P0, 0);
  const tampered = JSON.parse(JSON.stringify(attached.data));
  tampered.referralTeleconsultations.find((item) => item.id === "rtc-001").materials[0].digest = "c".repeat(64);
  assert.ok(validateClosureReferences(tampered).issues.some((item) => item.code === "teleconsult-material-manifest-mismatch"));
});

test("SLA scan is deduplicated and institution resolution remains fail closed", () => {
  assert.throws(() => run(requestedTeleconsultation(), "sla-missing-org", "run-closure-sla", {
    role: "institution",
    username: "unscoped-institution"
  }, {
    payload: { note: "Must fail closed." }
  }), /institution actor orgCode is required/);
  const first = run(requestedTeleconsultation(), "sla-run-1", "run-closure-sla", commission, {
    at: "2026-07-23T12:00:00.000Z",
    payload: { note: "Automated overdue scan." }
  });
  assert.ok(first.result.created.length >= 1);
  const second = run(first.data, "sla-run-2", "run-closure-sla", commission, {
    at: "2026-07-23T13:00:00.000Z",
    payload: { note: "Automated overdue scan replay window." }
  });
  assert.ok(second.result.skipped.length >= 1);
  const escalation = second.data.registrationReferralEscalations.find((item) => item.responsibleOrg === "MR1" || item.responsibleOrg === "MR3");
  assert.ok(escalation);
  assert.throws(() => run(second.data, "sla-county-resolve", "acknowledge-escalation", county, {
    caseId: escalation.id,
    payload: { status: "resolved", note: "County cannot close institution responsibility." }
  }), /county supervision cannot resolve/);
  const responsibleActor = escalation.responsibleOrg === "MR1" ? mr1 : mr3;
  const resolved = run(second.data, "sla-org-resolve", "acknowledge-escalation", responsibleActor, {
    caseId: escalation.id,
    payload: { status: "resolved", note: "Institution completed overdue action." }
  });
  assert.equal(resolved.result.escalation.status, "resolved");
});

test("provider receipts open and resolve a scoped notification dead letter", () => {
  const source = data();
  source.taskMessages.unshift({
    id: "msg-provider-demo",
    collection: "referralTeleconsultations",
    sourceId: "rtc-001",
    residentId: "r1",
    targetRole: "institution",
    targetOrgCode: "MR3",
    channel: "sms",
    status: "sent",
    receipts: []
  });
  let current = source;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    current = run(current, `provider-fail-${attempt}`, "record-notification-provider-result", mr3, {
      payload: {
        messageId: "msg-provider-demo",
        status: "failed",
        providerMessageId: `provider-${attempt}`,
        provider: "demo-sms",
        errorCode: "TEMP_UNAVAILABLE",
        maxAttempts: 3
      }
    }).data;
  }
  const deadLetter = current.registrationReferralNotificationDeadLetters.find((item) => item.messageId === "msg-provider-demo");
  assert.equal(deadLetter.status, "open");
  assert.throws(() => run(current, "dead-wrong-org", "resolve-notification-dead-letter", mr1, {
    caseId: deadLetter.id,
    payload: { resolution: "manual-contact", note: "Wrong org." }
  }), /institution scope denied/);
  const resolved = run(current, "dead-resolve", "resolve-notification-dead-letter", mr3, {
    caseId: deadLetter.id,
    payload: { resolution: "manual-contact", note: "Resident contacted by phone." }
  });
  assert.equal(resolved.result.deadLetter.status, "resolved");
  assert.equal(buildNotificationReliability(resolved.data).resolvedDeadLetters, 1);
});

test("family doctor commands cover application contract fulfillment renewal and termination", () => {
  assert.throws(() => run(data(), "family-duplicate-contract", "activate-family-doctor-contract", mr3, {
    caseId: "p2fda-r1",
    payload: {
      startDate: "2026-08-01",
      endDate: "2027-08-01",
      note: "Must not create a duplicate contract."
    }
  }), /already has a contract/);
  const fullTeam = data();
  fullTeam.phase2FamilyDoctorTeams.find((item) => item.id === "p2fdtm-qnw").signedResidents = 1200;
  fullTeam.phase2FamilyDoctorApplications.unshift({
    id: "p2fda-capacity",
    residentId: "r2",
    packageId: "p2fdp-basic",
    teamId: "p2fdtm-qnw",
    templateId: "p2fdt-basic",
    applicationType: "new-contract",
    status: "approved",
    reviewStatus: "approved",
    reviewInstitutionCode: "MR3"
  });
  assert.throws(() => run(fullTeam, "family-capacity", "activate-family-doctor-contract", mr3, {
    caseId: "p2fda-capacity",
    payload: {
      startDate: "2026-08-01",
      endDate: "2027-08-01",
      note: "Must respect team capacity."
    }
  }), /no signing capacity/);
  let current = run(data(), "family-submit", "submit-family-doctor-application", citizenR2, {
    residentId: "r2",
    payload: {
      teamId: "p2fdtm-qnw",
      packageId: "p2fdp-basic",
      consentStatus: "resident-confirmed",
      desiredStartDate: "2026-08-01",
      note: "Request primary-care family doctor service."
    }
  });
  const applicationId = current.result.application.id;
  assert.equal(current.event.caseId, applicationId);
  assert.equal(current.event.residentId, "r2");
  current = run(current.data, "family-review", "review-family-doctor-application", mr3, {
    caseId: applicationId,
    payload: { decision: "approved", note: "Team capacity confirmed." }
  });
  current = run(current.data, "family-activate", "activate-family-doctor-contract", mr3, {
    caseId: applicationId,
    payload: {
      startDate: "2026-08-01",
      endDate: "2027-08-01",
      nextServiceAt: "2026-08-15",
      note: "Contract activated."
    }
  });
  const contractId = current.result.contract.id;
  assert.throws(() => run(current.data, "family-wrong-service-item", "record-family-doctor-fulfillment", mr3, {
    caseId: contractId,
    payload: {
      serviceDate: "2026-08-15",
      serviceType: "uncontracted-service",
      serviceItem: "Uncontracted item",
      evidenceCollection: "personalRecords",
      evidenceId: "pr-uncontracted",
      fulfillmentValue: 5,
      note: "Must remain inside the package."
    }
  }), /outside the contracted package/);
  current = run(current.data, "family-fulfill", "record-family-doctor-fulfillment", mr3, {
    caseId: contractId,
    payload: {
      serviceDate: "2026-08-15",
      serviceType: "health-review",
      serviceItem: "健康档案复核",
      evidenceCollection: "personalRecords",
      evidenceId: "pr-health-review-r2",
      fulfillmentValue: 25,
      nextServiceAt: "2026-09-15",
      note: "First contracted service completed."
    }
  });
  const fulfillmentId = current.result.fulfillment.id;
  current = run(current.data, "family-ack", "acknowledge-family-doctor-fulfillment", citizenR2, {
    caseId: fulfillmentId,
    payload: { note: "Service confirmed.", satisfactionScore: 95 }
  });
  assert.equal(current.result.fulfillment.residentAcknowledgement.status, "acknowledged");
  current = run(current.data, "family-renew-request", "request-family-doctor-renewal", citizenR2, {
    caseId: contractId,
    payload: { desiredStartDate: "2027-08-02", note: "Request another year." }
  });
  const renewalId = current.result.application.id;
  current = run(current.data, "family-renew-review", "review-family-doctor-renewal", mr3, {
    caseId: renewalId,
    payload: {
      decision: "approved",
      startDate: "2027-08-02",
      endDate: "2028-08-02",
      note: "Renewal approved."
    }
  });
  assert.equal(current.result.contract.renewalStatus, "approved");
  current = run(current.data, "family-terminate", "terminate-family-doctor-contract", citizenR2, {
    caseId: contractId,
    payload: { reason: "Resident moved away.", note: "Terminate after handoff." }
  });
  assert.equal(current.result.contract.status, "terminated");
});

test("family doctor transfer requires source release and target acceptance", () => {
  const source = data();
  source.phase2FamilyDoctorServiceTasks = [{
    id: "p2fdst-transfer-open",
    contractId: "p2fdc-r1",
    residentId: "r1",
    institutionCode: "MR3",
    kind: "service-due",
    status: "open"
  }];
  assert.throws(() => run(source, "family-transfer-wrong-resident", "request-family-doctor-transfer", citizenR2, {
    caseId: "p2fdc-r1",
    payload: {
      teamId: "p2fdtm-central",
      packageId: "p2fdp-hypertension",
      reason: "Resident requests a new care team.",
      note: "Must remain resident scoped."
    }
  }), /resident scope denied/);

  let current = run(source, "family-transfer-request", "request-family-doctor-transfer", citizenR1, {
    caseId: "p2fdc-r1",
    payload: {
      teamId: "p2fdtm-central",
      packageId: "p2fdp-hypertension",
      reason: "Resident relocated closer to the target team.",
      note: "Request an audited responsibility transfer."
    }
  });
  const applicationId = current.result.application.id;
  const sourceCount = source.phase2FamilyDoctorTeams.find((item) => item.id === "p2fdtm-qnw").signedResidents;
  const targetCount = source.phase2FamilyDoctorTeams.find((item) => item.id === "p2fdtm-central").signedResidents;
  assert.equal(current.result.contract.teamId, "p2fdtm-qnw");
  assert.equal(current.result.contract.transferStatus, "pending-source");
  assert.equal(normalizeFamilyDoctorCase(current.result.application).responsibleOrg, "MR3");
  assert.throws(() => run(current.data, "family-transfer-source-no-org", "review-family-doctor-transfer", {
    role: "institution",
    username: "unscoped"
  }, {
    caseId: applicationId,
    payload: { decision: "approved", note: "Must fail closed." }
  }), /institution actor orgCode is required/);
  assert.throws(() => run(current.data, "family-transfer-wrong-source", "review-family-doctor-transfer", mr1, {
    caseId: applicationId,
    payload: { decision: "approved", note: "Target cannot release the source contract." }
  }), /institution scope denied/);

  current = run(current.data, "family-transfer-source-approve", "review-family-doctor-transfer", mr3, {
    caseId: applicationId,
    payload: { decision: "approved", note: "Current team releases responsibility." }
  });
  assert.equal(current.result.application.reviewStage, "target");
  assert.equal(current.result.contract.transferStatus, "pending-target");
  assert.equal(normalizeFamilyDoctorCase(current.result.application).responsibleOrg, "MR1");
  assert.throws(() => run(current.data, "family-transfer-source-replay-as-target", "review-family-doctor-transfer", mr3, {
    caseId: applicationId,
    payload: { decision: "approved", note: "Source team cannot accept for target." }
  }), /institution scope denied/);

  const fullCapacity = data();
  Object.assign(fullCapacity, current.data);
  fullCapacity.phase2FamilyDoctorTeams = current.data.phase2FamilyDoctorTeams.map((item) =>
    item.id === "p2fdtm-central" ? { ...item, signedResidents: item.capacity } : { ...item });
  assert.throws(() => run(fullCapacity, "family-transfer-full-target", "review-family-doctor-transfer", mr1, {
    caseId: applicationId,
    payload: { decision: "approved", note: "Target capacity must be checked again." }
  }), /no signing capacity/);

  current = run(current.data, "family-transfer-target-approve", "review-family-doctor-transfer", mr1, {
    caseId: applicationId,
    payload: {
      decision: "approved",
      nextServiceAt: "2026-08-15T09:00:00.000Z",
      note: "Target team accepts continuing responsibility."
    }
  });
  const contract = current.result.contract;
  assert.equal(contract.teamId, "p2fdtm-central");
  assert.equal(contract.institutionCode, "MR1");
  assert.equal(contract.transferStatus, "completed");
  assert.equal(contract.transferHistory[0].fromInstitutionCode, "MR3");
  assert.equal(current.result.application.status, "completed");
  assert.equal(normalizeFamilyDoctorCase(current.result.application).unifiedPhase, "closed");
  assert.equal(current.data.phase2FamilyDoctorTeams.find((item) => item.id === "p2fdtm-qnw").signedResidents, sourceCount - 1);
  assert.equal(current.data.phase2FamilyDoctorTeams.find((item) => item.id === "p2fdtm-central").signedResidents, targetCount + 1);
  assert.equal(current.data.phase2FamilyDoctorServiceTasks.find((item) => item.id === "p2fdst-transfer-open").status, "cancelled");
  assert.equal(current.consistency.summary.P0, 0);
});

test("family doctor transfer rejection preserves the existing team and capacity", () => {
  const source = data();
  const sourceCount = source.phase2FamilyDoctorTeams.find((item) => item.id === "p2fdtm-qnw").signedResidents;
  const targetCount = source.phase2FamilyDoctorTeams.find((item) => item.id === "p2fdtm-central").signedResidents;
  let current = run(source, "family-transfer-reject-request", "request-family-doctor-transfer", citizenR1, {
    caseId: "p2fdc-r1",
    payload: {
      teamId: "p2fdtm-central",
      packageId: "p2fdp-hypertension",
      reason: "Resident requests a target capacity review.",
      note: "Open transfer for rejection-path evidence."
    }
  });
  const applicationId = current.result.application.id;
  current = run(current.data, "family-transfer-reject-source", "review-family-doctor-transfer", mr3, {
    caseId: applicationId,
    payload: { decision: "approved", note: "Current team releases responsibility if accepted." }
  });
  current = run(current.data, "family-transfer-reject-target", "review-family-doctor-transfer", mr1, {
    caseId: applicationId,
    payload: { decision: "rejected", reason: "Target service district does not cover the resident.", note: "Keep the current team active." }
  });
  assert.equal(current.result.application.status, "rejected");
  assert.equal(current.result.application.rejectionStage, "target");
  assert.equal(current.result.contract.teamId, "p2fdtm-qnw");
  assert.equal(current.result.contract.transferStatus, "rejected");
  assert.equal(current.data.phase2FamilyDoctorTeams.find((item) => item.id === "p2fdtm-qnw").signedResidents, sourceCount);
  assert.equal(current.data.phase2FamilyDoctorTeams.find((item) => item.id === "p2fdtm-central").signedResidents, targetCount);
  assert.equal(current.consistency.summary.P0, 0);
});

test("expected versions and replay provide optimistic concurrency and recovery evidence", () => {
  const source = data();
  const command = {
    commandId: "versioned-fulfillment",
    action: "record-family-doctor-fulfillment",
    caseId: "p2fdc-r1",
    expectedVersion: 0,
    at: "2026-07-23T09:00:00.000Z",
    payload: {
      serviceDate: "2026-07-23",
      serviceType: "blood-pressure-review",
      serviceItem: "血压随访",
      evidenceCollection: "followups",
      evidenceId: "f1",
      fulfillmentValue: 5,
      note: "Versioned service result."
    }
  };
  const first = applyClosureCommand(source, command, mr3, { requireExpectedVersion: true });
  assert.equal(first.event.aggregateVersion, 1);
  assert.equal(first.data.phase2FamilyDoctorContracts.find((item) => item.id === "p2fdc-r1").workflowVersion, 1);
  assert.throws(() => applyClosureCommand(first.data, {
    ...command,
    commandId: "versioned-stale-write"
  }, mr3, { requireExpectedVersion: true }), /workflow version conflict/);
  assert.throws(() => applyClosureCommand(source, {
    ...command,
    commandId: "versioned-missing",
    expectedVersion: undefined
  }, mr3, { requireExpectedVersion: true }), /expectedVersion is required/);

  const replayed = replayClosureCommands(source, [
    { command, actor: mr3 },
    { command, actor: mr3 }
  ], {}, { requireExpectedVersion: true });
  assert.equal(replayed.replayed, 2);
  assert.equal(replayed.idempotent, 1);
  assert.equal(replayed.data.phase2FamilyDoctorFulfillments.filter((item) => item.id === "p2fdf-versioned-fulfillment").length, 1);
});

test("work queue and quality projections remain read-only and production bounded", () => {
  const source = requestedTeleconsultation();
  const serialized = JSON.stringify(source);
  const queue = buildClosureWorkQueue(source, { asOf: "2026-07-23T12:00:00.000Z", actor: commission });
  const institutionQueue = buildClosureWorkQueue(source, { asOf: "2026-07-23T12:00:00.000Z", actor: mr3 });
  const metrics = buildClosureQualityMetrics(source, { asOf: "2026-07-23T12:00:00.000Z" });
  assert.ok(queue.some((item) => item.caseId === "rtc-standalone" && item.overdue));
  assert.ok(institutionQueue.every((item) => item.responsibleOrg === "MR3"));
  assert.equal(metrics.productionReady, false);
  assert.equal(metrics.notificationReliability.productionReady, false);
  assert.equal(JSON.stringify(source), serialized);
});

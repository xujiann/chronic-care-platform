const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const data = require("../data/db.json");
const {
  buildRegistrationReferralClosureReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/registration-referral-closure-readiness");

function brokenReferralData() {
  const fixture = JSON.parse(JSON.stringify(data));
  fixture.referralTeleconsultations = fixture.referralTeleconsultations.map((item) => ({ ...item, collaborationOrderId: "cco-001" }));
  return fixture;
}

test("closure readiness reports repaired current data as locally ready but never production ready", () => {
  const report = buildRegistrationReferralClosureReadiness({ data, asOf: "2026-07-22T00:00:00.000Z" });
  assert.equal(report.functionalOk, true);
  assert.equal(report.dataReady, true);
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.status, "local-readiness-passed-production-blocked");
  assert.equal(report.summary.cases, 16);
  assert.equal(report.summary.p0ConsistencyIssues, 0);
  assert.equal(report.summary.safeRepairs, 0);
  assert.equal(report.summary.manualRepairReviews, 0);
  assert.equal(report.summary.p0AfterRepairRehearsal, 0);
  assert.equal(report.summary.unownedCases, 0);
});

test("closure readiness keeps a broken referral chain blocked and rehearses safe repair", () => {
  const report = buildRegistrationReferralClosureReadiness({ data: brokenReferralData(), asOf: "2026-07-22T00:00:00.000Z" });
  assert.equal(report.functionalOk, true);
  assert.equal(report.dataReady, false);
  assert.equal(report.status, "blocked-by-data-consistency");
  assert.equal(report.summary.p0ConsistencyIssues, 3);
  assert.equal(report.summary.safeRepairs, 2);
  assert.equal(report.summary.p0AfterRepairRehearsal, 0);
});

test("closure readiness exposes all four domains and one responsibility per open case", () => {
  const report = buildRegistrationReferralClosureReadiness({ data, asOf: "2026-07-22T00:00:00.000Z" });
  assert.deepEqual(Object.keys(report.summary.caseTypes).sort(), ["chronic-followup", "family-doctor", "referral-teleconsultation", "registration"]);
  assert.ok(report.responsibilityQueue.length > 0);
  assert.ok(report.responsibilityQueue.every((item) => item.responsibleRole && item.nextAction));
  assert.ok(report.responsibilityQueue.some((item) => item.caseId === "rtc-002" && item.unifiedPhase === "primary-care-followup-pending" && item.responsibleRole === "primary-care-institution"));
  assert.ok(report.responsibilityQueue.some((item) => item.caseId === "reg-r1-20260630-cardio" && item.responsibleRole === "citizen"));
});

test("closure readiness keeps empty and delivery-only receipts out of business acknowledgement", () => {
  const report = buildRegistrationReferralClosureReadiness({ data, asOf: "2026-07-22T00:00:00.000Z" });
  assert.ok(report.summary.notificationStates["sent-unconfirmed"] >= 1);
  assert.ok(report.summary.receiptStates.missing >= 1);
  const referral = report.cases.find((item) => item.caseId === "rtc-002");
  assert.equal(referral.unifiedPhase, "primary-care-followup-pending");
  assert.notEqual(referral.receiptState, "acknowledged");
});

test("closure readiness includes open family doctor service disputes", () => {
  const fixture = JSON.parse(JSON.stringify(data));
  fixture.phase2FamilyDoctorServiceDisputes = [{
    id: "p2fdd-readiness",
    fulfillmentId: "p2fdf-r1-bp",
    contractId: "p2fdc-r1",
    residentId: "r1",
    teamId: "p2fdtm-qnw",
    institutionCode: "MR3",
    category: "record-accuracy",
    status: "open",
    responseDueAt: "2026-07-23T08:00:00.000Z",
    responseHistory: [],
    residentDecisionHistory: [],
    productionEvidence: false
  }];
  const report = buildRegistrationReferralClosureReadiness({ data: fixture, asOf: "2026-07-22T00:00:00.000Z" });
  assert.equal(report.functionalOk, true);
  assert.equal(report.dataReady, true);
  assert.equal(report.summary.caseTypes["family-doctor-service-dispute"], 1);
  assert.ok(report.exceptionQueue.some((item) =>
    item.caseId === "p2fdd-readiness"
    && item.responsibleOrg === "MR3"
    && item.responsibleRole === "family-doctor-quality"));
});

test("a consistent minimal four-domain dataset passes local data readiness only", () => {
  const fixture = {
    registrationSchedules: [{ id: "s1", hospitalCode: "H1", departmentCode: "D1" }],
    registrationOrders: [{ id: "reg1", residentId: "r1", scheduleId: "s1", hospitalCode: "H1", departmentCode: "D1", status: "confirmed", paymentStatus: "pending" }],
    referralSystem: { referrals: [{ id: "rf1", residentId: "r1", collaborationOrderId: "cco1" }] },
    countyCollaborationOrders: [{ id: "cco1", residentId: "r1" }],
    personalRecords: [{ id: "auth1", residentId: "r1", category: "authorizations" }],
    referralTeleconsultations: [{ id: "rtc1", residentId: "r1", referralId: "rf1", collaborationOrderId: "cco1", residentAuthorizationId: "auth1", status: "requested", targetInstitutionCode: "H1" }],
    phase2FamilyDoctorApplications: [{ id: "app1", residentId: "r1", packageId: "pkg1", teamId: "team1", reviewStatus: "approved", reviewInstitutionCode: "P1" }],
    phase2FamilyDoctorContracts: [{ id: "contract1", applicationId: "app1", residentId: "r1", packageId: "pkg1", teamId: "team1", status: "active" }],
    phase2FamilyDoctorFulfillments: [],
    followups: [{ id: "f1", residentId: "r1", institutionCode: "P1", status: "待随访", plannedAt: "2026-08-01" }],
    taskMessages: []
  };
  const report = buildRegistrationReferralClosureReadiness({ data: fixture, asOf: "2026-07-22T00:00:00.000Z" });
  assert.equal(report.functionalOk, true);
  assert.equal(report.dataReady, true);
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.status, "local-readiness-passed-production-blocked");
});

test("readiness renders and writes explicit blocked evidence", (t) => {
  const report = buildRegistrationReferralClosureReadiness({ data: brokenReferralData(), asOf: "2026-07-22T00:00:00.000Z" });
  const markdown = renderMarkdown(report);
  assert.match(markdown, /blocked-by-data-consistency/);
  assert.match(markdown, /teleconsult-referral-collaboration-mismatch/);
  assert.match(markdown, /Responsibility Queue/);
  assert.match(markdown, /Repair Rehearsal/);
  assert.match(markdown, /rtc-001.*cco-001.*cco-004/);
  assert.match(markdown, /pending T00 integration/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "registration-referral-closure-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "report.json");
  const markdownOutput = path.join(directory, "report.md");
  const written = writeOutput(report, { output, markdown: markdownOutput });
  assert.equal(written.output, output);
  assert.equal(written.markdown, markdownOutput);
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).summary.p0ConsistencyIssues, 3);
  assert.match(fs.readFileSync(markdownOutput, "utf8"), /Data readiness: BLOCKED/);
});

test("readiness parses output, markdown, date and allow-failure flags", () => {
  const flags = parseArgs([
    "--output=output/closure.json",
    "--markdown=output/closure.md",
    "--as-of=2026-07-22T00:00:00.000Z",
    "--allow-failure"
  ]);
  assert.match(flags.output, /output[\\/]closure\.json$/);
  assert.match(flags.markdown, /output[\\/]closure\.md$/);
  assert.equal(flags.asOf, "2026-07-22T00:00:00.000Z");
  assert.equal(flags.allowFailure, true);
});

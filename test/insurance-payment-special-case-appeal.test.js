"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Service = require("../disease-payment-service");
const SpecialCase = require("../disease-payment-special-case");

const evidence = (character) => [{ type: "medical-summary", digest: `sha256:${character.repeat(64)}`, issuedBy: "hospital" }];

function experts() {
  return [
    { id: "original-medical", reviewerAccount: "original-medical-reviewer", role: "medical-insurance-review", institution: "insurance-center", active: true },
    { id: "original-fund", reviewerAccount: "original-fund-reviewer", role: "fund-finance-review", institution: "insurance-bureau", active: true },
    { id: "appeal-medical", reviewerAccount: "appeal-medical-reviewer", role: "medical-insurance-review", institution: "appeal-center", active: true },
    { id: "appeal-fund", reviewerAccount: "appeal-fund-reviewer", role: "fund-finance-review", institution: "appeal-bureau", active: true }
  ];
}

function rejectedApplication(id = "special-appeal-case") {
  const row = SpecialCase.createSpecialCaseApplication({ id: "case-appeal", institution: "test-hospital", totalAmount: 1000 }, { id, reason: "复杂危重症", requestedPaymentFen: 90000, evidence: evidence("a") }, "hospital-applicant");
  SpecialCase.selectSpecialCaseExperts(row, experts(), { selectionNonce: `${id}-original` });
  const reviewer = row.expertPanel.members[0].reviewerAccount;
  SpecialCase.reviewSpecialCaseApplication(row, { approved: false, opinion: "现有证据不足" }, reviewer);
  return row;
}

test("special case appeal binds the original decision and uses a fresh two-person panel", () => {
  const row = rejectedApplication();
  const originalExpertIds = new Set(row.expertPanel.members.map((item) => item.expertId));
  const originalReviewer = row.reviews[0].reviewer;
  const appeal = SpecialCase.createSpecialCaseAppeal(row, { id: "appeal-001", originalDecisionDigest: row.decisionDigest, reason: "补充关键诊疗证据", evidence: evidence("b"), at: row.rejectedAt }, "hospital-applicant");
  const panel = SpecialCase.selectSpecialCaseAppealExperts(row, experts(), { selectionNonce: "appeal-panel", at: row.rejectedAt });
  assert.equal(row.state, "APPEALED");
  assert.equal(panel.members.length, 2);
  assert.ok(panel.members.every((item) => !originalExpertIds.has(item.expertId)));
  assert.equal(SpecialCase.verifySpecialCaseAppealPanel(row), true);
  assert.throws(() => SpecialCase.reviewSpecialCaseAppeal(row, { approved: true, adjustedPaymentFen: 85000 }, originalReviewer), (error) => error.code === "SPECIAL_CASE_APPEAL_REVIEWER_NOT_ASSIGNED");

  SpecialCase.reviewSpecialCaseAppeal(row, { approved: true, adjustedPaymentFen: 85000, at: appeal.submittedAt }, panel.members[0].reviewerAccount);
  assert.equal(row.state, "APPEAL_UNDER_REVIEW");
  assert.throws(() => SpecialCase.reviewSpecialCaseAppeal(row, { approved: true, adjustedPaymentFen: 84000, at: appeal.submittedAt }, panel.members[1].reviewerAccount), (error) => error.code === "SPECIAL_CASE_APPEAL_AMOUNT_CONFLICT");
  SpecialCase.reviewSpecialCaseAppeal(row, { approved: true, adjustedPaymentFen: 85000, at: appeal.submittedAt }, panel.members[1].reviewerAccount);
  assert.equal(row.state, "APPROVED");
  assert.equal(row.adjustedPaymentFen, 85000);
  assert.match(row.decisionDigest, /^[a-f0-9]{64}$/);
  assert.equal(appeal.outcome, "APPROVED");
  assert.equal(SpecialCase.buildSpecialCaseAppealSla(row, appeal.reviewDueAt).status, "completed-within-sla");
  assert.equal(SpecialCase.settlementAdjustment([row], { id: row.caseId }).adjustedPaymentFen, 85000);
  assert.equal(SpecialCase.verifySpecialCaseLedger(row.events), true);
});

test("special case appeal enforces one appeal and the filing window", () => {
  const row = rejectedApplication("special-appeal-window");
  assert.throws(() => SpecialCase.createSpecialCaseAppeal(row, { originalDecisionDigest: "0".repeat(64), reason: "摘要错误", evidence: evidence("c"), at: row.rejectedAt }, "hospital-applicant"), (error) => error.code === "SPECIAL_CASE_APPEAL_DECISION_DIGEST_INVALID");
  assert.throws(() => SpecialCase.createSpecialCaseAppeal(row, { originalDecisionDigest: row.decisionDigest, reason: "重复原证据", evidence: evidence("a"), at: row.rejectedAt }, "hospital-applicant"), (error) => error.code === "SPECIAL_CASE_APPEAL_NEW_EVIDENCE_REQUIRED");
  const beforeRejection = new Date(new Date(row.rejectedAt).getTime() - 1).toISOString();
  assert.throws(() => SpecialCase.createSpecialCaseAppeal(row, { originalDecisionDigest: row.decisionDigest, reason: "时间倒置", evidence: evidence("c"), at: beforeRejection }, "hospital-applicant"), (error) => error.code === "SPECIAL_CASE_APPEAL_TIME_INVALID");
  const expiredAt = SpecialCase.addCalendarDays(row.rejectedAt, 11);
  assert.throws(() => SpecialCase.createSpecialCaseAppeal(row, { originalDecisionDigest: row.decisionDigest, reason: "超期申请", evidence: evidence("c"), at: expiredAt }, "hospital-applicant"), (error) => error.code === "SPECIAL_CASE_APPEAL_WINDOW_EXPIRED");

  SpecialCase.createSpecialCaseAppeal(row, { id: "appeal-on-time", originalDecisionDigest: row.decisionDigest, reason: "期限内申请", evidence: evidence("c"), at: row.rejectedAt }, "hospital-applicant");
  assert.throws(() => SpecialCase.createSpecialCaseAppeal(row, { originalDecisionDigest: row.decisionDigest, reason: "重复申请", evidence: evidence("d"), at: row.rejectedAt }, "hospital-applicant"), (error) => error.code === "SPECIAL_CASE_APPEAL_DUPLICATE");
});

test("rejected appeal remains excluded from settlement and tampering blocks review", () => {
  const row = rejectedApplication("special-appeal-rejected");
  const appeal = SpecialCase.createSpecialCaseAppeal(row, { id: "appeal-rejected", originalDecisionDigest: row.decisionDigest, reason: "补充材料", evidence: evidence("d"), at: row.rejectedAt }, "hospital-applicant");
  const panel = SpecialCase.selectSpecialCaseAppealExperts(row, experts(), { selectionNonce: "appeal-rejected-panel", at: row.rejectedAt });
  const tampered = structuredClone(row);
  tampered.events[0].actor = "tampered";
  assert.throws(() => SpecialCase.reviewSpecialCaseAppeal(tampered, { approved: false, at: appeal.submittedAt }, panel.members[0].reviewerAccount), (error) => error.code === "SPECIAL_CASE_APPEAL_PANEL_INVALID");
  SpecialCase.reviewSpecialCaseAppeal(row, { approved: false, opinion: "补充证据仍不足", at: appeal.submittedAt }, panel.members[0].reviewerAccount);
  assert.equal(row.state, "APPEAL_REJECTED");
  assert.equal(SpecialCase.settlementAdjustment([row], { id: row.caseId }), null);
});

test("service completes a rejected special case appeal with a disjoint panel", () => {
  const state = Service.seedDiseasePaymentState();
  const created = Service.createSpecialCase(state, { caseId: "dp-case-001", reason: "复杂危重病例资源消耗异常", requestedPaymentFen: 3200000, evidence: evidence("e"), selectionNonce: "service-original-panel" }, "hospital-applicant");
  const originalPanelIds = new Set(created.panel.members.map((item) => item.expertId));
  const rejected = Service.reviewSpecialCase(created.state, created.row.id, { approved: false, opinion: "原审证据不足" }, created.panel.members[0].reviewerAccount);
  const appealed = Service.createSpecialCaseAppeal(rejected.state, created.row.id, { id: "service-appeal", originalDecisionDigest: rejected.row.decisionDigest, reason: "补充关键诊疗证据", evidence: evidence("f"), selectionNonce: "service-appeal-panel", at: rejected.row.rejectedAt }, "hospital-applicant");

  assert.equal(appealed.panel.members.length, 2);
  assert.ok(appealed.panel.members.every((item) => !originalPanelIds.has(item.expertId)));
  let reviewed = Service.reviewSpecialCaseAppeal(appealed.state, created.row.id, { approved: true, adjustedPaymentFen: 3100000, at: appealed.appeal.submittedAt }, appealed.panel.members[0].reviewerAccount);
  reviewed = Service.reviewSpecialCaseAppeal(reviewed.state, created.row.id, { approved: true, adjustedPaymentFen: 3100000, at: appealed.appeal.submittedAt }, appealed.panel.members[1].reviewerAccount);

  assert.equal(reviewed.row.state, "APPROVED");
  assert.equal(reviewed.state.cases.find((item) => item.id === "dp-case-001").specialCaseStatus, reviewed.row.status);
  assert.equal(SpecialCase.settlementAdjustment(reviewed.state.specialCases, { id: "dp-case-001" }).adjustedPaymentFen, 3100000);
});

test("service leaves the rejected case unchanged when no fresh appeal panel is available", () => {
  const state = Service.seedDiseasePaymentState();
  state.specialCaseExperts = state.specialCaseExperts.filter((item) => item.appealOnly !== true);
  const created = Service.createSpecialCase(state, { caseId: "dp-case-001", reason: "复杂危重病例资源消耗异常", requestedPaymentFen: 3200000, evidence: evidence("1") }, "hospital-applicant");
  const rejected = Service.reviewSpecialCase(created.state, created.row.id, { approved: false }, created.panel.members[0].reviewerAccount);
  const before = structuredClone(rejected.row);

  assert.throws(() => Service.createSpecialCaseAppeal(rejected.state, rejected.row.id, { originalDecisionDigest: rejected.row.decisionDigest, reason: "补充新证据", evidence: evidence("2"), at: rejected.row.rejectedAt }, "hospital-applicant"), (error) => error.code === "SPECIAL_CASE_APPEAL_EXPERT_UNAVAILABLE");
  assert.deepEqual(rejected.state.specialCases.find((item) => item.id === rejected.row.id), before);
});

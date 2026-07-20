const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductionSecurityAcceptanceCenter,
  normalizeProductionSecurityFindingAction,
  normalizeProductionSecurityReleaseApprovalAction,
  seedProductionSecurityFindings,
  seedProductionSecurityReleaseApprovals
} = require("../production-security-acceptance");

const operator = { id: "security-operator", username: "security_operator", role: "commission" };
const reviewer = { id: "security-reviewer", username: "security_reviewer", role: "commission" };
const releaseOwner = { id: "release-owner", username: "release_owner", role: "commission" };
const now = new Date("2026-07-18T00:00:00.000Z");

test("production security finding requires remediation evidence and independent retest", () => {
  let finding = seedProductionSecurityFindings()[0];
  finding = normalizeProductionSecurityFindingAction(finding, {
    action: "record-remediation",
    evidenceRef: "retest/fix-001.json",
    note: "Record the controlled remediation evidence."
  }, operator, { now });
  finding = normalizeProductionSecurityFindingAction(finding, {
    action: "submit-retest",
    note: "Submit the finding for independent retest."
  }, operator, { now });
  assert.throws(() => normalizeProductionSecurityFindingAction(finding, {
    action: "verify-retest",
    result: "passed",
    evidenceRef: "retest/result-001.json",
    note: "Attempt a self review of the remediation."
  }, operator, { now }), /independent reviewer/);
  finding = normalizeProductionSecurityFindingAction(finding, {
    action: "verify-retest",
    result: "passed",
    evidenceRef: "retest/result-001.json",
    note: "Independent retest confirms the finding is closed."
  }, reviewer, { now });
  assert.equal(finding.status, "closed");
  assert.equal(finding.reviewedBy, reviewer.id);
});

test("critical findings cannot be waived and high waivers are time limited", () => {
  const critical = seedProductionSecurityFindings()[1];
  assert.throws(() => normalizeProductionSecurityFindingAction({ ...critical, status: "reopened" }, {
    action: "request-waiver",
    expiresAt: "2026-07-25",
    reason: "Critical waiver attempt",
    compensatingControl: "Temporary control",
    note: "Request waiver for a critical finding."
  }, operator, { now }), /cannot be waived/);
  const high = { ...seedProductionSecurityFindings()[0], status: "reopened" };
  assert.throws(() => normalizeProductionSecurityFindingAction(high, {
    action: "request-waiver",
    expiresAt: "2026-09-30",
    reason: "Extended compatibility window",
    compensatingControl: "Allowlist and receipt checks",
    note: "Request a waiver beyond the high risk limit."
  }, operator, { now }), /within 30 days/);
  const requested = normalizeProductionSecurityFindingAction(high, {
    action: "request-waiver",
    expiresAt: "2026-07-25",
    reason: "Short compatibility window",
    compensatingControl: "Allowlist, signed receipts and daily review",
    note: "Request a time-limited high risk waiver."
  }, operator, { now });
  assert.throws(() => normalizeProductionSecurityFindingAction(requested, {
    action: "approve-waiver",
    note: "Requester attempts to approve the waiver."
  }, operator, { now }), /independent reviewer/);
  const approved = normalizeProductionSecurityFindingAction(requested, {
    action: "approve-waiver",
    note: "Independent reviewer approves the short waiver."
  }, reviewer, { now });
  assert.equal(approved.status, "waived");
  assert.equal(approved.waiver.approvedBy, reviewer.id);
});

test("release opinions require zero unresolved findings and unique signers", () => {
  const findings = seedProductionSecurityFindings().map((item) => ({ ...item, status: "closed", waiver: undefined }));
  let approvals = seedProductionSecurityReleaseApprovals();
  let center = buildProductionSecurityAcceptanceCenter(findings, approvals, { now });
  assert.equal(center.summary.releaseEligible, true);
  approvals[0] = normalizeProductionSecurityReleaseApprovalAction(approvals[0], {
    action: "approve-release",
    note: "Security owner records the controlled release opinion."
  }, reviewer, center, { now });
  center = buildProductionSecurityAcceptanceCenter(findings, approvals, { now });
  assert.throws(() => normalizeProductionSecurityReleaseApprovalAction(approvals[1], {
    action: "approve-release",
    note: "Duplicate signer attempts the second release opinion."
  }, reviewer, center, { now }), /unique signers/);
  approvals[1] = normalizeProductionSecurityReleaseApprovalAction(approvals[1], {
    action: "approve-release",
    note: "Release owner independently records the second opinion."
  }, releaseOwner, center, { now });
  center = buildProductionSecurityAcceptanceCenter(findings, approvals, { now });
  assert.equal(center.status, "security-opinion-recorded");
  assert.equal(center.productionGate.formalProductionReady, false);
});

test("expired waiver reopens the release gate", () => {
  const findings = seedProductionSecurityFindings().map((item) => ({ ...item, status: "closed", waiver: undefined }));
  findings[0] = {
    ...findings[0],
    status: "waived",
    waiver: { expiresAt: "2026-07-17", approvedBy: "reviewer" }
  };
  const center = buildProductionSecurityAcceptanceCenter(findings, seedProductionSecurityReleaseApprovals(), { now });
  assert.equal(center.findings[0].open, true);
  assert.equal(center.summary.highOpen, 1);
  assert.equal(center.summary.releaseEligible, false);
});

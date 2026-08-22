const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductionGoNoGoCenter,
  normalizeProductionGoNoGoApprovalAction,
  normalizeProductionGoNoGoDecision,
  seedProductionGoNoGoApprovals
} = require("../production-go-no-go");
const { assessProductionPreflightDecisionReceipt } = require("../production-preflight-decision-receipt");

const RELEASE_ID = "release-2026-08-23-001";
const ARTIFACT_DIGEST = `sha256:${"a".repeat(64)}`;
const NOW = "2026-08-23T08:00:00.000Z";

function verifierFor(receipt) {
  return () => ({
    verified: true,
    verifierId: "change-authority-verifier",
    receiptId: receipt.receiptId,
    releaseId: receipt.releaseId,
    artifactDigest: receipt.artifactDigest,
    evidenceFingerprint: receipt.evidenceFingerprint,
    replayDetected: false,
    singleUseEnforced: true,
    verifiedAt: "2026-08-23T07:55:00.000Z"
  });
}

function addTrustedReceipt(fixture) {
  const preliminary = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  const receipt = {
    contract: "production-preflight-decision-receipt.v1",
    receiptId: "receipt-20260823-0001",
    decision: "GO",
    releaseId: RELEASE_ID,
    artifactDigest: ARTIFACT_DIGEST,
    evidenceFingerprint: preliminary.evidenceFingerprint,
    issuedAt: "2026-08-23T07:50:00.000Z",
    expiresAt: "2026-08-23T08:10:00.000Z"
  };
  fixture.evidence.trustedPreflightDecision = assessProductionPreflightDecisionReceipt(receipt, {
    releaseId: RELEASE_ID,
    artifactDigest: ARTIFACT_DIGEST,
    evidenceFingerprint: preliminary.evidenceFingerprint
  }, { now: NOW, verifier: verifierFor(receipt) });
  return fixture;
}

function eligibleFixture() {
  const data = {
    platformProductionBlockerReviews: Array.from({ length: 10 }, (_, index) => ({
      blockerId: `P0-${String(index + 1).padStart(2, "0")}`,
      workflowStatus: "site-accepted",
      siteAcceptance: { status: "accepted" }
    })),
    productionGoNoGoApprovals: seedProductionGoNoGoApprovals()
  };
  const evidence = {
    launchSmoke: { ok: true, baseUrl: "https://health.example.gov.cn", summary: { total: 9, passed: 9, failed: 0, liveChecks: 2 } },
    cutoverChecklist: Array.from({ length: 10 }, (_, index) => ({ id: `cutover-${index}`, passed: true })),
    cutoverProfile: "production",
    drRehearsalSigned: true
  };
  const security = { summary: { approvedReleaseOpinions: 2, releaseApprovals: 2 }, productionGate: { securityOpinionRecorded: true } };
  return addTrustedReceipt({ data, evidence, security });
}

test("global go/no-go remains blocked when real cutover prerequisites are missing", () => {
  const center = buildProductionGoNoGoCenter({}, {}, {});
  assert.equal(center.status, "blocked-by-cutover-prerequisites");
  assert.equal(center.gate.productionGoRecorded, false);
  assert.equal(center.summary.prerequisitesPassed, 0);
});

test("four-party approvals require passed prerequisites and unique signers", () => {
  const fixture = eligibleFixture();
  let center = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  assert.equal(center.summary.prerequisiteReady, true);
  const actor = { id: "signer-1", role: "commission" };
  fixture.data.productionGoNoGoApprovals[0] = normalizeProductionGoNoGoApprovalAction(
    fixture.data.productionGoNoGoApprovals[0], { action: "approve", responsibility: "business", evidenceRef: "approval/business.pdf", note: "Business owner approves the controlled cutover." }, actor, center
  );
  center = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  assert.throws(() => normalizeProductionGoNoGoApprovalAction(
    fixture.data.productionGoNoGoApprovals[1], { action: "approve", responsibility: "information", evidenceRef: "approval/information.pdf", note: "Duplicate signer attempts another approval." }, actor, center
  ), /unique signers/);
});

test("approval ownership prevents overwrite and cross-signer revocation", () => {
  const fixture = eligibleFixture();
  let center = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  const approval = normalizeProductionGoNoGoApprovalAction(
    fixture.data.productionGoNoGoApprovals[0],
    { action: "approve", responsibility: "business", evidenceRef: "approval/business.pdf", note: "Business owner records signed evidence." },
    { id: "business-signer" }, center
  );
  fixture.data.productionGoNoGoApprovals[0] = approval;
  center = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  assert.throws(() => normalizeProductionGoNoGoApprovalAction(
    approval, { action: "approve", responsibility: "business", evidenceRef: "approval/replacement.pdf", note: "Attempt to overwrite approval." }, { id: "other-signer" }, center
  ), /already been recorded/);
  assert.throws(() => normalizeProductionGoNoGoApprovalAction(
    approval, { action: "revoke", note: "Different actor attempts to revoke approval." }, { id: "other-signer" }, center
  ), /original signer/);
});

test("demo and local smoke evidence never opens the prerequisite gate", () => {
  const fixture = eligibleFixture();
  fixture.evidence.launchSmoke.baseUrl = "http://localhost:5195";
  let center = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  assert.equal(center.checks.find((item) => item.id === "goNoGo:launchSmoke").passed, false);
  fixture.evidence.launchSmoke.baseUrl = "https://health.example.gov.cn";
  fixture.evidence.cutoverProfile = "demo";
  center = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  assert.equal(center.checks.find((item) => item.id === "goNoGo:cutoverChecklist").passed, false);
});

test("legacy synthetic trusted projection cannot open production GO", () => {
  const fixture = eligibleFixture();
  fixture.evidence.trustedPreflightDecision = {
    contract: "production-preflight-decision-receipt.v1",
    verified: true,
    code: "trusted-receipt-verified",
    evidenceFingerprint: buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security).evidenceFingerprint
  };
  const center = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  assert.equal(center.checks.find((item) => item.id === "goNoGo:trustedPreflightDecision").passed, false);
  assert.equal(center.gate.productionGoRecorded, false);
});

test("GO decision requires four independent approvals and explicit confirmation", () => {
  const fixture = eligibleFixture();
  const prerequisiteCenter = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  fixture.data.productionGoNoGoApprovals = fixture.data.productionGoNoGoApprovals.map((item, index) => ({
    ...item,
    status: "approved",
    approvedBy: `signer-${index + 1}`,
    approvedAt: "2026-07-20T00:00:00.000Z",
    evidenceFingerprint: prerequisiteCenter.evidenceFingerprint
  }));
  let center = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  assert.equal(center.gate.formalDecisionEligible, true);
  assert.throws(() => normalizeProductionGoNoGoDecision({
    decision: "GO",
    confirmation: "GO",
    changeTicket: "CHG-2026-001",
    cutoverWindow: "2026-07-25 00:00-04:00",
    rollbackOwner: "operations lead",
    note: "Attempt GO with invalid confirmation text."
  }, { id: "command-owner" }, center), /confirmation/);
  fixture.data.productionGoNoGoDecision = normalizeProductionGoNoGoDecision({
    decision: "GO",
    confirmation: "APPROVE PRODUCTION GO LIVE",
    changeTicket: "CHG-2026-001",
    cutoverWindow: "2026-07-25 00:00-04:00",
    rollbackOwner: "operations lead",
    note: "Command owner records the evidence-backed GO decision."
  }, { id: "command-owner" }, center, { now: new Date("2026-07-20T01:00:00.000Z") });
  center = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  assert.equal(center.status, "go-decision-recorded");
  assert.equal(center.gate.productionGoRecorded, true);
  assert.throws(() => normalizeProductionGoNoGoDecision({
    decision: "GO",
    confirmation: "APPROVE PRODUCTION GO LIVE",
    changeTicket: "CHG-2026-003",
    cutoverWindow: "2026-07-25 00:00-04:00",
    rollbackOwner: "operations lead",
    note: "An approval signer attempts the final command decision."
  }, { id: "signer-1" }, center), /independent/);
});

test("NO-GO can be recorded without bypassing missing prerequisites", () => {
  const center = buildProductionGoNoGoCenter({}, {}, {});
  const decision = normalizeProductionGoNoGoDecision({
    decision: "NO-GO",
    changeTicket: "CHG-2026-002",
    note: "Command owner records NO-GO because evidence is incomplete."
  }, { id: "command-owner" }, center);
  assert.equal(decision.decision, "NO-GO");
});

test("evidence drift invalidates old approvals until signers re-approve", () => {
  const fixture = eligibleFixture();
  const prerequisiteCenter = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  fixture.data.productionGoNoGoApprovals = fixture.data.productionGoNoGoApprovals.map((item, index) => ({
    ...item,
    status: "approved",
    approvedBy: `signer-${index + 1}`,
    approvedAt: "2026-07-20T00:00:00.000Z",
    evidenceFingerprint: prerequisiteCenter.evidenceFingerprint
  }));
  fixture.evidence.launchSmoke.generatedAt = "2026-07-20T01:30:00.000Z";
  const center = buildProductionGoNoGoCenter(fixture.data, fixture.evidence, fixture.security);
  assert.equal(center.summary.prerequisiteReady, false);
  assert.equal(center.checks.find((item) => item.id === "goNoGo:trustedPreflightDecision").passed, false);
  assert.equal(center.summary.approvalsRecorded, 0);
  assert.equal(center.summary.staleApprovals, 4);
  assert.equal(center.gate.formalDecisionEligible, false);
  assert.equal(center.approvals.every((item) => item.evidenceCurrent === false), true);
});

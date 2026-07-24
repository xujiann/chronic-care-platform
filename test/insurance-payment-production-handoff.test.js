"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildInsurancePaymentAcceptance } = require("../scripts/insurance-payment-acceptance");
const Handoff = require("../insurance-payment-production-handoff");

function evidenceInput(overrides = {}) {
  return {
    evidenceReference: "T00-ACCEPTANCE-2026-001",
    evidenceDigest: `sha256:${"a".repeat(64)}`,
    artifactType: "route-integration-test-report",
    issuedAt: "2026-07-22T08:00:00.000Z",
    submittedAt: "2026-07-22T09:00:00.000Z",
    idempotencyKey: "submit-route-refund-create-v1",
    ...overrides
  };
}

test("production handoff seeds every pending route and external blocker without claiming production readiness", () => {
  const acceptance = buildInsurancePaymentAcceptance();
  const data = {};
  const state = Handoff.ensureProductionHandoff(data, acceptance, "2026-07-22T08:00:00.000Z");
  const status = Handoff.buildProductionHandoffStatus(data, acceptance);
  assert.equal(state.schema, "insurance-payment-production-handoff-v1");
  assert.equal(status.summary.required, acceptance.summary.t00RoutesPending + acceptance.summary.externalBlockers);
  assert.equal(status.summary.pending, status.summary.required);
  assert.equal(status.ledgerValid, true);
  assert.equal(status.evidenceComplete, false);
  assert.equal(status.productionReady, false);
  assert.match(status.requirementsDigest, /^sha256:[a-f0-9]{64}$/);
});

test("production handoff enforces scoped submitters four-eyes verification and digest-only status", () => {
  const acceptance = buildInsurancePaymentAcceptance();
  const data = {};
  const itemId = `route:${acceptance.integrationHandoff.routes.find((item) => !item.wired).id}`;
  assert.throws(() => Handoff.submitHandoffEvidence(data, acceptance, itemId, evidenceInput(), { username: "t07", role: "external-owner" }), (error) => error.code === "HANDOFF_SUBMISSION_RESPONSIBILITY_DENIED");
  const submitted = Handoff.submitHandoffEvidence(data, acceptance, itemId, evidenceInput(), { username: "t00-integrator", role: "integration-owner" });
  assert.equal(submitted.item.state, Handoff.HANDOFF_STATES.SUBMITTED);
  assert.equal(submitted.idempotent, false);
  assert.equal(Handoff.submitHandoffEvidence(data, acceptance, itemId, evidenceInput(), { username: "t00-integrator", role: "integration-owner" }).idempotent, true);
  assert.throws(() => Handoff.verifyHandoffEvidence(data, acceptance, itemId, { approved: true, verificationReference: "REVIEW-001", idempotencyKey: "verify-001" }, { username: "t00-integrator", role: "acceptance-reviewer" }), (error) => error.code === "HANDOFF_FOUR_EYES_REQUIRED");
  Handoff.verifyHandoffEvidence(data, acceptance, itemId, { approved: true, verificationReference: "REVIEW-001", verifiedAt: "2026-07-22T10:00:00.000Z", idempotencyKey: "verify-001" }, { username: "acceptance-lead", role: "acceptance-reviewer" });
  Handoff.verifyHandoffEvidence(data, acceptance, itemId, { approved: true, verificationReference: "REVIEW-001", idempotencyKey: "verify-001" }, { username: "acceptance-lead", role: "acceptance-reviewer" });
  const status = Handoff.buildProductionHandoffStatus(data, acceptance);
  assert.equal(status.summary.verified, 1);
  assert.equal(status.productionReady, false);
  assert.doesNotMatch(JSON.stringify(status), /T00-ACCEPTANCE-2026-001|REVIEW-001/);
  assert.match(status.items.find((item) => item.id === itemId).evidenceDigest, /^sha256:[a-f0-9]{64}$/);
});

test("production handoff supports rejection resubmission and detects ledger tampering", () => {
  const acceptance = buildInsurancePaymentAcceptance();
  const data = {};
  const blocker = acceptance.externalBlockers[0];
  const itemId = `external:${blocker.source}:${blocker.id}`;
  Handoff.submitHandoffEvidence(data, acceptance, itemId, evidenceInput({ idempotencyKey: "external-v1" }), { username: "provider-owner", role: "external-owner" });
  assert.throws(
    () => Handoff.verifyHandoffEvidence(data, acceptance, itemId, { approved: true, verificationReference: "WRONG-REVIEW-001", idempotencyKey: "wrong-review-v1" }, { username: "acceptance-reviewer", role: "acceptance-reviewer" }),
    (error) => error.code === "HANDOFF_VERIFICATION_RESPONSIBILITY_DENIED"
  );
  Handoff.verifyHandoffEvidence(data, acceptance, itemId, { approved: false, reasonCode: "SIGNATURE_INVALID", verificationReference: "SEC-REVIEW-001", verifiedAt: "2026-07-22T10:00:00.000Z", idempotencyKey: "reject-v1" }, { username: "security-reviewer", role: "security-reviewer" });
  const resubmitted = Handoff.submitHandoffEvidence(data, acceptance, itemId, evidenceInput({ evidenceDigest: `sha256:${"b".repeat(64)}`, evidenceReference: "PROVIDER-RECEIPT-002", idempotencyKey: "external-v2" }), { username: "provider-owner", role: "external-owner" });
  assert.equal(resubmitted.item.state, Handoff.HANDOFF_STATES.SUBMITTED);
  assert.equal(Handoff.verifyItemLedger(resubmitted.item.events), true);
  resubmitted.item.events[0] = { ...resubmitted.item.events[0], actor: "tampered" };
  assert.equal(Handoff.verifyItemLedger(resubmitted.item.events), false);
  assert.equal(Handoff.buildProductionHandoffStatus(data, acceptance).ledgerValid, false);
});

test("changed requirements invalidate previously verified evidence", () => {
  const acceptance = buildInsurancePaymentAcceptance();
  const data = {};
  const route = acceptance.integrationHandoff.routes.find((item) => !item.wired);
  const itemId = `route:${route.id}`;
  Handoff.submitHandoffEvidence(data, acceptance, itemId, evidenceInput(), { username: "t00-integrator", role: "integration-owner" });
  Handoff.verifyHandoffEvidence(data, acceptance, itemId, { approved: true, verificationReference: "REVIEW-001", verifiedAt: "2026-07-22T10:00:00.000Z", idempotencyKey: "verify-001" }, { username: "acceptance-lead", role: "acceptance-reviewer" });
  const changed = structuredClone(acceptance);
  changed.integrationHandoff.routes.find((item) => item.id === route.id).path = `${route.path}/v2`;
  const state = Handoff.ensureProductionHandoff(data, changed, "2026-07-23T08:00:00.000Z");
  const item = state.items.find((candidate) => candidate.id === itemId);
  assert.equal(item.state, Handoff.HANDOFF_STATES.PENDING);
  assert.equal(item.evidence, null);
  assert.equal(item.events.at(-1).action, "requirement-changed");
  assert.equal(Handoff.verifyItemLedger(item.events), true);
});

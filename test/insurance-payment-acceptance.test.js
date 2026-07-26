"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildInsurancePaymentAcceptance, renderMarkdown } = require("../scripts/insurance-payment-acceptance");

test("T07 unified acceptance covers all six workflows without claiming production readiness", () => {
  const report = buildInsurancePaymentAcceptance();
  assert.equal(report.localReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.workflows, 6);
  assert.equal(report.summary.workflowsReady, 6);
  assert.ok(report.summary.t00RoutesPending > 0);
  assert.ok(report.externalBlockers.length > 0);
  assert.equal(report.summary.externalBlockers, 20);
  assert.equal(report.externalBlockers.filter((item) => item.source === "disease-payment").length, 14);
  assert.equal(report.summary.externalEvidenceGoverned, true);
  assert.ok(report.externalBlockers.every((item) => item.owner && ["acceptance-reviewer", "security-reviewer", "finance-auditor"].includes(item.reviewerRole)));
  assert.ok(report.externalBlockers.some((item) => item.id === "official-grouper:trusted-callback" && item.reviewerRole === "security-reviewer"));
  assert.ok(report.externalBlockers.some((item) => item.id === "insurance-core:statement-reconciliation" && item.reviewerRole === "finance-auditor"));
  assert.ok(report.externalBlockers.some((item) => item.id === "financial-1" && item.reviewerRole === "security-reviewer"));
  assert.ok(report.externalBlockers.some((item) => item.id === "financial-3" && item.reviewerRole === "finance-auditor"));
  assert.ok(report.externalBlockers.some((item) => item.id === "financial-6" && item.reviewerRole === "acceptance-reviewer"));
  assert.match(renderMarkdown(report), /在线支付退费 \| PASS/);
  assert.match(renderMarkdown(report), /年度清算 \| PASS/);
});

test("T07 unified acceptance fails closed for an unmapped financial evidence requirement", () => {
  const baseline = buildInsurancePaymentAcceptance();
  const report = buildInsurancePaymentAcceptance({
    financialGateway: {
      ok: true,
      capabilities: [{ id: "online-refund-closed-loop", passed: true }, { id: "online-refund-sla-operations", passed: true }],
      blockers: ["credentials", "callbacks", "statements", "field dictionary", "security assessment", "site acceptance", "new unmapped requirement"]
    }
  });
  assert.equal(baseline.localReady, true);
  assert.equal(report.localReady, false);
  assert.equal(report.summary.externalEvidenceGoverned, false);
  assert.ok(report.externalBlockers.some((item) => item.id === "financial-unmapped-7" && item.owner === "" && item.reviewerRole === ""));
});

test("T07 unified acceptance fails when one workflow evidence is missing", () => {
  const report = buildInsurancePaymentAcceptance({
    diseasePayment: { ready: true, checks: [
      { id: "settlement", ok: true }, { id: "settlement-core-correction", ok: true }, { id: "settlement-payment-retry", ok: true }, { id: "settlement-sla", ok: true }, { id: "settlement-difference-governance", ok: true }, { id: "dual-mode", ok: true }, { id: "official-receipt-contract", ok: true }, { id: "formal-grouping-async", ok: true }, { id: "formal-grouper-production-config-contract", ok: true }, { id: "formal-grouping-compensation", ok: true }, { id: "formal-grouping-integrity", ok: true }, { id: "parameter-dual-review", ok: true }, { id: "special-case", ok: false }, { id: "special-case-appeal", ok: true }, { id: "annual-clearance", ok: true }, { id: "annual-clearance-institution-confirmation", ok: true }
    ], externalBlockers: [] },
    financialGateway: { ok: true, capabilities: [{ id: "online-refund-closed-loop", passed: true }, { id: "online-refund-sla-operations", passed: true }], blockers: [] },
    serverSource: ""
  });
  assert.equal(report.localReady, false);
  assert.equal(report.workflows.find((item) => item.id === "special-case").ready, false);
});

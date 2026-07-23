#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildDiseasePaymentReadiness } = require("./disease-payment-readiness");
const { buildFinancialGatewayReadiness } = require("./financial-gateway-readiness");
const OperatingModel = require("../insurance-payment-operating-model");

const ROOT = path.resolve(__dirname, "..");

function checkById(report, id) {
  return report.checks.find((item) => item.id === id)?.ok === true;
}

function capabilityById(report, id) {
  return report.capabilities.find((item) => item.id === id)?.passed === true;
}

function buildInsurancePaymentAcceptance(options = {}) {
  const diseasePayment = options.diseasePayment || buildDiseasePaymentReadiness();
  const financialGateway = options.financialGateway || buildFinancialGatewayReadiness();
  const serverSource = options.serverSource ?? fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const operatingModel = OperatingModel.validateOperatingModel();
  const integrationHandoff = OperatingModel.buildT00IntegrationHandoff(serverSource);
  const workflows = [
    { id: "online-payment-refund", label: "在线支付退费", ready: capabilityById(financialGateway, "online-refund-closed-loop") && capabilityById(financialGateway, "online-refund-sla-operations"), evidence: ["dual-domain-review", "trusted-callback", "provider-reversal", "phase-sla", "redacted-exception-queue", "daily-reconciliation", "voucher-close"] },
    { id: "insurance-settlement", label: "医保核心结算", ready: checkById(diseasePayment, "settlement"), evidence: ["formal-grouping-gate", "integer-fen-contract", "trusted-core-callback", "hash-ledger"] },
    { id: "drg-dip", label: "DRG/DIP分组测算", ready: ["dual-mode", "official-receipt-contract", "formal-grouping-async", "parameter-dual-review"].every((id) => checkById(diseasePayment, id)), evidence: ["signed-grouper-contract", "simulation-isolation", "versioned-parameters", "impact-analysis"] },
    { id: "special-case", label: "特例单议", ready: checkById(diseasePayment, "special-case") && checkById(diseasePayment, "special-case-appeal"), evidence: ["digest-only-evidence", "expert-avoidance", "dual-review", "decision-bound-appeal", "fresh-appeal-panel", "appeal-sla", "settlement-binding", "privacy-disclosure"] },
    { id: "monthly-settlement", label: "月度结算", ready: checkById(diseasePayment, "settlement") && checkById(diseasePayment, "settlement-sla") && checkById(diseasePayment, "settlement-difference-governance"), evidence: ["frozen-batch", "30-working-day-sla", "digest-bound-difference-evidence", "dual-domain-difference-resolution", "payment-receipt"] },
    { id: "annual-clearance", label: "年度清算", ready: checkById(diseasePayment, "annual-clearance") && checkById(diseasePayment, "annual-clearance-institution-confirmation"), evidence: ["per-institution-confirmation", "institution-bound-dispute", "aggregate-confirmation-digest", "adjustment-fund", "retained-balance", "risk-reserve", "finance-posting", "locked-ledger"] }
  ];
  const localReady = diseasePayment.ready && financialGateway.ok && operatingModel.ok && workflows.every((item) => item.ready);
  return {
    generatedAt: new Date().toISOString(),
    status: localReady ? "domain-ready-public-wiring-and-site-acceptance-pending" : "domain-incomplete",
    localReady,
    productionReady: false,
    summary: { workflows: workflows.length, workflowsReady: workflows.filter((item) => item.ready).length, t00RoutesPending: integrationHandoff.pending, externalBlockers: diseasePayment.externalBlockers.length + financialGateway.blockers.length },
    workflows,
    operatingModel,
    integrationHandoff,
    externalBlockers: [...diseasePayment.externalBlockers.map((item) => ({ source: "disease-payment", id: item.id, detail: item.name })), ...financialGateway.blockers.map((detail, index) => ({ source: "financial-gateway", id: `financial-${index + 1}`, detail }))]
  };
}

function renderMarkdown(report) {
  return [
    "# T07 医保支付与按病种付费统一验收",
    "",
    `- 本地领域能力：${report.localReady ? "通过" : "未通过"}`,
    `- 生产就绪：${report.productionReady ? "是" : "否"}`,
    `- T00待接端点：${report.summary.t00RoutesPending}`,
    "",
    "| 主链 | 结果 | 验收证据 |",
    "|---|---|---|",
    ...report.workflows.map((item) => `| ${item.label} | ${item.ready ? "PASS" : "FAIL"} | ${item.evidence.join("、")} |`),
    "",
    "生产资格仍以真实凭据、正式规则、账单与回调联调、安全测评和现场签字证据为准。",
    ""
  ].join("\n");
}

if (require.main === module) {
  const report = buildInsurancePaymentAcceptance();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.localReady) process.exitCode = 1;
}

module.exports = { buildInsurancePaymentAcceptance, renderMarkdown };
